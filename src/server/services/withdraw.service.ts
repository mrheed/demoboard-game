import { MOCK_BALANCE, MOCK_PLAYER } from "@/lib/mock/lobby";
import { parseBoardAmount } from "@/lib/money";
import { ROBINHOOD_CHAIN_LABEL } from "@/lib/wallet/chains";
import { getDb } from "@/server/db";
import { transactions, wallets } from "@/server/db/schema";
import { applyBalanceDelta, lockAvailable } from "@/server/db/repositories/balances.repository";
import { getUserBalance } from "@/server/services/balance.service";
import { isDbConfigured as dbConfigured } from "@/server/lib/db-config";
import { defineServiceError } from "@/server/lib/service-error";
import { and, eq, isNotNull } from "drizzle-orm";

export type WithdrawRequest = {
  userId: string;
  amount: number;
  walletAddress?: string;
};

export type WithdrawResult = {
  transaction: {
    id: string;
    type: "withdraw";
    status: "pending" | "confirmed" | "failed";
    amount: number;
    chain: string;
    walletAddress: string | null;
    txHash: string | null;
    note: string | null;
    createdAt: string;
  };
  availableAfter: number;
  source: "database" | "mock";
};

const mockWithdraws = new Map<string, WithdrawResult["transaction"]>();

export const WithdrawError = defineServiceError("WithdrawError");

/**
 * Open a withdraw with balance validation. Creates a `pending` ledger row
 * (negative amount). Balance debit is applied by the process service.
 */
export async function createPendingWithdraw(
  input: WithdrawRequest,
): Promise<WithdrawResult> {
  const amount = parseBoardAmount(input.amount);
  if (amount === null) {
    throw new WithdrawError("Amount must be positive with at most two decimal places.", 400);
  }
  if (input.walletAddress && !/^0x[a-fA-F0-9]{40}$/.test(input.walletAddress)) {
    throw new WithdrawError("A valid EVM withdrawal address is required.", 400);
  }

  if (!dbConfigured()) {
    if (input.userId !== MOCK_PLAYER.id && input.userId !== "me") {
      throw new WithdrawError("User not found.", 404);
    }
    const balance = await getUserBalance(input.userId);
    if (!balance) throw new WithdrawError("User not found.", 404);

    const alreadyReserved = [...mockWithdraws.values()]
      .filter((row) => row.status === "pending")
      .reduce((sum, row) => sum + Math.abs(row.amount), 0);
    const available = balance.available - alreadyReserved;
    if (amount > available) {
      throw new WithdrawError(`Insufficient available balance. You can withdraw up to ${available} BOARD.`, 400);
    }

    const id = `wd_${Date.now().toString(36)}`;
    const transaction: WithdrawResult["transaction"] = {
      id,
      type: "withdraw",
      status: "pending",
      amount: -amount,
      chain: MOCK_BALANCE.chain,
      walletAddress: input.walletAddress ?? MOCK_BALANCE.address,
      txHash: null,
      note: "Platform → wallet",
      createdAt: new Date().toISOString(),
    };
    mockWithdraws.set(id, transaction);

    return {
      transaction,
      availableAfter: available - amount,
      source: "mock",
    };
  }

  return getDb().transaction(async (tx) => {
    const available = await lockAvailable(tx, input.userId);
    if (amount > available) {
      throw new WithdrawError(`Insufficient available balance. You can withdraw up to ${available} BOARD.`, 400);
    }
    const [primaryWallet] = await tx
      .select({ address: wallets.address, chain: wallets.chain })
      .from(wallets)
      .where(and(
        eq(wallets.userId, input.userId),
        eq(wallets.isPrimary, true),
        isNotNull(wallets.verifiedAt),
      ))
      .limit(1);
    const walletAddress = input.walletAddress?.toLowerCase() ?? primaryWallet?.address;
    if (!walletAddress) {
      throw new WithdrawError("Verify a primary wallet or provide a withdrawal address.", 400);
    }
    const availableAfter = await applyBalanceDelta(tx, input.userId, -amount);
    const [row] = await tx.insert(transactions).values({
      userId: input.userId,
      type: "withdraw",
      status: "pending",
      amount: (-amount).toFixed(2),
      chain: primaryWallet?.chain ?? ROBINHOOD_CHAIN_LABEL,
      walletAddress,
      fundsReserved: true,
      note: "Platform → wallet",
    }).returning();
    return {
      transaction: {
        id: row.id,
        type: "withdraw" as const,
        status: row.status,
        amount: Number(row.amount),
        chain: row.chain,
        walletAddress: row.walletAddress,
        txHash: row.txHash,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      },
      availableAfter,
      source: "database" as const,
    };
  });
}

export function getMockPendingWithdraw(id: string) {
  return mockWithdraws.get(id) ?? null;
}

export function upsertMockWithdraw(tx: WithdrawResult["transaction"]) {
  mockWithdraws.set(tx.id, tx);
}
