/**
 * Wallet-only auth: challenge + signature → find/create user → session.
 */
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { verifyMessage } from "viem";

import {
  ROBINHOOD_CHAIN_LABEL,
  shortenAddress,
} from "@/lib/wallet/chains";
import { buildWalletVerifyMessage } from "@/lib/wallet/siwe";
import { getDb } from "@/server/db";
import { sessions, userBalances, users, wallets } from "@/server/db/schema";
import {
  AuthError,
  mapUser,
  type AuthSessionResult,
  type AuthUserView,
} from "@/server/services/auth.service";
import {
  createSessionToken,
  hashSessionToken,
  sessionExpiryDate,
} from "@/server/lib/session-token";
import { isDbConfigured as dbConfigured } from "@/server/lib/db-config";
import { withPlayDocument } from "@/server/lib/play-store";
import { withWalletIdentity, WALLET_OWNERSHIP_VERSION, assertWalletAccount } from "@/server/lib/wallet-identity";

type Challenge = {
  nonce: string;
  expiresAt: number;
};

type ChallengeStore = {
  challenges: Record<string, Challenge>;
};


/** Mock-mode sessions keyed by raw token. */
const mockWalletSessions = new Map<
  string,
  { user: AuthUserView; address: string; expiresAt: number }
>();

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_ACTIVE_CHALLENGES = 4_096;
const CHALLENGE_STORE_KEY = "wallet-challenges-v2";

function pruneChallenges(store: ChallengeStore, now: number) {
  for (const [address, challenge] of Object.entries(store.challenges)) {
    if (!challenge || challenge.expiresAt <= now) delete store.challenges[address];
  }
}

function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    throw new AuthError("Invalid EVM wallet address.");
  }
  return trimmed.toLowerCase();
}

function usernameFromAddress(address: string): string {
  const hex = address.slice(2, 10).toLowerCase();
  return `w_${hex}`;
}

function displayNameFromAddress(address: string): string {
  return shortenAddress(address, 4);
}

function allowMockSignature() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_MOCK_WALLET_VERIFY === "true"
  );
}

