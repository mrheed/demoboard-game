/**
 * On-chain payment status webhook · verifies / updates reward payouts
 * (and optionally wallet deposit/withdraw ledger rows) from a chain listener.
 */
import { and, eq } from "drizzle-orm";

import { getDb } from "@/server/db";
import type { DbTx } from "@/server/db/types";
import {
  feeLedger,
  rewardPayouts,
  transactions,
} from "@/server/db/schema";
import { isDbConfigured as dbConfigured } from "@/server/lib/db-config";
import { defineServiceError } from "@/server/lib/service-error";
import { confirmDeposit } from "@/server/services/deposit-confirm.service";
import { processWithdraw } from "@/server/services/withdraw-process.service";

export const PaymentWebhookError = defineServiceError("PaymentWebhookError");

export type PaymentWebhookKind = "reward_payout" | "deposit" | "withdraw";

export type PaymentWebhookStatus = "paid" | "confirmed" | "failed";

export type ProcessPaymentWebhookInput = {
  kind: PaymentWebhookKind;
  /** reward_payouts.id or transactions.id */
  id: string;
  status: PaymentWebhookStatus;
  txHash?: string;
  eventIndex?: number;
  amount?: number;
  chain?: string;
  walletAddress?: string;
  asset?: string;
  /** Optional fee ledger proofs when confirming a reward payout. */
  treasuryTxHash?: string;
  burnTxHash?: string;
  burnProofUri?: string;
};

export type ProcessPaymentWebhookResult = {
  kind: PaymentWebhookKind;
  id: string;
  status: string;
  txHash: string | null;
  source: "database" | "mock";
};

function normalizePayoutStatus(
  status: PaymentWebhookStatus,
): "paid" | "failed" {
  if (status === "failed") return "failed";
  return "paid";
}

function normalizeTxStatus(
  status: PaymentWebhookStatus,
): "confirmed" | "failed" {
  if (status === "failed") return "failed";
  return "confirmed";
}

/**
 * Apply an on-chain payment verification event to reward_payouts or
 * wallet transactions. Idempotent when status/txHash are already set.
 */
export async function processPaymentWebhook(
  input: ProcessPaymentWebhookInput,
): Promise<ProcessPaymentWebhookResult> {
  const canonical = {
    ...input,
    txHash: input.txHash?.toLowerCase(),
    treasuryTxHash: input.treasuryTxHash?.toLowerCase(),
    burnTxHash: input.burnTxHash?.toLowerCase(),
    walletAddress: input.walletAddress?.toLowerCase(),
  };
  if (canonical.kind === "reward_payout") {
    return confirmRewardPayout(canonical);
  }
  return confirmWalletTransaction(canonical);
}

async function confirmRewardPayout(
  input: ProcessPaymentWebhookInput,
): Promise<ProcessPaymentWebhookResult> {
  const nextStatus = normalizePayoutStatus(input.status);
  if (nextStatus === "paid" && (!input.txHash || !/^0x[a-fA-F0-9]{64}$/.test(input.txHash))) {
    throw new PaymentWebhookError("A confirmed 32-byte payout transaction hash is required.", 400);
  }
  for (const [label, hash] of [["treasury", input.treasuryTxHash], ["burn", input.burnTxHash]] as const) {
    if (hash && !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      throw new PaymentWebhookError(`A valid 32-byte ${label} transaction hash is required.`, 400);
    }
  }
  const txHash = nextStatus === "failed" ? null : input.txHash!;

  if (!dbConfigured()) {
    return {
      kind: "reward_payout",
      id: input.id,
      status: nextStatus,
      txHash,
      source: "mock",
    };
  }

  const db = getDb();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(rewardPayouts)
      .where(eq(rewardPayouts.id, input.id))
      .limit(1)
      .for("update");

    if (!row) {
      throw new PaymentWebhookError("Reward payout not found.", 404);
    }

    if (row.status === "failed") {
      throw new PaymentWebhookError("Payout already marked failed.", 409);
    }

    if (row.status === "paid") {
      // Settlement is monotonic. A late failure must never erase confirmed
      // payment state, and a different payout hash is a conflicting event.
      if (nextStatus === "failed") return mapRewardResult(row);
      if (input.txHash !== row.txHash) {
        throw new PaymentWebhookError("Payout is already confirmed with a different transaction hash.", 409);
      }
      await attachRewardProofs(tx, row.id, input);
      return {
        kind: "reward_payout" as const,
        id: row.id,
        status: row.status,
        txHash: row.txHash,
        source: "database" as const,
      };
    }

    const now = new Date();
    const [updated] = await tx
      .update(rewardPayouts)
      .set({
        status: nextStatus,
        txHash,
        paidAt: nextStatus === "paid" ? (row.paidAt ?? now) : row.paidAt,
        note:
          nextStatus === "failed"
            ? "Rejected by on chain payment webhook"
            : (row.note ?? "Confirmed on chain"),
      })
      .where(eq(rewardPayouts.id, row.id))
      .returning();

    if (nextStatus === "paid" && txHash) {
      await tx
        .update(transactions)
        .set({
          status: "confirmed",
          txHash,
          updatedAt: now,
        })
        .where(
          and(
            eq(transactions.referenceId, row.matchId),
            eq(transactions.type, "payout"),
            eq(transactions.userId, row.winnerUserId),
          ),
        );

      await attachRewardProofs(tx, row.id, input);
    }

    if (nextStatus === "failed") {
      await tx
        .update(transactions)
        .set({
          status: "failed",
          note: "Rejected by on chain payment webhook",
          updatedAt: now,
        })
        .where(
          and(
            eq(transactions.referenceId, row.matchId),
            eq(transactions.type, "payout"),
            eq(transactions.userId, row.winnerUserId),
          ),
        );
    }

    return {
      kind: "reward_payout" as const,
      id: updated.id,
      status: updated.status,
      txHash: updated.txHash,
      source: "database" as const,
    };
  });
}

