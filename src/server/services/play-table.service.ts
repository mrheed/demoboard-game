import { randomInt } from "node:crypto";
import { isGameEnabled, GAME_DISABLED_MESSAGE } from "@/lib/game-availability";
import type { Hex } from "viem";

import type { LiveMatch, MatchAction } from "@/lib/game/live-match";
import {
  createLiveMatch,
  applyMatchAction,
  tickMatch,
} from "@/server/services/play-match-engine";
import { withPlayDocument } from "@/server/lib/play-store";
import { ServiceError } from "@/server/lib/service-error";
import {
  PLAY_ENTRY_FEE,
  PLAY_ENTRY_FEE_ATOMIC,
} from "@/lib/game/play-player";
import {
  isPlayBot,
  isPlayLobbySlotId,
  PLAY_READY_TIMEOUT_MS,
  PLAY_WAIT_TIMEOUT_MS,
  PLAY_LOBBY_SLOTS,
  type PlayLobbyGame,
  type PlayTableStatus,
  type PlayTableView,
} from "@/lib/game/play-table";
import { shortenAddress, getBoardChainId, getBoardChainEnv } from "@/lib/wallet/chains";
import { getPlayEntryReadiness } from "@/server/lib/play-readiness";
import type { GameType } from "@/lib/types";
import { MAX_PLAYERS_PER_ROOM } from "@/lib/types";
import {
  getPlayTreasuryAddress,
  getPlayChainHead,
  getPlayRequiredConfirmations,
  listSuccessfulSitHashes,
  refundSit,
  verifySitTransaction,
} from "@/server/lib/play-chain";
import { paidLeaveToken } from "@/server/lib/play-seat-token";
import { publishPlayTable } from "@/server/realtime/play-hub";
import {
  getUsdgAddress,
  USDG_DECIMALS,
  USDG_SYMBOL,
} from "@/lib/wallet/usdg";

type PlaySeat = {
  address: string;
  username: string;
  seat: number;
  sitTxHash: Hex | null;
  leaveToken: string;
  ready: boolean;
  refundTxHash: Hex | null;
  readyBy?: number;
};

type PlayTable = {
  id: string;
  game: GameType;
  label: string;
  slot: number;
  status: PlayTableStatus;
  seats: PlaySeat[];
  version: number;
  /** Wallets that forfeited the current match. They cannot sit this table again until a new match starts. */
  leftAddresses: string[];
  matchId?: string;
  waitingUntil?: number;
};

type PendingRefund = {
  id: string;
  address: Hex;
  createdAt: number;
  status?: "queued" | "submitted" | "confirmed" | "failed" | "review";
  txHash?: Hex;
  error?: string | null;
  confirmedAt?: string | null;
};

type Store = {
  entryCutoverBlock?: string;
  network?: {
    chainId: number;
    treasury: string;
    asset?: {
      kind: "erc20";
      address: string;
      symbol: string;
      decimals: number;
      entryAmount: string;
    };
  };
  tables: PlayTable[];
  usedTx: string[];
  pendingRefunds?: PendingRefund[];
  matches?: Record<string, LiveMatch>;
};

const usedTx = new Set<string>();
const tables = new Map<string, PlayTable>();
const pendingRefunds: PendingRefund[] = [];

function loadStore(parsed: Store) {
  tables.clear();
  usedTx.clear();
  pendingRefunds.length = 0;
  for (const table of parsed.tables ?? [])
    tables.set(table.id.toUpperCase(), hydrateTable(table));
  for (const hash of parsed.usedTx ?? []) usedTx.add(hash.toLowerCase());
  pendingRefunds.push(
    ...(parsed.pendingRefunds ?? []).map((row) => ({
      ...row,
      id: row.id ?? `legacy-${row.address}-${row.createdAt}`,
      status: row.id ? row.status : "review" as const,
      error: row.id ? row.error : "Legacy refund has no payment identity. Support must reconcile it before sending funds.",
    })),
  );
  ensureLobbySlots();
}

function slotMeta(tableId: string) {
  const id = tableId.toUpperCase();
  return PLAY_LOBBY_SLOTS.find((slot) => slot.id === id);
}

function hydrateTable(table: PlayTable): PlayTable {
  const slot = slotMeta(table.id);
  return {
    ...table,
    id: table.id.toUpperCase(),
    label: table.label ?? slot?.label ?? table.id,
    slot: table.slot ?? slot?.slot ?? 0,
    leftAddresses: (table.leftAddresses ?? []).map((row) => row.toLowerCase()),
    waitingUntil: table.waitingUntil ?? (table.status === "waiting" && table.seats.length ? Date.now() + PLAY_WAIT_TIMEOUT_MS : undefined),
    seats: table.seats.map((seat) => ({ ...seat, readyBy: seat.readyBy ?? Date.now() + PLAY_READY_TIMEOUT_MS })),
  };
}

