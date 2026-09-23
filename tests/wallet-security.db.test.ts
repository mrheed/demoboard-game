import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { privateKeyToAccount } from "viem/accounts";
import { eq } from "drizzle-orm";
import { getDb } from "../src/server/db";
import { users, wallets, userBalances, sessions } from "../src/server/db/schema";
import { issueWalletLoginChallenge, loginWithWallet } from "../src/server/services/wallet-auth.service";
import { connectWallet, verifyWallet, listWallets } from "../src/server/services/wallet-link.service";
import { resolveSessionToken } from "../src/server/services/auth.service";
import { requirePlayWallet } from "../src/server/lib/require-play-wallet";
import { withPlayDocument, initializePlayDocuments } from "../src/server/lib/play-store";
import { ROBINHOOD_CHAIN_LABEL } from "../src/lib/wallet/chains";

// Opt-in disposable local database only; never use DATABASE_URL from the shell.
const port = Number(process.env.BOARD_TEST_PG_PORT);
const enabled = Number.isInteger(port) && port > 1024 && port < 65536;
const name = `board_security_test_${process.pid}`;
let admin: ReturnType<typeof postgres>;
let fixtureDb: ReturnType<typeof postgres>;
const attacker = privateKeyToAccount(`0x${"31".repeat(32)}`);
const victim = privateKeyToAccount(`0x${"32".repeat(32)}`);
const secondary = privateKeyToAccount(`0x${"33".repeat(32)}`);
const legacy = privateKeyToAccount(`0x${"34".repeat(32)}`);
let legacyId: string;
let attackerSession: Awaited<ReturnType<typeof loginWithWallet>>;

async function login(account: typeof attacker) {
  const challenge = await issueWalletLoginChallenge(account.address);
  return loginWithWallet({ address: account.address, message: challenge.message,
    signature: await account.signMessage({ message: challenge.message }) });
}

before(async () => {
  if (!enabled) return;
  delete process.env.ALLOW_MOCK_WALLET_VERIFY;
  process.env.NEXT_PUBLIC_CHAIN_ENV = "testnet";
  const url = `postgresql://127.0.0.1:${port}`;
  admin = postgres(`${url}/postgres`, { max: 1 });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  process.env.DATABASE_URL = `${url}/${name}`;
  fixtureDb = postgres(process.env.DATABASE_URL, { max: 1 });
  const files = (await readdir(resolve("drizzle"))).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  for (const file of files) {
    if (file.startsWith("0013_")) {
      const [row] = await fixtureDb`insert into users (username, balance) values ('legacy-fixture', 123) returning id`;
      legacyId = row.id;
      await fixtureDb`insert into wallets (user_id, address, chain, is_primary, verified_at)
        values (${legacyId}, ${legacy.address.toLowerCase()}, ${ROBINHOOD_CHAIN_LABEL}, true, now())`;
      await fixtureDb`insert into user_balances (user_id, available) values (${legacyId}, 456)`;
      await fixtureDb`insert into sessions (user_id, token_hash, expires_at) values (${legacyId}, 'legacy', now() + interval '1 day')`;
    }
    for (const statement of (await readFile(resolve("drizzle", file), "utf8")).split("--> statement-breakpoint")) {
      if (statement.trim()) await fixtureDb.unsafe(statement);
    }
  }
});

after(async () => {
  if (!enabled) return;
  if (fixtureDb) await fixtureDb.end();
  if (admin) {
    // Only this test's newly-created, generated-name database is removed.
    await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
});

test("migration quarantines legacy ownership and revokes sessions without changing balances", { skip: !enabled }, async () => {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, legacyId));
  const [balance] = await db.select().from(userBalances).where(eq(userBalances.userId, legacyId));
  const [session] = await db.select().from(sessions).where(eq(sessions.userId, legacyId));
  assert.equal(user.walletSecurityHold, true);
  assert.equal(Number(user.balance), 123);
  assert.equal(Number(balance.available), 456);
  assert.ok(session.revokedAt);
  await assert.rejects(login(legacy), /ownership requires review/);
});

test("a victim signing in never inherits an attacker's unverified wallet reservation", { skip: !enabled }, async () => {
  attackerSession = await login(attacker);
  await connectWallet({ userId: attackerSession.user.id, address: victim.address, makePrimary: true });
  const victimSession = await login(victim);
  assert.notEqual(victimSession.user.id, attackerSession.user.id);
  const request = new Request("http://localhost", { headers: { "x-session-token": attackerSession.session.token } });
  await assert.rejects(requirePlayWallet(request, victim.address), /wallet that paid/);
  assert.equal(await requirePlayWallet(request, attacker.address), attacker.address.toLowerCase());
  assert.ok(await resolveSessionToken(victimSession.session.token));
});

