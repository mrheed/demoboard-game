/** BOARD amounts are stored with two decimal places. */
export const BOARD_DECIMALS = 2;

const SCALE = 10 ** BOARD_DECIMALS;

/**
 * Round a BOARD amount to the stored precision.
 *
 * Balances are held in Postgres `numeric(20,2)` but read into JS numbers, so
 * every computed amount is rounded back to two decimals before it is written.
 */
export function roundBoard(amount: number): number {
  return Math.round(amount * SCALE) / SCALE;
}

/** Accept only positive amounts that fit the on-ledger two-decimal precision. */
export function parseBoardAmount(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const scaled = amount * SCALE;
  const cents = Math.round(scaled);
  if (!Number.isSafeInteger(cents) || Math.abs(scaled - cents) > 1e-8) return null;
  return cents / SCALE;
}

/** Format a BOARD amount for a `numeric` column. */
export function toBoardColumn(amount: number): string {
  return roundBoard(amount).toFixed(BOARD_DECIMALS);
}