function newEmptySlot(slot: (typeof PLAY_LOBBY_SLOTS)[number]): PlayTable {
  return {
    id: slot.id,
    game: slot.game,
    label: slot.label,
    slot: slot.slot,
    status: "waiting",
    seats: [],
    version: 0,
    leftAddresses: [],
  };
}

function ensureLobbySlots() {
  const orphans: PlayTable[] = [];
  for (const table of tables.values()) {
    if (!isPlayLobbySlotId(table.id)) orphans.push(table);
  }

  for (const slot of PLAY_LOBBY_SLOTS) {
    if (!tables.has(slot.id)) tables.set(slot.id, newEmptySlot(slot));
  }

  for (const orphan of orphans) {
    if (orphan.status === "waiting" && orphan.seats.length > 0) {
      const target = [...tables.values()].find(
        (table) =>
          table.game === orphan.game &&
          isPlayLobbySlotId(table.id) &&
          table.status === "waiting" &&
          table.seats.length === 0,
      );
      if (target) {
        target.seats = orphan.seats;
        target.version += 1;
      }
    }
    tables.delete(orphan.id.toUpperCase());
  }

  for (const table of tables.values()) {
    healIdleLobby(table);
  }
}

let activeMatches: Record<string, LiveMatch> = {};
let queue: Promise<void> = Promise.resolve();

function hasFinancialHistory(document: Store) {
  return Boolean(
    (document.usedTx?.length ?? 0) > 0 ||
      (document.pendingRefunds?.length ?? 0) > 0 ||
      Object.keys(document.matches ?? {}).length > 0 ||
      (document.tables ?? []).some((table) => table.seats.length > 0),
  );
}

function samePaymentAsset(
  actual: NonNullable<Store["network"]>["asset"],
  expected: NonNullable<NonNullable<Store["network"]>["asset"]>,
) {
  return Boolean(
    actual &&
      actual.kind === expected.kind &&
      actual.address.toLowerCase() === expected.address.toLowerCase() &&
      actual.symbol === expected.symbol &&
      actual.decimals === expected.decimals &&
      actual.entryAmount === expected.entryAmount,
  );
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const execute = () =>
    withPlayDocument<Store, T>(
      "play-tables",
      () => ({ tables: [], usedTx: [] }),
      async (document) => {
        const network = {
          chainId: getBoardChainId(),
          treasury: getPlayTreasuryAddress().toLowerCase(),
          asset: {
            kind: "erc20" as const,
            address: getUsdgAddress().toLowerCase(),
            symbol: USDG_SYMBOL,
            decimals: USDG_DECIMALS,
            entryAmount: PLAY_ENTRY_FEE_ATOMIC.toString(),
          },
        };
        if (document.network && (document.network.chainId !== network.chainId || document.network.treasury !== network.treasury))
          throw new ServiceError("Paid storage belongs to another network or treasury. Use a separate database; do not relabel existing funds.", 503);
        if (
          document.network &&
          !samePaymentAsset(document.network.asset, network.asset) &&
          hasFinancialHistory(document)
        )
          throw new ServiceError("Paid storage belongs to another payment asset. Reconcile it in a separate ledger; do not relabel existing funds as USDG.", 503);
        if (!document.network && getBoardChainEnv() === "mainnet" && hasFinancialHistory(document))
          throw new ServiceError("Legacy paid storage requires network review before mainnet use.", 503);
        document.network = network;
        // A fresh ledger must not accept old already-refunded chain payments.
        document.entryCutoverBlock ??= ((await getPlayChainHead()) + BigInt(1)).toString();
        activeMatches = document.matches ?? {};
        for (const match of Object.values(activeMatches)) {
          if (match.game === "ludo") match.state.rulesVersion ??= 1;
        }
        loadStore(document);
        maintainTablesLocked(Date.now());
        const result = await fn();
        document.tables = [...tables.values()];
        document.usedTx = [...usedTx];
        document.pendingRefunds = [...pendingRefunds];
        document.matches = activeMatches;
        return result;
      },
    );
  const run = queue.then(execute, execute);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}


function asView(table: PlayTable): PlayTableView {
  return {
    id: table.id,
    game: table.game,
    label: table.label,
    slot: table.slot,
    status: table.status,
    entryFee: PLAY_ENTRY_FEE,
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    seats: table.seats.map((seat) => ({
      address: seat.address,
      username: seat.username,
      seat: seat.seat,
      ready: seat.ready,
      readyBy: seat.readyBy,
    })),
    refundTxHash:
      table.seats.find((seat) => seat.refundTxHash)?.refundTxHash ?? null,
    version: table.version,
    matchId: table.matchId ?? null,
    waitingUntil: table.waitingUntil ?? null,
  };
}