test("legitimate secondary linking requires account-bound proof before changing the primary", { skip: !enabled }, async () => {
  const pending = await connectWallet({ userId: attackerSession.user.id, address: secondary.address, makePrimary: true });
  assert.equal((await listWallets(attackerSession.user.id)).wallets.find((w) => w.isPrimary)?.address, attacker.address.toLowerCase());
  assert.ok(pending.wallet.verifyMessage);
  const message = pending.wallet.verifyMessage!;
  await assert.rejects(verifyWallet({ userId: attackerSession.user.id,
    walletId: pending.wallet.id, message, signature: await victim.signMessage({ message }),
  }), /Invalid wallet signature/);
  const signature = await secondary.signMessage({ message });
  await verifyWallet({ userId: attackerSession.user.id, walletId: pending.wallet.id, message, signature });
  assert.equal((await listWallets(attackerSession.user.id)).wallets.find((w) => w.isPrimary)?.address, secondary.address.toLowerCase());
  await assert.rejects(verifyWallet({ userId: attackerSession.user.id, walletId: pending.wallet.id, message, signature }), /challenge/);
  const loggedIn = await login(attacker);
  assert.equal(loggedIn.user.id, attackerSession.user.id);
  assert.equal((await resolveSessionToken(loggedIn.session.token))?.walletAddress, attacker.address.toLowerCase());
  assert.equal((await listWallets(attackerSession.user.id)).wallets.find((w) => w.isPrimary)?.address, secondary.address.toLowerCase());
});

test("alternate chain labels and expired linking challenges are rejected", { skip: !enabled }, async () => {
  await assert.rejects(connectWallet({ userId: attackerSession.user.id, address: secondary.address, chain: "robinhood" }), /network/);
  const pending = await connectWallet({ userId: attackerSession.user.id, address: secondary.address });
  await getDb().update(wallets).set({ verifyExpiresAt: new Date(0) }).where(eq(wallets.id, pending.wallet.id));
  await assert.rejects(verifyWallet({ userId: attackerSession.user.id,
    walletId: pending.wallet.id, signature: await secondary.signMessage({ message: pending.wallet.verifyMessage! }),
  }), /expired/);
});

