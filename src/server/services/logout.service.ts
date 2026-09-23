/**
 * Logout + revoke sessions (current device or all devices).
 */
import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/server/db";
import { sessions } from "@/server/db/schema";
import { hashSessionToken } from "@/server/lib/session-token";
import { isDbConfigured as dbConfigured } from "@/server/lib/db-config";

export class SessionRevokeError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SessionRevokeError";
    this.status = status;
  }
}

export type LogoutResult = {
  revoked: number;
  scope: "current" | "all";
  source: "database" | "mock";
};

/**
 * Revoke the current session (by raw token) and/or every session for the user.
 */
export async function logoutSessions(input: {
  userId: string;
  token?: string | null;
  /** When true, revoke every active session for the user. */
  allDevices?: boolean;
}): Promise<LogoutResult> {
  const allDevices = Boolean(input.allDevices);

  if (!dbConfigured()) {
    const { clearMockWalletSession, clearMockWalletSessionsForUser } = await import(
      "@/server/services/wallet-auth.service"
    );
    const revoked = allDevices
      ? clearMockWalletSessionsForUser(input.userId)
      : input.token?.trim()
        ? clearMockWalletSession(input.token.trim())
        : 0;
    return {
      revoked,
      scope: allDevices ? "all" : "current",
      source: "mock",
    };
  }

  const db = getDb();
  const now = new Date();

  if (allDevices) {
    const revoked = await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, input.userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });

    return {
      revoked: revoked.length,
      scope: "all",
      source: "database",
    };
  }

  if (!input.token?.trim()) {
    throw new SessionRevokeError("No active session token to revoke.", 401);
  }

  const tokenHash = hashSessionToken(input.token.trim());
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(sessions.userId, input.userId),
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
      ),
    )
    .returning({ id: sessions.id });

  if (revoked.length === 0) {
    // Idempotent logout · treat missing/already-revoked as success.
    return { revoked: 0, scope: "current", source: "database" };
  }

  return { revoked: revoked.length, scope: "current", source: "database" };
}
