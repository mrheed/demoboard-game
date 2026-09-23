import { and, eq } from "drizzle-orm";

import { getDb } from "@/server/db";
import { transactions } from "@/server/db/schema";
import {
  getMockPendingWithdraw,
  upsertMockWithdraw,
  WithdrawError,
  type WithdrawResult,
} from "@/server/services/withdraw.service";
import { getUserBalance } from "@/server/services/balance.service";
import { isDbConfigured as dbConfigured } from "@/server/lib/db-config";
import {
  applyBalanceDelta,
  lockAvailable,
} from "@/server/db/repositories/balances.repository";

export type ProcessWithdrawInput = {
  transactionId: string;
  txHash?: string;
  fail?: boolean;
};

/**
 * Process a pending withdraw: debit available balance and mark confirmed, or
 * mark failed without debiting. Call after the chain send is accepted/rejected.
 */
export async function processWithdraw(
  input: ProcessWithdrawInput,
): Promise<WithdrawResult> {
  if (!dbConfigured()) {
    const pending = getMockPendingWithdraw(input.transactionId);
    if (!pending) {
      throw new WithdrawError("Withdraw not found.", 404);
    }
    if (pending.status !== "pending") {
      throw new WithdrawError("Withdraw is no longer pending.", 409);
    }
    if (!input.fail && (!input.txHash || !/^0x[a-fA-F0-9]{64}$/.test(input.txHash))) {
      throw new WithdrawError("A confirmed 32-byte transaction hash is required.", 400);
    }

    const absolute = Math.abs(pending.amount);
    const balance = await getUserBalance("u_me");
    const available = balance?.available ?? 0;

    if (!input.fail && absolute > available) {
      throw new WithdrawError(
        `Insufficient available balance. You can withdraw up to ${available} BOARD.`,
        400,
      );
    }

    const next: WithdrawResult["transaction"] = {
      ...pending,
      status: input.fail ? "failed" : "confirmed",
      txHash: input.fail
        ? null
        : input.txHash!.toLowerCase(),
      note: input.fail ? "Withdraw rejected by mock processor" : pending.note,
    };
    upsertMockWithdraw(next);

    return {
      transaction: next,
      availableAfter: input.fail ? available : available - absolute,
      source: "mock",
    };
  }

  const db = getDb();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, input.transactionId),
          eq(transactions.type, "withdraw"),
        ),
      )
      .limit(1)
      .for("update");

    if (!row) {
      throw new WithdrawError("Withdraw not found.", 404);
    }
    if (row.status !== "pending") {
      throw new WithdrawError("Withdraw is no longer pending.", 409);
    }

    const absolute = Math.abs(Number(row.amount));

    // Locks each balance table separately. A single `FOR UPDATE` over the
    // LEFT JOIN these columns used to share is rejected by Postgres (0A000,
    // nullable side of an outer join), which made every database-backed
    // withdraw fail with a 500.
    const available = await lockAvailable(tx, row.userId);

    if (input.fail) {
      const availableAfter = row.fundsReserved
        ? await applyBalanceDelta(tx, row.userId, absolute)
        : available;
      const [updated] = await tx
        .update(transactions)
        .set({
          status: "failed",
          note: "Withdraw rejected by processor",
          fundsReserved: false,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, row.id))
        .returning();

      return {
        transaction: mapRow(updated),
        availableAfter,
        source: "database" as const,
      };
    }

    if (!input.txHash || !/^0x[a-fA-F0-9]{64}$/.test(input.txHash)) {
      throw new WithdrawError("A confirmed 32-byte transaction hash is required.", 400);
    }

    if (!row.fundsReserved && absolute > available) {
      throw new WithdrawError(
        `Insufficient available balance. You can withdraw up to ${available} BOARD.`,
        400,
      );
    }

    const [updated] = await tx
      .update(transactions)
      .set({
        status: "confirmed",
        txHash: input.txHash.toLowerCase(),
        fundsReserved: false,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, row.id))
      .returning();

    const availableAfter = row.fundsReserved
      ? available
      : await applyBalanceDelta(tx, row.userId, -absolute);

    return {
      transaction: mapRow(updated),
      availableAfter,
      source: "database" as const,
    };
  });
}

function mapRow(
  row: typeof transactions.$inferSelect,
): WithdrawResult["transaction"] {
  return {
    id: row.id,
    type: "withdraw",
    status: row.status,
    amount: Number(row.amount),
    chain: row.chain,
    walletAddress: row.walletAddress,
    txHash: row.txHash,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}