test("anonymous refresh and invalid signatures cannot consume another wallet's login challenge", { skip: !enabled }, async () => {
  const first = await issueWalletLoginChallenge(attacker.address);
  const repeated = await issueWalletLoginChallenge(attacker.address);
  assert.equal(first.message, repeated.message);
  await assert.rejects(loginWithWallet({ address: attacker.address, message: first.message,
    signature: await victim.signMessage({ message: first.message }) }), /Invalid wallet signature/);
  const input = { address: attacker.address, message: first.message, signature: await attacker.signMessage({ message: first.message }) };
  const results = await Promise.allSettled([loginWithWallet(input), loginWithWallet(input)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

test("contended document locks release pool connections needed by the holder", { skip: !enabled, timeout: 10000 }, async () => {
  const work = Array.from({ length: 25 }, () => withPlayDocument("pool-test", () => ({ count: 0 }), async (document) => {
    await withPlayDocument("independent-test", () => ({ count: 0 }), async (other) => { other.count++; });
    document.count++;
  }));
  await Promise.all(work);
  assert.equal(await withPlayDocument("pool-test", () => ({ count: 0 }), async (d) => d.count), 25);
});

test("empty PostgreSQL cannot silently replace a ledger; explicit import preserves consumed payments and refunds", { skip: !enabled }, async () => {
  await assert.rejects(withPlayDocument("play-tables", () => ({ usedTx: [] }), async (value) => value), /not initialized/);
  const legacy = { tables: [], usedTx: [`0x${"ab".repeat(32)}`], pendingRefunds: [{ address: victim.address, createdAt: 1 }], entryCutoverBlock: "17" };
  await initializePlayDocuments({ "play-tables": legacy, "play-nonce-fixture": { nextNonce: 7 } });
  const restored = await withPlayDocument("play-tables", () => legacy, async (value) => value);
  assert.deepEqual(restored, legacy);
  await assert.rejects(initializePlayDocuments({ "play-tables": { tables: [], usedTx: [] } }), /Refusing to overwrite/);
  assert.deepEqual(await withPlayDocument("play-tables", () => legacy, async (value) => value), legacy);
});

test("pending withdrawals reserve funds atomically and failure releases them", { skip: !enabled }, async () => {
  const { createPendingWithdraw } = await import("../src/server/services/withdraw.service");
  const { processWithdraw } = await import("../src/server/services/withdraw-process.service");
  const db = getDb();
  await db.update(users).set({ balance: "100.00" }).where(eq(users.id, attackerSession.user.id));
  await db.update(userBalances).set({ available: "100.00" }).where(eq(userBalances.userId, attackerSession.user.id));

  const first = await createPendingWithdraw({ userId: attackerSession.user.id, amount: 80, walletAddress: attacker.address });
  assert.equal(first.availableAfter, 20);
  await assert.rejects(
    createPendingWithdraw({ userId: attackerSession.user.id, amount: 80, walletAddress: attacker.address }),
    /withdraw up to 20/,
  );
  const released = await processWithdraw({ transactionId: first.transaction.id, fail: true });
  assert.equal(released.availableAfter, 100);

  const reserved = await createPendingWithdraw({ userId: attackerSession.user.id, amount: 80, walletAddress: attacker.address });
  const confirmed = await processWithdraw({ transactionId: reserved.transaction.id, txHash: `0x${"81".repeat(32)}` });
  assert.equal(confirmed.availableAfter, 20);
  assert.equal((await db.select().from(userBalances).where(eq(userBalances.userId, attackerSession.user.id)))[0].available, "20.00");
});

test("deposit confirmation requires matching proof and credits a chain event only once", { skip: !enabled }, async () => {
  const { createPendingDeposit } = await import("../src/server/services/deposit.service");
  const { confirmDeposit } = await import("../src/server/services/deposit-confirm.service");
  const db = getDb();
  await db.update(users).set({ balance: "0.00" }).where(eq(users.id, attackerSession.user.id));
  await db.update(userBalances).set({ available: "0.00", walletAddress: secondary.address.toLowerCase() }).where(eq(userBalances.userId, attackerSession.user.id));
  const first = await createPendingDeposit({ userId: attackerSession.user.id, amount: 10, walletAddress: attacker.address });
  const second = await createPendingDeposit({ userId: attackerSession.user.id, amount: 10, walletAddress: attacker.address });
  const proof = {
    txHash: `0x${"91".repeat(32)}`,
    eventIndex: 7,
    amount: 10,
    chain: first.transaction.chain,
    walletAddress: attacker.address,
    asset: "BOARD",
  };
  await assert.rejects(confirmDeposit({ transactionId: first.transaction.id }), /transaction hash is required/);
  await confirmDeposit({ transactionId: first.transaction.id, ...proof });
  await assert.rejects(confirmDeposit({
    transactionId: second.transaction.id,
    ...proof,
    txHash: `0x${"91".repeat(32).toUpperCase()}`,
  }), /already been credited/);
  const [balance] = await db.select().from(userBalances).where(eq(userBalances.userId, attackerSession.user.id));
  assert.equal(balance.available, "10.00");
  assert.equal(balance.walletAddress, secondary.address.toLowerCase(), "historical deposits must not rewrite wallet identity");
});

test("wallet login challenges share one pruned bounded document", { skip: !enabled }, async () => {
  await issueWalletLoginChallenge(victim.address);
  const rows = await fixtureDb`select key from play_documents where key = 'wallet-challenges-v2' or key like 'wallet-login-%' order by key`;
  assert.deepEqual(rows.map((row) => row.key), ["wallet-challenges-v2"]);
});

test("paid reward state is monotonic and late fee proofs are merged without splitting hashes", { skip: !enabled }, async () => {
  const { processPaymentWebhook } = await import("../src/server/services/payment-webhook.service");
  const [room] = await fixtureDb`insert into rooms (game_type, entry_fee, status) values ('ludo', 10, 'finished') returning id`;
  const [match] = await fixtureDb`insert into matches (room_id, game_type, winner_user_id, prize_pool, status)
    values (${room.id}, 'ludo', ${attackerSession.user.id}, 40, 'settled') returning id`;
  const [payout] = await fixtureDb`insert into reward_payouts
    (match_id, room_id, winner_user_id, game_type, entry_fee, seats, gross_pot, fee_amount, treasury_amount, burn_amount, net_payout)
    values (${match.id}, ${room.id}, ${attackerSession.user.id}, 'ludo', 10, 4, 40, 0.8, 0.4, 0.4, 39.2) returning id`;
  await fixtureDb`insert into transactions (user_id, type, status, amount, reference_id) values (${attackerSession.user.id}, 'payout', 'pending', 39.2, ${match.id})`;
  await fixtureDb`insert into fee_ledger (reward_payout_id, match_id, kind, amount) values
    (${payout.id}, ${match.id}, 'treasury', 0.4), (${payout.id}, ${match.id}, 'burn', 0.4)`;
  const payoutHash = `0x${"a1".repeat(32)}`;
  await processPaymentWebhook({ kind: "reward_payout", id: payout.id, status: "paid", txHash: payoutHash });
  await processPaymentWebhook({
    kind: "reward_payout", id: payout.id, status: "paid", txHash: payoutHash,
    treasuryTxHash: `0x${"a2".repeat(32)}`,
    burnTxHash: `0x${"a3".repeat(32)}`,
    burnProofUri: "https://example.invalid/proof/a3",
  });
  const proofs = await fixtureDb`select kind, tx_hash, proof_uri from fee_ledger where reward_payout_id = ${payout.id} order by kind`;
  assert.equal(proofs.find((row) => row.kind === "treasury")?.tx_hash, `0x${"a2".repeat(32)}`);
  assert.equal(proofs.find((row) => row.kind === "burn")?.proof_uri, "https://example.invalid/proof/a3");
  const stale = await processPaymentWebhook({ kind: "reward_payout", id: payout.id, status: "failed" });
  assert.equal(stale.status, "paid");
  assert.equal(stale.txHash, payoutHash);
  await assert.rejects(
    processPaymentWebhook({ kind: "reward_payout", id: payout.id, status: "paid", txHash: `0x${"a4".repeat(32)}` }),
    /different transaction hash/,
  );
  const [ledger] = await fixtureDb`select tx_hash from transactions where reference_id = ${match.id} and type = 'payout'`;
  assert.equal(ledger.tx_hash, payoutHash);
});
