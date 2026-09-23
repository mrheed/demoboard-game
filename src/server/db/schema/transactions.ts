/**
 * transactions · ledger of BOARD moves (deposit, withdraw, entry fee, payout).
 * Amounts are signed from the user's perspective: deposits/payouts positive,
 * withdraws/entry fees negative. Chain confirmation updates status + tx_hash.
 */
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { transactionStatusEnum, transactionTypeEnum } from "./enums";
import { users } from "./users";

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: transactionTypeEnum("type").notNull(),
    status: transactionStatusEnum("status").notNull().default("pending"),
    /** Signed BOARD delta for the user's platform balance. */
    amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
    chain: text("chain").notNull().default("Robinhood Chain"),
    /** External wallet address involved in deposit/withdraw, when known. */
    walletAddress: text("wallet_address"),
    /** On-chain transaction hash once broadcast / confirmed. */
    txHash: text("tx_hash"),
    /** Log/event index makes a chain event uniquely creditable. */
    txEventIndex: integer("tx_event_index"),
    /** Pending withdrawals reserve the balance before any chain send. */
    fundsReserved: boolean("funds_reserved").notNull().default(false),
    note: text("note"),
    /** Optional link to a room/match for entry_fee or payout rows. */
    referenceId: uuid("reference_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("transactions_user_created_idx").on(table.userId, table.createdAt),
    index("transactions_status_idx").on(table.status),
    index("transactions_type_idx").on(table.type),
    uniqueIndex("transactions_deposit_chain_event_uidx")
      .on(table.chain, table.txHash, table.txEventIndex)
      .where(sql`${table.type} = 'deposit' and ${table.txHash} is not null and ${table.txEventIndex} is not null`),
  ],
);

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
