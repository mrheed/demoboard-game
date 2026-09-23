import { and, eq } from "drizzle-orm";

import { getDb } from "@/server/db";
import { transactions } from "@/server/db/schema";
import {
  DepositError,
  getMockPendingDeposit,
  upsertMockDeposit,
  type DepositResult,
} from "@/server/services/deposit.service";
import { isDbConfigured as dbConfigured } from "@/server/lib/db-config";
import { applyBalanceDelta } from "@/server/db/repositories/balances.repository";

export type ConfirmDepositInput = {
  transactionId: string;
  txHash?: string;
  eventIndex?: number;
  amount?: number;
  chain?: string;
  walletAddress?: string;
  asset?: string;
  /** When true, mark the deposit failed instead of confirming. */
  fail?: boolean;
};

/**
 * Confirm (or fail) a pending deposit and credit `user_balances` / `users.balance`
 * when successful. Stands in for a chain listener until Robinhood RPC hooks land.
 */
export async function confirmDeposit(
  input: ConfirmDepositInput,
): Promise<DepositResult> {
  if (!dbConfigured()) {
    const pending = getMockPendingDeposit(input.transactionId);
    if (!pending) {
      throw new DepositError("Deposit not found.", 404);
    }
    if (pending.status !== "pending") {
      throw new DepositError("Deposit is no longer pending.", 409);
    }
    if (!input.fail) assertDepositProof(input, pending);
    const txHash = input.txHash?.toLowerCase();

    const next: DepositResult["transaction"] = {
      ...pending,
      status: input.fail ? "failed" : "confirmed",
      txHash: input.fail
        ? null
        : txHash!,
      txEventIndex: input.fail ? null : input.eventIndex!,
      note: input.fail
        ? "Rejected by mock chain listener"
        : pending.note,
    };
    upsertMockDeposit(next);

    // Mock mode records the confirmation on the ledger only; MOCK_BALANCE is a
    // constant, so there is no mock balance to credit.
    return { transaction: next, source: "mock" };
  }

  const db = getDb();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, input.transactionId),
          eq(transactions.type, "deposit"),
        ),
      )
      .limit(1)
      .for("update");

    if (!row) {
      throw new DepositError("Deposit not found.", 404);
    }
    if (row.status !== "pending") {
      throw new DepositError("Deposit is no longer pending.", 409);
    }

    if (input.fail) {
      const [updated] = await tx
        .update(transactions)
        .set({
          status: "failed",
          note: "Rejected by chain listener",
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, row.id))
        .returning();

      return {
        transaction: mapRow(updated),
        source: "database" as const,
      };
    }

    assertDepositProof(input, mapRow(row));

    const amount = Number(row.amount);
    const txHash = input.txHash!.toLowerCase();

    const [updated] = await tx
      .update(transactions)
      .set({
        status: "confirmed",
        txHash,
        txEventIndex: input.eventIndex!,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, row.id))
      .returning();

    await applyBalanceDelta(tx, row.userId, amount);

    return {
      transaction: mapRow(updated),
      source: "database" as const,
    };
  }).catch((error: unknown) => {
    if (error instanceof DepositError) throw error;
    const databaseCode = (error as { code?: string; cause?: { code?: string } })?.code
      ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (databaseCode === "23505") {
      throw new DepositError("This chain event has already been credited.", 409);
    }
    throw error;
  });
}

function assertDepositProof(
  input: ConfirmDepositInput,
  pending: DepositResult["transaction"],
) {
  if (!input.txHash || !/^0x[a-fA-F0-9]{64}$/.test(input.txHash)) {
    throw new DepositError("A confirmed 32-byte transaction hash is required.", 400);
  }
  if (!Number.isInteger(input.eventIndex) || input.eventIndex! < 0) {
    throw new DepositError("A non-negative chain event index is required.", 400);
  }
  if (input.asset !== "BOARD") {
    throw new DepositError("Deposit proof asset must be BOARD.", 409);
  }
  if (input.amount !== pending.amount || input.chain !== pending.chain) {
    throw new DepositError("Deposit proof amount or chain does not match the pending deposit.", 409);
  }
  if (!input.walletAddress || input.walletAddress.toLowerCase() !== pending.walletAddress?.toLowerCase()) {
    throw new DepositError("Deposit proof wallet does not match the pending deposit.", 409);
  }
}

function mapRow(row: typeof transactions.$inferSelect): DepositResult["transaction"] {
  return {
    id: row.id,
    type: "deposit",
    status: row.status,
    amount: Number(row.amount),
    chain: row.chain,
    walletAddress: row.walletAddress,
    txHash: row.txHash,
    txEventIndex: row.txEventIndex,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}