function asLobby(table: PlayTable, viewer?: string | null): PlayLobbyGame {
  const viewerKey = viewer?.toLowerCase() ?? "";
  const completed = Boolean(
    table.matchId && activeMatches[table.matchId]?.winnerSeat != null,
  );
  const seats = completed ? [] : table.seats;
  return {
    tableId: table.id,
    game: table.game,
    label: table.label,
    slot: table.slot,
    status: completed ? "waiting" : table.status,
    entryFee: PLAY_ENTRY_FEE,
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    seated: seats.length,
    seatsLeft:
      MAX_PLAYERS_PER_ROOM -
      seats.filter((seat) => !isPlayBot(seat.address)).length,
    blocked: Boolean(
      !completed &&
        viewerKey &&
        (table.leftAddresses ?? []).includes(viewerKey),
    ),
    seats: seats.map((seat) => ({
      address: seat.address,
      username: seat.username,
      seat: seat.seat,
    })),
  };
}

function leftThisTable(table: PlayTable, address: string) {
  if (!table.leftAddresses) table.leftAddresses = [];
  return table.leftAddresses.includes(address.toLowerCase());
}

function bump(table: PlayTable) {
  table.version += 1;

  publishPlayTable({ type: "table", table: asView(table) });
}

function queueRefundLocked(address: Hex, id: string) {
  if (/^0x[a-fA-F0-9]{64}$/.test(id)) usedTx.add(id.toLowerCase());
  if (!pendingRefunds.some((row) => row.id === id))
    pendingRefunds.push({ id, address, createdAt: Date.now(), status: "queued", confirmedAt: null });
}

let refundFlush: Promise<void> | undefined;
export async function flushPendingRefunds() {
  if (refundFlush) return refundFlush;
  refundFlush = (async () => {
    const pending = await withLock(async () => pendingRefunds.filter((row) => row.status !== "confirmed" && row.status !== "review").map((row) => ({ ...row })));
    for (const refund of pending) {
      const result = await refundSit(refund.address, refund.id);
      await withLock(async () => {
        const row = pendingRefunds.find((item) => item.id === refund.id);
        if (!row || row.status === "confirmed") return;
        row.status = result.ok ? result.status : "failed";
        row.error = result.ok ? null : result.message;
        if (result.ok) row.txHash = result.hash;
        if (result.ok && result.status === "confirmed") row.confirmedAt = new Date().toISOString();
      });
    }
  })();
  try { await refundFlush; } finally { refundFlush = undefined; }
}

function startMatch(table: PlayTable) {
  table.leftAddresses = [];
  table.status = "playing";
  const seats = table.seats.map((seat) => ({
    id: seat.address,
    username: seat.username,
    seat: seat.seat,
  }));
  const match = createLiveMatch({
    roomId: table.id,
    game: table.game,
    seats,
    fundedSeats: table.seats.filter(
      (seat) => !isPlayBot(seat.address) && seat.sitTxHash,
    ).length,
  });
  table.matchId = match.id;
  // Joining first must not buy the first turn.
  match.state.activeSeat = seats[randomInt(seats.length)].seat;
  table.waitingUntil = undefined;
  activeMatches[match.id] = match;
}

function tryStartMatch(table: PlayTable) {
  if (table.status === "waiting" && isGameEnabled(table.game) &&
      table.seats.length === MAX_PLAYERS_PER_ROOM &&
      table.seats.every((seat) => !isPlayBot(seat.address) && seat.sitTxHash && seat.ready)) {
    startMatch(table);
  }
}

function maintainTablesLocked(now: number) {
  for (const match of Object.values(activeMatches)) tickMatch(match, now);
  for (const table of tables.values()) {
    const match = table.matchId ? activeMatches[table.matchId] : undefined;
    if (table.status === "playing" && !match) {
      // A pre-authoritative match has no trustworthy board to resume or settle.
      for (const seat of table.seats) {
        if (!isPlayBot(seat.address) && seat.sitTxHash) {
          usedTx.add(seat.sitTxHash.toLowerCase());
          queueRefundLocked(seat.address as Hex, seat.sitTxHash);
        }
      }
      table.seats = [];
      table.status = "waiting";
      table.matchId = undefined;
      table.waitingUntil = undefined;
      table.leftAddresses = [];
      bump(table);
      continue;
    }
    if (table.status === "playing" && match) {
      const before = table.seats.length;
      table.seats = table.seats.filter((seat) =>
        match.state.players.some((player) => player.id === seat.address && player.status !== "eliminated"));
      if (before !== table.seats.length) bump(table);
      continue;
    }
    if (table.status !== "waiting") continue;
    const before = table.seats.length;
    table.seats = table.seats.filter((seat) => {
      if (isPlayBot(seat.address)) return false;
      const expired = (table.waitingUntil != null && now >= table.waitingUntil) ||
        (!seat.ready && seat.readyBy != null && now >= seat.readyBy);
      if (expired && seat.sitTxHash) queueRefundLocked(seat.address as Hex, seat.sitTxHash);
      return !expired;
    });
    if (!table.seats.length) table.waitingUntil = undefined;
    tryStartMatch(table);
    if (before !== table.seats.length) bump(table);
  }
}