async function confirmWalletTransaction(
  input: ProcessPaymentWebhookInput,
): Promise<ProcessPaymentWebhookResult> {
  const nextStatus = normalizeTxStatus(input.status);
  const expectedType = input.kind === "deposit" ? "deposit" : "withdraw";

  if (!dbConfigured()) {
    return {
      kind: input.kind,
      id: input.id,
      status: nextStatus,
      txHash: nextStatus === "failed" ? null : (input.txHash ?? null),
      source: "mock",
    };
  }

  const settled = await settledTransaction(input.id, expectedType, nextStatus, input.txHash);
  if (settled) return settled;

  // Delegate to the same services the direct confirm/process endpoints call.
  // An earlier version updated `transactions.status` here and moved no money,
  // so a deposit confirmed through the webhook was never credited and could
  // not be confirmed again through the other path.
  const fail = nextStatus === "failed";
  const result =
    input.kind === "deposit"
      ? await confirmDeposit({
          transactionId: input.id,
          txHash: input.txHash,
          eventIndex: input.eventIndex,
          amount: input.amount,
          chain: input.chain,
          walletAddress: input.walletAddress,
          asset: input.asset,
          fail,
        })
      : await processWithdraw({
          transactionId: input.id,
          txHash: input.txHash,
          fail,
        });

  return {
    kind: input.kind,
    id: result.transaction.id,
    status: result.transaction.status,
    txHash: result.transaction.txHash,
    source: result.source,
  };
}

/**
 * Absorb the provider's retries: a row already in the status this delivery
 * implies is returned unchanged instead of being settled twice. Returns null
 * when the row still needs processing.
 */
async function settledTransaction(
  id: string,
  expectedType: "deposit" | "withdraw",
  nextStatus: "confirmed" | "failed",
  txHash?: string,
): Promise<ProcessPaymentWebhookResult | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.type, expectedType)))
    .limit(1);

  if (!row) {
    throw new PaymentWebhookError(`${expectedType} not found.`, 404);
  }

  if (row.status === "pending") return null;

  if (row.status !== nextStatus) {
    throw new PaymentWebhookError(`${expectedType} is no longer pending.`, 409);
  }
  if (row.status === "confirmed" && txHash && row.txHash !== txHash) {
    throw new PaymentWebhookError(`${expectedType} is already confirmed with a different transaction hash.`, 409);
  }

  return {
    kind: expectedType,
    id: row.id,
    status: row.status,
    txHash: row.txHash,
    source: "database",
  };
}

function mapRewardResult(row: typeof rewardPayouts.$inferSelect): ProcessPaymentWebhookResult {
  return { kind: "reward_payout", id: row.id, status: row.status, txHash: row.txHash, source: "database" };
}

async function attachRewardProofs(
  tx: DbTx,
  rewardPayoutId: string,
  input: ProcessPaymentWebhookInput,
) {
  if (input.treasuryTxHash) {
    await tx.update(feeLedger).set({ txHash: input.treasuryTxHash }).where(and(
      eq(feeLedger.rewardPayoutId, rewardPayoutId), eq(feeLedger.kind, "treasury"),
    ));
  }
  if (input.burnTxHash) {
    await tx.update(feeLedger).set({
      txHash: input.burnTxHash,
      ...(input.burnProofUri ? { proofUri: input.burnProofUri } : {}),
    }).where(and(
      eq(feeLedger.rewardPayoutId, rewardPayoutId), eq(feeLedger.kind, "burn"),
    ));
  }
}