async function assertSignature(input: {
  address: string;
  nonce: string;
  signature: string;
  message: string;
}) {
  const expected = buildWalletVerifyMessage({
    address: input.address,
    nonce: input.nonce,
  });
  if (input.message.trim() !== expected) {
    throw new AuthError("Signed message does not match login challenge.", 401);
  }

  if (allowMockSignature() && input.signature === "mock-signed") {
    return;
  }

  let valid = false;
  try {
    valid = await verifyMessage({
      address: input.address as `0x${string}`,
      message: input.message,
      signature: input.signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }

  if (!valid) {
    throw new AuthError("Invalid wallet signature.", 401);
  }
}

async function insertSession(
  userId: string,
  meta: { userAgent?: string; ipAddress?: string; address: string },
) {
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = sessionExpiryDate();
  const db = getDb();

  await db.insert(sessions).values({
    userId,
    tokenHash,
    walletAddress: meta.address.toLowerCase(),
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ipAddress ?? null,
    expiresAt,
    lastSeenAt: new Date(),
  });

  return { token, expiresAt };
}

/**
 * Issue a one-time login challenge for an address.
 */
export async function issueWalletLoginChallenge(addressRaw: string) {
  const address = normalizeAddress(addressRaw);
  const challenge = await withPlayDocument<ChallengeStore, Challenge>(CHALLENGE_STORE_KEY, () => ({ challenges: {} }), async (document) => {
    const now = Date.now();
    pruneChallenges(document, now);
    // Anonymous challenge requests must not invalidate an outstanding signature.
    if (!document.challenges[address]) {
      if (Object.keys(document.challenges).length >= MAX_ACTIVE_CHALLENGES) {
        // Keep storage bounded without letting an attacker lock every new
        // address out until the full TTL elapses. An evicted wallet can safely
        // request a fresh one-time challenge.
        const oldest = Object.entries(document.challenges)
          .sort(([, left], [, right]) => left.expiresAt - right.expiresAt)[0]?.[0];
        if (oldest) delete document.challenges[oldest];
      }
      document.challenges[address] = { nonce: `board-${randomBytes(16).toString("hex")}`, expiresAt: now + CHALLENGE_TTL_MS };
    }
    return document.challenges[address]!;
  });
  const { nonce, expiresAt } = challenge;

  const message = buildWalletVerifyMessage({ address, nonce });
  return {
    address,
    nonce,
    message,
    chain: ROBINHOOD_CHAIN_LABEL,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

async function consumeChallenge(address: string, message: string, signature: string) {
  return withPlayDocument<ChallengeStore, string>(
    CHALLENGE_STORE_KEY, () => ({ challenges: {} }), async (document) => {
      const now = Date.now();
      pruneChallenges(document, now);
      const challenge = document.challenges[address];
      if (!challenge || challenge.expiresAt < Date.now()) {
        throw new AuthError("Login challenge expired. Request a new one.", 401);
      }
      const expected = buildWalletVerifyMessage({ address, nonce: challenge.nonce });
      if (message.trim() !== expected) {
        throw new AuthError("Signed message does not match login challenge.", 401);
      }
      await assertSignature({ address, nonce: challenge.nonce, message, signature });
      delete document.challenges[address];
      return challenge.nonce;
    },
  );
}

/**
 * Verify wallet signature, find or create the user, issue a session.
 */
export async function loginWithWallet(input: {
  address: string;
  signature: string;
  message: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<
  AuthSessionResult & {
    wallet: { address: string; chain: string; verified: boolean };
  }
> {
  const address = normalizeAddress(input.address);
  const signature = input.signature.trim();
  if (!signature) {
    throw new AuthError("signature is required.");
  }

  await consumeChallenge(address, input.message, signature);

  if (!dbConfigured()) {
    const token = `mock_${createSessionToken()}`;
    const expiresAt = sessionExpiryDate();
    const user: AuthUserView = {
      id: `wal_${address.slice(2, 10)}`,
      username: usernameFromAddress(address),
      email: null,
      avatarId: "pawn-gold",
      balance: 0,
    };
    mockWalletSessions.set(token, { user, address, expiresAt: expiresAt.getTime() });
    return {
      user,
      session: {
        token,
        expiresAt: expiresAt.toISOString(),
      },
      source: "mock",
      wallet: {
        address,
        chain: ROBINHOOD_CHAIN_LABEL,
        verified: true,
      },
    };
  }

  const now = new Date();
  const chain = ROBINHOOD_CHAIN_LABEL;

  const result = await withWalletIdentity(address, async (tx) => {
    const [existingWallet] = await tx
      .select()
      .from(wallets)
      .where(and(eq(wallets.chain, chain), eq(wallets.address, address)))
      .limit(1);

    let userRow: typeof users.$inferSelect;

    if (existingWallet?.verifiedAt) {
      if (existingWallet.ownershipVersion !== WALLET_OWNERSHIP_VERSION)
        throw new AuthError("Legacy wallet ownership requires review. Your funds and matches are preserved; contact support.", 403);
      userRow = await assertWalletAccount(tx, existingWallet.userId);
    } else {
      const baseName = usernameFromAddress(address);
      let username = baseName;
      for (let i = 0; i < 5; i++) {
        const [clash] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.username, username))
          .limit(1);
        if (!clash) break;
        username = `${baseName}_${randomBytes(2).toString("hex")}`;
      }

      const [created] = await tx
        .insert(users)
        .values({
          username,
          email: null,
          passwordHash: null,
          avatarId: "pawn-gold",
          balance: "0",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      userRow = created;

      await tx.insert(userBalances).values({
        userId: created.id,
        available: "0",
        chain,
        walletAddress: address,
        updatedAt: now,
      });

      const verifiedWallet = {
        userId: created.id,
        address,
        chain,
        isPrimary: true,
        verifiedAt: now,
        ownershipVersion: WALLET_OWNERSHIP_VERSION,
        verifyNonce: null,
        verifyExpiresAt: null,
        pendingPrimary: false,
        label: displayNameFromAddress(address),
        createdAt: now,
        updatedAt: now,
      };
      // A pending address reservation proves no ownership of its user account.
      if (existingWallet) await tx.update(wallets).set(verifiedWallet).where(eq(wallets.id, existingWallet.id));
      else await tx.insert(wallets).values(verifiedWallet);
    }

    if (!existingWallet?.verifiedAt || existingWallet.isPrimary) await tx
      .insert(userBalances)
      .values({
        userId: userRow.id,
        available: "0",
        chain,
        walletAddress: address,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userBalances.userId,
        set: {
          walletAddress: address,
          chain,
          updatedAt: now,
        },
      });

    return userRow;
  });

  const session = await insertSession(result.id, input);

  return {
    user: mapUser(result),
    session: {
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
    },
    source: "database",
    wallet: {
      address,
      chain,
      verified: true,
    },
  };
}

/**
 * Resolve mock wallet sessions created without DATABASE_URL.
 */
export function resolveMockWalletSession(token: string) {
  const session = mockWalletSessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    mockWalletSessions.delete(token);
    return null;
  }
  return session;
}

export function clearMockWalletSession(token: string) {
  return mockWalletSessions.delete(token) ? 1 : 0;
}

export function clearMockWalletSessionsForUser(userId: string) {
  let revoked = 0;
  for (const [token, session] of mockWalletSessions) {
    if (session.user.id !== userId) continue;
    mockWalletSessions.delete(token);
    revoked += 1;
  }
  return revoked;
}