function humanSeatCount(table: PlayTable) {
  return table.seats.filter((seat) => !isPlayBot(seat.address)).length;
}

function dropHouseNpcs(table: PlayTable) {
  table.seats = table.seats.filter((seat) => !isPlayBot(seat.address));
}

function findActiveSeat(
  address: Hex,
): { table: PlayTable; seat: PlaySeat } | null {
  const needle = address.toLowerCase();
  for (const table of tables.values()) {
    if (table.status === "cancelled") continue;
    if (table.matchId && activeMatches[table.matchId]?.winnerSeat != null)
      continue;
    const seat = table.seats.find(
      (row) => row.address.toLowerCase() === needle,
    );
    if (seat) return { table, seat };
  }
  return null;
}

function rememberLeaver(table: PlayTable, address: string) {
  if (!table.leftAddresses) table.leftAddresses = [];
  const leaver = address.toLowerCase();
  if (isPlayBot(leaver) || table.leftAddresses.includes(leaver)) return;
  table.leftAddresses.push(leaver);
}

/**
 * Drop a seat. Last human out resets a lobby slot to waiting and clears the
 * leave ban, so the same wallet can sit again and must pay the entry fee.
 */
function unseat(table: PlayTable, seat: PlaySeat, ban: boolean) {
  const match = table.matchId ? activeMatches[table.matchId] : undefined;
  if (
    match &&
    match.winnerSeat === null &&
    match.state.players.some(
      (p) => p.id === seat.address && p.status === "alive",
    )
  ) {
    applyMatchAction(match, seat.address, "forfeit");
  }
  const index = table.seats.findIndex(
    (row) => row.leaveToken === seat.leaveToken || row.address === seat.address,
  );
  if (index >= 0) table.seats.splice(index, 1);
  if (ban) rememberLeaver(table, seat.address);
  if (humanSeatCount(table) === 0) {
    dropHouseNpcs(table);
    if (isPlayLobbySlotId(table.id)) {
      table.status = "waiting";
      table.matchId = undefined;
      table.leftAddresses = [];
    } else if (table.seats.length === 0) {
      table.status = "cancelled";
    }
  }
}

/** Empty waiting lobby slots are open to everyone, including a previous leaver. */
function healIdleLobby(table: PlayTable) {
  if (!isPlayLobbySlotId(table.id) || humanSeatCount(table) > 0) return false;
  let changed = false;
  if (table.seats.length > 0) {
    dropHouseNpcs(table);
    changed = true;
  }
  if (table.status !== "waiting") {
    table.status = "waiting";
    changed = true;
  }
  if ((table.leftAddresses ?? []).length > 0) {
    table.leftAddresses = [];
    changed = true;
  }
  return changed;
}

function extraSitHash(seat: PlaySeat, txHash: Hex): Hex | null {
  if (!seat.sitTxHash || txHash === seat.sitTxHash || usedTx.has(txHash)) {
    return null;
  }
  return txHash;
}

async function refundVerifiedExtra(address: Hex, txHash: Hex) {
  const verified = await verifySitTransaction({ hash: txHash, from: address });
  if (!verified.ok) return false;
  await withLock(async () => {
    if (usedTx.has(txHash)) return;
    usedTx.add(txHash);
    queueRefundLocked(address, txHash);
  });
  return true;
}

export function getPlayConfig() {
  return {
    treasury: getPlayTreasuryAddress(),
    token: getUsdgAddress(),
    tokenDecimals: USDG_DECIMALS,
    entryFee: PLAY_ENTRY_FEE,
    entryFeeAtomic: PLAY_ENTRY_FEE_ATOMIC.toString(),
    confirmations: getPlayRequiredConfirmations(),
  };
}

export async function getPlayTable(
  tableId: string,
): Promise<PlayTableView | null> {
  return withLock(async () => {
    const table = tables.get(tableId.toUpperCase());
    return table ? asView(table) : null;
  });
}

export async function listPlayLobby(
  viewer?: string | null,
): Promise<PlayLobbyGame[]> {
  return withLock(async () =>
    PLAY_LOBBY_SLOTS.filter((slot) =>
      isGameEnabled(slot.game) || tables.get(slot.id)!.seats.some(
        (seat) => seat.address.toLowerCase() === viewer?.toLowerCase(),
      ),
    ).map((slot) => asLobby(tables.get(slot.id)!, viewer)),
  );
}

