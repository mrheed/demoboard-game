import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadEnvConfig } from "@next/env";
import postgres from "postgres";
import {
  createPublicClient,
  formatEther,
  formatUnits,
  http,
  parseUnits,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood } from "viem/chains";

import {
  ROBINHOOD_USDG_ADDRESS,
  USDG_ABI,
  USDG_DECIMALS,
  USDG_SYMBOL,
} from "../src/lib/wallet/usdg";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

type Status = "PASS" | "BLOCK" | "WARN";
type Check = { status: Status; name: string; detail: string };
type Ledger = {
  network?: {
    chainId?: number;
    treasury?: string;
    asset?: {
      kind?: string;
      address?: string;
      symbol?: string;
      decimals?: number;
      entryAmount?: string;
    };
  };
  entryCutoverBlock?: string;
  usedTx?: unknown[];
  pendingRefunds?: unknown[];
  matches?: Record<string, unknown>;
  tables?: Array<{ seats?: unknown[] }>;
};
type WorkerHealth = {
  gameplayAt?: number;
  paymentsAt?: number;
  paymentError?: string | null;
};

const checks: Check[] = [];
const add = (status: Status, name: string, detail: string) =>
  checks.push({ status, name, detail });

function safeErrorDetail(error: unknown, fallback: string) {
  let message = error instanceof Error ? error.message : fallback;
  for (const value of [
    process.env.DATABASE_URL,
    process.env.NEXT_PUBLIC_RPC_URL,
    process.env.PLAY_TREASURY_PRIVATE_KEY,
    process.env.PAYMENT_WEBHOOK_SECRET,
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  ]) {
    if (value) message = message.split(value).join("[redacted]");
  }
  return message.split("\n", 1)[0] || fallback;
}

function isHexPrivateKey(value: string | undefined): value is `0x${string}` {
  return Boolean(value && /^0x[a-fA-F0-9]{64}$/.test(value));
}

function ledgerHasFinancialHistory(ledger: Ledger) {
  return Boolean(
    (ledger.usedTx?.length ?? 0) > 0 ||
      (ledger.pendingRefunds?.length ?? 0) > 0 ||
      Object.keys(ledger.matches ?? {}).length > 0 ||
      (ledger.tables ?? []).some((table) => (table.seats?.length ?? 0) > 0),
  );
}

function sameAddress(left: string | undefined, right: string) {
  return left?.toLowerCase() === right.toLowerCase();
}

function checkLedger(ledger: Ledger, treasury: Address | null) {
  const expectedAmount = parseUnits("1", USDG_DECIMALS).toString();
  const networkMatches = ledger.network?.chainId === robinhood.id;
  add(
    networkMatches ? "PASS" : "BLOCK",
    "Ledger network",
    networkMatches
      ? `Bound to Robinhood Chain mainnet (${robinhood.id}).`
      : `Stored chain is ${ledger.network?.chainId ?? "missing"}; expected ${robinhood.id}. Never relabel an existing ledger.`,
  );
  const treasuryMatches = Boolean(
    treasury && sameAddress(ledger.network?.treasury, treasury),
  );
  add(
    treasuryMatches ? "PASS" : "BLOCK",
    "Ledger treasury",
    treasuryMatches
      ? `Bound to configured treasury ${treasury}.`
      : treasury
        ? `Stored treasury does not match ${treasury}.`
        : "Cannot verify ledger ownership without the production treasury key.",
  );

  const asset = ledger.network?.asset;
  const assetMatches = Boolean(
    asset &&
      asset.kind === "erc20" &&
      sameAddress(asset.address, ROBINHOOD_USDG_ADDRESS) &&
      asset.symbol === USDG_SYMBOL &&
      asset.decimals === USDG_DECIMALS &&
      asset.entryAmount === expectedAmount,
  );
  if (assetMatches) {
    add("PASS", "Ledger asset", `Canonical ${USDG_SYMBOL}, exactly 1 token per seat.`);
  } else if (
    !asset &&
    !ledgerHasFinancialHistory(ledger) &&
    networkMatches &&
    treasuryMatches
  ) {
    add(
      "WARN",
      "Ledger asset",
      "Fresh empty ledger is not asset-bound yet; one successful app initialization will bind canonical USDG.",
    );
  } else if (!asset && !ledgerHasFinancialHistory(ledger)) {
    add(
      "WARN",
      "Ledger asset",
      "Empty legacy ledger is not asset-bound. Archive it and initialize a separate mainnet ledger; do not relabel it.",
    );
  } else {
    add(
      "BLOCK",
      "Ledger asset",
      "Ledger is not bound to canonical 1 USDG entry records.",
    );
  }

  const cutover = ledger.entryCutoverBlock;
  const validCutover = Boolean(
    networkMatches &&
      cutover &&
      /^\d+$/.test(cutover) &&
      BigInt(cutover) > BigInt(0),
  );
  add(
    validCutover ? "PASS" : "BLOCK",
    "Ledger cutover",
    validCutover
      ? `Unknown payments before block ${cutover} are rejected.`
      : networkMatches
        ? "A valid post-initialization cutover block is required."
        : "The stored cutover belongs to another network and cannot protect mainnet entry.",
  );
}

