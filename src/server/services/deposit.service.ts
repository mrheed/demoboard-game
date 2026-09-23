import { eq } from "drizzle-orm";

import { MOCK_PLAYER, MOCK_BALANCE } from "@/lib/mock/lobby";
import { getDb } from "@/server/db";
import { transactions, users } from "@/server/db/schema";
import { isDbConfigured as dbConfigured } from "@/server/lib/db-config";
import { parseBoardAmount } from "@/lib/money";
import { defineServiceError } from "@/server/lib/service-error";

export type DepositRequest = {
  userId: string;
  amount: number;
  walletAddress?: string;
};

export type DepositResult = {
  transaction: {
    id: string;
    type: "deposit";
    status: "pending" | "confirmed" | "failed";
    amount: number;
    chain: string;
    walletAddress: string | null;
    txHash: string | null;
    txEventIndex: number | null;
    note: string | null;
    createdAt: string;
  };
  source: "database" | "mock";
};

const mockDeposits = new Map<string, DepositResult["transaction"]>();

/**
 * Create a deposit ledger row in `pending` status. Balance is credited only
 * after confirmation (see confirmDeposit).
 */
export async function createPendingDeposit(
  input: DepositRequest,
): Promise<DepositResult> {
  const amount = parseBoardAmount(input.amount);
  if (amount === null) {
    throw new DepositError("Amount must be positive with at most two decimal places.", 400);
  }
  if (!input.walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(input.walletAddress)) {
    throw new DepositError("A valid EVM wallet address is required.", 400);
  }

  if (!dbConfigured()) {
    if (input.userId !== MOCK_PLAYER.id && input.userId !== "me") {
      throw new DepositError("User not found.", 404);
    }

    const id = `dep_${Date.now().toString(36)}`;
    const transaction: DepositResult["transaction"] = {
      id,
      type: "deposit",
      status: "pending",
      amount,
      chain: MOCK_BALANCE.chain,
      walletAddress: input.walletAddress ?? MOCK_BALANCE.address,
      txHash: null,
      txEventIndex: null,
      note: "Wallet → platform",
      createdAt: new Date().toISOString(),
    };
    mockDeposits.set(id, transaction);
    return { transaction, source: "mock" };
  }

  const db = getDb();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user) {
    throw new DepositError("User not found.", 404);
  }

  const [row] = await db
    .insert(transactions)
    .values({
      userId: user.id,
      type: "deposit",
      status: "pending",
      amount: amount.toFixed(2),
      walletAddress: input.walletAddress.toLowerCase(),
      note: "Wallet → platform",
    })
    .returning();

  return {
    transaction: {
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
    },
    source: "database",
  };
}

/** Test/mock helper · pending deposits waiting for confirmation. */
export function getMockPendingDeposit(id: string) {
  return mockDeposits.get(id) ?? null;
}

export function upsertMockDeposit(tx: DepositResult["transaction"]) {
  mockDeposits.set(tx.id, tx);
}

export const DepositError = defineServiceError("DepositError");