export type SitResult =
  | {
      ok: true;
      table: PlayTableView;
      seat: number;
      leaveToken: string;
      alreadySeated: boolean;
      txHash: Hex | null;
    }
  | {
      ok: false;
      code:
        | "BAD_TX"
        | "GAME_DISABLED"
        | "TX_FAILED"
        | "TX_MISMATCH"
        | "TX_USED"
        | "FULL"
        | "ALREADY_SEATED"
        | "NOT_FOUND"
        | "NOT_WAITING"
        | "LEFT_TABLE"
        | "NO_PAYMENT";
      message: string;
      refund?: boolean;
    };

export async function sitPlayTable(input: {
  game: GameType;
  tableId?: string;
  address: Hex;
  txHash: Hex;
}): Promise<SitResult> {
  const address = input.address.toLowerCase() as Hex;
  const txHash = input.txHash.toLowerCase() as Hex;
  const wantedId = input.tableId?.toUpperCase();

  type Early =
    | {
        kind: "reconnect";
        result: Extract<SitResult, { ok: true }>;
        extraTx: Hex | null;
      }
    | {
        kind: "blocked";
        result: Extract<SitResult, { ok: false }>;
        extraTx: Hex | null;
      }
    | { kind: "pay" };

  const early = await withLock(async (): Promise<Early> => {
    const found = findActiveSeat(address);
    if (found) {
      const extraTx = extraSitHash(found.seat, txHash);
      const sameTable = !wantedId || found.table.id === wantedId;
      if (sameTable) {
        return {
          kind: "reconnect",
          extraTx,
          result: {
            ok: true,
            table: asView(found.table),
            seat: found.seat.seat,
            leaveToken: found.seat.leaveToken,
            alreadySeated: true,
            txHash: found.seat.sitTxHash,
          },
        };
      }
      return {
        kind: "blocked",
        // A wallet can switch tables while the first request is in flight. If
        // it already paid again, verify that transfer before queuing a refund.
        extraTx,
        result: {
          ok: false,
          code: "ALREADY_SEATED",
          message: `Finish or leave ${found.table.id} first.`,
        },
      };
    }
    if (usedTx.has(txHash)) {
      return {
        kind: "blocked",
        extraTx: null,
        result: {
          ok: false,
          code: "TX_USED",
          message: "This entry was already consumed. Check My matches and refunds before starting another entry.",
          refund: pendingRefunds.some((row) => row.id === txHash && row.address === address),
        },
      };
    }
    return { kind: "pay" };
  });

  if (early.kind !== "pay") {
    let refund = false;
    if (early.extraTx) {
      refund = await refundVerifiedExtra(address, early.extraTx);
    }
    return early.result.ok || !refund
      ? early.result
      : { ...early.result, refund: true };
  }

  const verified = await verifySitTransaction({
    hash: txHash,
    from: address,
  });
  if (!verified.ok) {
    console.error(
      "[play-sit] verify failed",
      txHash,
      verified.error.code,
      verified.error.message,
    );
    return {
      ok: false,
      code:
        verified.error.code === "TX_NOT_FOUND" ? "BAD_TX" : verified.error.code,
      message: verified.error.message,
      refund: false,
    };
  }

  const readiness = await getPlayEntryReadiness();
  const result = await withLock(async (): Promise<SitResult> => {
    // Prefer reconnect before TX_USED so a lost response after a successful
    // seat still reopens the room on retry without charging again.
    const found = findActiveSeat(address);
    if (found) {
      const sameTable = !wantedId || found.table.id === wantedId;
      if (sameTable) {
        // A concurrent retry of the SAME entry is not an extra payment.
        if (found.seat.sitTxHash !== txHash && !usedTx.has(txHash)) {
          usedTx.add(txHash);
          queueRefundLocked(address, txHash);
        }
        return {
          ok: true,
          table: asView(found.table),
          seat: found.seat.seat,
          leaveToken: found.seat.leaveToken,
          alreadySeated: true,
          txHash: found.seat.sitTxHash ?? txHash,
        };
      }
      if (!usedTx.has(txHash)) {
        usedTx.add(txHash);
        queueRefundLocked(address, txHash);
      }
      return {
        ok: false,
        code: "ALREADY_SEATED",
        message: `Finish or leave ${found.table.id} first.`,
        refund: true,
      };
    }

    if (usedTx.has(txHash)) {
      return {
        ok: false,
        code: "TX_USED",
        message: "This entry was already consumed. Check My matches and refunds before starting another entry.",
        refund: pendingRefunds.some((row) => row.id === txHash && row.address === address),
      };
    }

    if (!readiness.entriesAllowed) {
      usedTx.add(txHash);
      queueRefundLocked(address, txHash);
      return { ok: false, code: "NOT_WAITING", message: `${readiness.entryBlockReason} Your refund is queued.`, refund: true };
    }
    const table = wantedId
      ? tables.get(wantedId)
      : [...tables.values()].find(
          (row) =>
            row.game === input.game &&
            row.status === "waiting" &&
            row.seats.length < MAX_PLAYERS_PER_ROOM,
        );

    if (!table) {
      usedTx.add(txHash);
      queueRefundLocked(address, txHash);
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "That lobby table was not found.",
        refund: true,
      };
    }
    if (table.game !== input.game) {
      usedTx.add(txHash);
      queueRefundLocked(address, txHash);
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "That table is not this game.",
        refund: true,
      };
    }
    if (!isGameEnabled(table.game)) {
      // A stale client may already have paid: consume once and queue recovery,
      // never create a new seat or report that the refund is confirmed.
      usedTx.add(txHash);
      queueRefundLocked(address, txHash);
      return {
        ok: false,
        code: "GAME_DISABLED",
        message: `${GAME_DISABLED_MESSAGE} Your verified entry refund is queued.`,
        refund: true,
      };
    }
    if (table.matchId && activeMatches[table.matchId]?.winnerSeat != null) {
      table.seats = [];
      table.status = "waiting";
      table.matchId = undefined;
      table.leftAddresses = [];
    }
    if (table.status !== "waiting") {
      usedTx.add(txHash);
      queueRefundLocked(address, txHash);
      return {
        ok: false,
        code: "NOT_WAITING",
        message: "That table is already in play. Pick another lobby.",
        refund: true,
      };
    }
    if (leftThisTable(table, address)) {
      usedTx.add(txHash);
      queueRefundLocked(address, txHash);
      return {
        ok: false,
        code: "LEFT_TABLE",
        message:
          "You left this match. Sit a different waiting table. The entry fee is charged again.",
        refund: true,
      };
    }
    if (table.seats.length >= MAX_PLAYERS_PER_ROOM) {
      const bot = table.seats.findIndex((seat) => isPlayBot(seat.address));
      if (bot >= 0) table.seats.splice(bot, 1);
    }
    if (table.seats.length >= MAX_PLAYERS_PER_ROOM) {
      usedTx.add(txHash);
      queueRefundLocked(address, txHash);
      return {
        ok: false,
        code: "FULL",
        message: "Table is full.",
        refund: true,
      };
    }

    const taken = new Set(table.seats.map((seat) => seat.seat));
    let seat = 1;
    while (taken.has(seat) && seat <= MAX_PLAYERS_PER_ROOM) seat += 1;

    const leaveToken = paidLeaveToken(txHash);
    table.seats.push({
      address,
      username: shortenAddress(address),
      seat,
      sitTxHash: txHash,
      leaveToken,
      ready: false,
      refundTxHash: null,
      readyBy: Date.now() + PLAY_READY_TIMEOUT_MS,
    });
    table.waitingUntil ??= Date.now() + PLAY_WAIT_TIMEOUT_MS;
    usedTx.add(txHash);
    bump(table);

    return {
      ok: true,
      table: asView(table),
      seat,
      leaveToken,
      alreadySeated: false,
      txHash,
    };
  });

  return result;
}