async function readLocalLedger(): Promise<Ledger | null> {
  try {
    return JSON.parse(
      await readFile(join(process.cwd(), ".data", "play-tables.json"), "utf8"),
    ) as Ledger;
  } catch {
    return null;
  }
}

async function checkDatabase(treasury: Address | null) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    add(
      "BLOCK",
      "PostgreSQL",
      "DATABASE_URL is missing. Production paid play must not use local files.",
    );
    const local = await readLocalLedger();
    if (local) checkLedger(local, treasury);
    else add("WARN", "Local ledger", "No local play-tables.json was found.");
    return;
  }

  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 8 });
  try {
    const ledgerRows = await sql<{ value: Ledger }[]>`
      select value from play_documents where key = 'play-tables'
    `;
    if (!ledgerRows[0]) {
      add(
        "BLOCK",
        "PostgreSQL ledger",
        "play-tables is missing; run the reviewed importer with --new-ledger or a reconciled backup.",
      );
      return;
    }
    add("PASS", "PostgreSQL", "Connected and found the paid ledger.");
    checkLedger(ledgerRows[0].value, treasury);

    if (!treasury) {
      add(
        "BLOCK",
        "Play worker",
        "Cannot locate the production worker heartbeat without the treasury address.",
      );
      return;
    }
    const healthKey = `play-worker-${robinhood.id}-${treasury.toLowerCase()}`;
    const healthRows = await sql<{ value: WorkerHealth }[]>`
      select value from play_documents where key = ${healthKey}
    `;
    const health = healthRows[0]?.value;
    const now = Date.now();
    const healthy = Boolean(
      health &&
        now - (health.gameplayAt ?? 0) < 30_000 &&
        now - (health.paymentsAt ?? 0) < 60_000 &&
        !health.paymentError,
    );
    add(
      healthy ? "PASS" : "BLOCK",
      "Play worker",
      healthy
        ? "Gameplay and payment heartbeats are current."
        : health?.paymentError || "Worker heartbeats are missing or stale.",
    );
  } catch (error) {
    add(
      "BLOCK",
      "PostgreSQL",
      safeErrorDetail(error, "Database readiness check failed."),
    );
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function main() {
  add(
    process.env.NEXT_PUBLIC_CHAIN_ENV === "mainnet" ? "PASS" : "BLOCK",
    "Chain selection",
    process.env.NEXT_PUBLIC_CHAIN_ENV === "mainnet"
      ? `Robinhood Chain mainnet (${robinhood.id}).`
      : "NEXT_PUBLIC_CHAIN_ENV must be exactly mainnet.",
  );

  const confirmations = Number(process.env.PLAY_PAYMENT_CONFIRMATIONS ?? "30");
  add(
    Number.isSafeInteger(confirmations) && confirmations >= 30 ? "PASS" : "BLOCK",
    "Confirmations",
    Number.isSafeInteger(confirmations) && confirmations >= 30
      ? `${confirmations} confirmations required.`
      : "Use the reviewed launch policy of at least 30 confirmations.",
  );

  const privateKey = process.env.PLAY_TREASURY_PRIVATE_KEY?.trim();
  let treasury: Address | null = null;
  if (!isHexPrivateKey(privateKey)) {
    add(
      "BLOCK",
      "Treasury key",
      "PLAY_TREASURY_PRIVATE_KEY is missing or invalid; local generated keys are not production custody.",
    );
  } else {
    treasury = privateKeyToAccount(privateKey).address;
    add("PASS", "Treasury key", `Stable key resolves to ${treasury}; the key itself was not printed.`);
  }
  await checkDatabase(treasury);

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL?.trim();
  let rpc: URL | null = null;
  try {
    rpc = rpcUrl ? new URL(rpcUrl) : null;
  } catch {
    rpc = null;
  }
  const dedicatedRpc = Boolean(
    rpc &&
      rpc.protocol === "https:" &&
      rpc.hostname !== "rpc.mainnet.chain.robinhood.com",
  );
  add(
    dedicatedRpc ? "PASS" : "BLOCK",
    "Dedicated RPC",
    dedicatedRpc
      ? `Configured provider host: ${rpc!.hostname}.`
      : "Set NEXT_PUBLIC_RPC_URL to an HTTPS production-provider endpoint, not the rate-limited public RPC.",
  );
  if (rpc && rpc.protocol === "https:") {
    try {
      const client = createPublicClient({
        chain: robinhood,
        transport: http(rpcUrl, { retryCount: 0, timeout: 8_000 }),
      });
      const [chainId, head, decimals, symbol] = await Promise.all([
        client.getChainId(),
        client.getBlockNumber(),
        client.readContract({
          address: ROBINHOOD_USDG_ADDRESS,
          abi: USDG_ABI,
          functionName: "decimals",
        }),
        client.readContract({
          address: ROBINHOOD_USDG_ADDRESS,
          abi: USDG_ABI,
          functionName: "symbol",
        }),
      ]);
      add(
        chainId === robinhood.id ? "PASS" : "BLOCK",
        "RPC network",
        chainId === robinhood.id
          ? `RPC reports chain ${chainId} at block ${head}.`
          : `RPC reports chain ${chainId}; expected ${robinhood.id}.`,
      );
      const canonical = decimals === USDG_DECIMALS && symbol === USDG_SYMBOL;
      add(
        canonical ? "PASS" : "BLOCK",
        "USDG contract",
        canonical
          ? `${ROBINHOOD_USDG_ADDRESS} reports ${symbol}/${decimals}.`
          : "Canonical USDG metadata verification failed.",
      );
      if (treasury) {
        const [gasBalance, tokenBalance, fees] = await Promise.all([
          client.getBalance({ address: treasury }),
          client.readContract({
            address: ROBINHOOD_USDG_ADDRESS,
            abi: USDG_ABI,
            functionName: "balanceOf",
            args: [treasury],
          }),
          client.estimateFeesPerGas(),
        ]);
        const gasCost =
          BigInt(100_000) *
          (fees.maxFeePerGas ?? fees.gasPrice ?? BigInt(0));
        const funded =
          tokenBalance >= parseUnits("1", USDG_DECIMALS) &&
          gasBalance >= gasCost;
        add(
          funded ? "PASS" : "BLOCK",
          "Treasury reserves",
          `${formatUnits(tokenBalance, USDG_DECIMALS)} USDG and ${formatEther(gasBalance)} ETH available; at least 1 USDG plus refund gas is required.`,
        );
      } else {
        add(
          "BLOCK",
          "Treasury reserves",
          "Cannot verify USDG and ETH reserves without the production treasury key.",
        );
      }
    } catch (error) {
      add(
        "BLOCK",
        "RPC and reserves",
        safeErrorDetail(error, "RPC readiness check failed."),
      );
    }
  } else {
    add("BLOCK", "RPC and reserves", "No valid HTTPS RPC endpoint is configured.");
  }

  let appOrigin: URL | null = null;
  try {
    appOrigin = process.env.NEXT_PUBLIC_APP_URL
      ? new URL(process.env.NEXT_PUBLIC_APP_URL)
      : null;
  } catch {
    appOrigin = null;
  }
  const productionOrigin = Boolean(
    appOrigin &&
      appOrigin.protocol === "https:" &&
      appOrigin.hostname !== "localhost" &&
      appOrigin.hostname !== "127.0.0.1",
  );
  add(
    productionOrigin ? "PASS" : "BLOCK",
    "Application origin",
    productionOrigin
      ? `HTTPS origin configured for ${appOrigin!.hostname}.`
      : "NEXT_PUBLIC_APP_URL must be the production HTTPS origin.",
  );

  add(
    Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim()) ? "PASS" : "BLOCK",
    "WalletConnect",
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim()
      ? "Project ID configured."
      : "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is missing.",
  );
  add(
    Boolean(process.env.PAYMENT_WEBHOOK_SECRET?.trim()) ? "PASS" : "BLOCK",
    "Service secret",
    process.env.PAYMENT_WEBHOOK_SECRET?.trim()
      ? "PAYMENT_WEBHOOK_SECRET is configured."
      : "PAYMENT_WEBHOOK_SECRET is missing.",
  );
  add(
    process.env.PLAY_MAINNET_ENABLED === "true" ? "PASS" : "BLOCK",
    "Release gate",
    process.env.PLAY_MAINNET_ENABLED === "true"
      ? "PLAY_MAINNET_ENABLED=true."
      : "Release gate is closed. Keep it closed until every other blocker passes.",
  );

  for (const check of checks) {
    console.log(`[${check.status}] ${check.name}: ${check.detail}`);
  }
  const blockers = checks.filter((check) => check.status === "BLOCK").length;
  const warnings = checks.filter((check) => check.status === "WARN").length;
  console.log(`\nMainnet readiness: ${blockers} blocker(s), ${warnings} warning(s).`);
  if (blockers) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Readiness check failed.");
  process.exitCode = 1;
});