/**
 * Seat a wallet that already paid 1 USDG but never got a room.
 * One payment opens the table. Any extra successful payments are refunded.
 */
export async function claimUnpaidSit(input: {
  game: GameType;
  tableId?: string;
  address: Hex;
}): Promise<SitResult> {
  const address = input.address.toLowerCase() as Hex;
  const wantedId = input.tableId?.toUpperCase();
  const already = await withLock(async () => {
    const found = findActiveSeat(address);
    if (!found) return null;
    const sameTable = !wantedId || found.table.id === wantedId;
    if (!sameTable) {
      return {
        ok: false as const,
        code: "ALREADY_SEATED" as const,
        message: `Finish or leave ${found.table.id} first.`,
        refund: false,
      };
    }
    return {
      ok: true as const,
      table: asView(found.table),
      seat: found.seat.seat,
      leaveToken: found.seat.leaveToken,
      alreadySeated: true,
      txHash: found.seat.sitTxHash,
    };
  });
  if (already) return already;

  const slot = wantedId ? slotMeta(wantedId) : undefined;
  if (!isGameEnabled(input.game) || (slot && !isGameEnabled(slot.game))) {
    return { ok: false, code: "GAME_DISABLED", message: GAME_DISABLED_MESSAGE };
  }

  const hashes = await listSuccessfulSitHashes(address);
  const open = hashes.filter((hash) => !usedTx.has(hash));
  if (open.length === 0) {
    return {
      ok: false,
      code: "NO_PAYMENT",
      message: "No confirmed sit payment found for this wallet.",
      refund: false,
    };
  }
  let lastMismatch: SitResult | null = null;
  for (let index = 0; index < open.length; index += 1) {
    const candidate = open[index]!;
    const result = await sitPlayTable({
      game: input.game,
      tableId: input.tableId,
      address,
      txHash: candidate,
    });
    if (result.ok) {
      const extras = [...open.slice(0, index), ...open.slice(index + 1)];
      for (const extra of extras) {
        await refundVerifiedExtra(address, extra);
      }
      return result;
    }
    // Explorer history can contain malformed payments or payments before the
    // current ledger cutover. Continue until a usable payment is found.
    if (result.code === "TX_MISMATCH" || result.code === "BAD_TX") {
      lastMismatch = result;
      continue;
    }
    return result;
  }
  return lastMismatch ?? {
    ok: false,
    code: "NO_PAYMENT",
    message: "No confirmed sit payment found for this table.",
    refund: false,
  };
}

export type TableActionResult =
  | {
      ok: true;
      table: PlayTableView;
      refundTxHash?: Hex;
      refundPending?: boolean;
    }
  | {
      ok: false;
      code:
        | "NOT_FOUND"
        | "NOT_WAITING"
        | "NOT_PLAYING"
        | "GAME_DISABLED"
        | "FORBIDDEN"
        | "REFUND_FAILED";
      message: string;
    };

export type ResumePlayTableResult = {
  table: PlayTableView | null;
  note: string | null;
  /** Payment was refunded or already spent. Do not reopen a saved local seat. */
  blocked: boolean;
};

/** Read a saved seat; only /sit may validate payments and create seats. */
export async function resumePlayTable(input: {
  tableId: string;
  leaveToken?: string;
  address?: string;
  txHash?: string;
}): Promise<ResumePlayTableResult> {
  const tableId = input.tableId.toUpperCase();
  if (!isPlayLobbySlotId(tableId)) {
    return { table: null, note: null, blocked: false };
  }
  const table = await getPlayTable(tableId);
  const exists = table?.seats.some((seat) => seat.address.toLowerCase() === input.address?.toLowerCase());
  const blocked = Boolean(input.address && !exists);
  return { table, blocked, note: blocked ? "No active seat. Check My matches and refunds, or retry the saved payment through the lobby." : null };
}

export async function readyPlayTable(input: {
  tableId: string;
  leaveToken: string;
  address?: string;
  txHash?: string;
}): Promise<TableActionResult> {
  const slot = slotMeta(input.tableId.toUpperCase());
  if (slot && !isGameEnabled(slot.game)) {
    return { ok: false, code: "GAME_DISABLED", message: GAME_DISABLED_MESSAGE };
  }
  return withLock(async () => {
    const table = tables.get(input.tableId.toUpperCase());
    if (!table) {
      return {
        ok: false as const,
        code: "NOT_FOUND" as const,
        message: "Table not found.",
      };
    }
    if (table.status !== "waiting") {
      return {
        ok: false as const,
        code: "NOT_WAITING" as const,
        message: "The match already started.",
      };
    }
    const seat = table.seats.find(
      (row) =>
        row.leaveToken === input.leaveToken &&
        row.address === input.address?.toLowerCase(),
    );
    if (!seat) {
      return {
        ok: false as const,
        code: "FORBIDDEN" as const,
        message: "This seat token does not match the table.",
      };
    }
    seat.ready = true;
    tryStartMatch(table);
    bump(table);
    return { ok: true as const, table: asView(table) };
  });
}

export async function leavePlayTable(input: {
  tableId: string;
  leaveToken: string;
  address?: string;
  txHash?: string;
}): Promise<TableActionResult> {
  const prepared = await withLock(async () => {
    const table = tables.get(input.tableId.toUpperCase());
    if (!table) {
      return {
        ok: false as const,
        code: "NOT_FOUND" as const,
        message: "Table not found.",
      };
    }
    if (table.status !== "waiting") {
      return {
        ok: false as const,
        code: "NOT_WAITING" as const,
        message: "The match already started. Entry is locked.",
      };
    }
    const index = table.seats.findIndex(
      (row) =>
        row.leaveToken === input.leaveToken &&
        row.address === input.address?.toLowerCase(),
    );
    if (index < 0) {
      return {
        ok: false as const,
        code: "FORBIDDEN" as const,
        message: "This seat token does not match the table.",
      };
    }
    const seat = table.seats[index];
    if (seat.sitTxHash) queueRefundLocked(seat.address as Hex, seat.sitTxHash);
    table.seats.splice(index, 1);
    tryStartMatch(table);
    if (table.seats.length === 0) table.waitingUntil = undefined;
    if (table.seats.length === 0 && !isPlayLobbySlotId(table.id)) {
      table.status = "cancelled";
    }
    bump(table);
    return {
      ok: true as const,
      table: asView(table),
      address: seat.address,
      refundId: seat.sitTxHash,
    };
  });

  if (!prepared.ok) return prepared;

  if (isPlayBot(prepared.address)) {
    return { ok: true, table: prepared.table };
  }

  // The refund intent was committed atomically with releasing the seat.
  return { ok: true, table: prepared.table, refundPending: true };
}

/**
 * Quit a match that already started. Seat is cleared. Sit fee is not refunded.
 * Empty lobby slots reset so someone else can sit.
 */
export async function forfeitPlayTable(input: {
  tableId: string;
  leaveToken?: string;
  address?: string;
}): Promise<TableActionResult> {
  return withLock(async () => {
    const table = tables.get(input.tableId.toUpperCase());
    if (!table) {
      return {
        ok: false as const,
        code: "NOT_FOUND" as const,
        message: "Table not found.",
      };
    }
    if (table.status !== "playing") {
      return {
        ok: false as const,
        code: "NOT_PLAYING" as const,
        message: "This table has not started. Leave the waiting table to recover the entry fee.",
      };
    }
    const token = input.leaveToken?.trim() ?? "";
    const index = table.seats.findIndex((row) => {
      if (
        token &&
        row.leaveToken === token &&
        row.address === input.address?.toLowerCase()
      )
        return true;
      return false;
    });
    if (index < 0) {
      return {
        ok: false as const,
        code: "FORBIDDEN" as const,
        message: "This seat token does not match the table.",
      };
    }
    const seat = table.seats[index];
    if (!seat) {
      return {
        ok: false as const,
        code: "FORBIDDEN" as const,
        message: "This seat token does not match the table.",
      };
    }
    unseat(table, seat, true);
    bump(table);
    return { ok: true as const, table: asView(table) };
  });
}

/** Persisted match snapshots. A client snapshot is never accepted as game state. */
export async function getPaidMatch(
  tableId: string,
  game: GameType,
  matchId?: string,
): Promise<LiveMatch> {
  return withLock(async () => {
    const table = tables.get(tableId.toUpperCase());
    const id = matchId ?? table?.matchId;
    const match = id ? activeMatches[id] : undefined;
    if (
      !match ||
      match.game !== game ||
      match.state.roomId !== tableId.toUpperCase()
    ) {
      throw new ServiceError(
        "The server has no active match for this table. Return to the lobby.",
        404,
      );
    }
    tickMatch(match);
    return structuredClone(match);
  });
}

export async function actPaidMatch(input: {
  tableId: string;
  game: GameType;
  address: string;
  matchId: string;
  version: number;
  action: MatchAction;
  pawnId?: string;
}): Promise<LiveMatch> {
  return withLock(async () => {
    const table = tables.get(input.tableId.toUpperCase());
    const match = activeMatches[input.matchId];
    if (
      !table ||
      table.matchId !== input.matchId ||
      !match ||
      match.game !== input.game
    ) {
      throw new ServiceError("This match is no longer active.", 409);
    }
    if (
      !table.seats.some(
        (seat) =>
          seat.address === input.address.toLowerCase() && seat.sitTxHash,
      )
    ) {
      throw new ServiceError("A confirmed entry is required.", 403);
    }
    if (match.version !== input.version || Date.now() >= match.deadline) {
      throw new ServiceError(
        "The turn changed. Refresh the board and try again.",
        409,
      );
    }
    applyMatchAction(match, input.address, input.action, input.pawnId);
    return structuredClone(match);
  });
}

/** Settlement updates share the gameplay lock and survive lobby slot reuse. */
export async function updatePaidMatch<T>(
  id: string,
  update: (match: LiveMatch) => T,
): Promise<T> {
  return withLock(async () => {
    const match = activeMatches[id];
    if (!match) throw new ServiceError("Match not found.", 404);
    return update(match);
  });
}

/** Worker-owned maintenance; does not depend on any browser being open. */
export async function maintainPaidPlay() {
  return withLock(async () => Object.values(activeMatches)
    .filter((match) => match.settlement && !["confirmed", "house"].includes(match.settlement.status))
    .map((match) => structuredClone(match)));
}

export async function hasRefundRecoveryBlockers() {
  return withLock(async () => pendingRefunds.some((refund) => refund.status === "failed" || refund.status === "review"));
}

/** Authenticated callers only. Recovers an existing seat, never searches or spends payments. */
export async function recoverPlaySeat(tableId: string, address: string) {
  return withLock(async () => {
    const table = tables.get(tableId.toUpperCase());
    const seat = table?.seats.find((row) => row.address === address.toLowerCase());
    if (!table || !seat) throw new ServiceError("No active seat for this wallet. Check your match and refund history.", 404);
    return { tableId: table.id, address: seat.address, seat: seat.seat, leaveToken: seat.leaveToken, txHash: seat.sitTxHash ?? undefined };
  });
}

export async function getPaidPlayHistory(address: string) {
  return withLock(async () => ({
    matches: Object.values(activeMatches).filter((match) => match.state.players.some((p) => p.id.toLowerCase() === address.toLowerCase()))
      .map((match) => ({ id: match.id, roomId: match.state.roomId, game: match.game, winnerSeat: match.winnerSeat, settlement: match.settlement })),
    refunds: pendingRefunds.filter((row) => row.address.toLowerCase() === address.toLowerCase()).map((row) => ({ ...row, status: row.status ?? "queued" })),
  }));
}
