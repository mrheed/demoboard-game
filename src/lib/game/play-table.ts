import { PLAY_ENTRY_FEE } from "@/lib/game/play-player";
import { getBoardChainId, shortenAddress } from "@/lib/wallet/chains";
import { MAX_PLAYERS_PER_ROOM, type GameType } from "@/lib/types";
import { USDG_SYMBOL } from "@/lib/wallet/usdg";

export type PlayTableStatus = "waiting" | "playing" | "cancelled";

export const PLAY_LOBBIES_PER_GAME = 4;
export const PLAY_READY_TIMEOUT_MS = 2 * 60 * 1000;
export const PLAY_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

export type PlayLobbySlot = {
  id: string;
  game: GameType;
  slot: number;
  label: string;
};

export const PLAY_LOBBY_SLOTS: readonly PlayLobbySlot[] = [
  { id: "MNP-1", game: "monopoly", slot: 1, label: "Table 1" },
  { id: "MNP-2", game: "monopoly", slot: 2, label: "Table 2" },
  { id: "MNP-3", game: "monopoly", slot: 3, label: "Table 3" },
  { id: "MNP-4", game: "monopoly", slot: 4, label: "Table 4" },
  { id: "LUD-1", game: "ludo", slot: 1, label: "Table 1" },
  { id: "LUD-2", game: "ludo", slot: 2, label: "Table 2" },
  { id: "LUD-3", game: "ludo", slot: 3, label: "Table 3" },
  { id: "LUD-4", game: "ludo", slot: 4, label: "Table 4" },
] as const;

export function isPlayLobbySlotId(tableId: string) {
  const id = tableId.toUpperCase();
  return PLAY_LOBBY_SLOTS.some((slot) => slot.id === id);
}

export type PlayTableSeatView = {
  address: string;
  username: string;
  seat: number;
  ready: boolean;
  readyBy?: number;
};

export type PlayTableView = {
  id: string;
  game: GameType;
  label: string;
  slot: number;
  status: PlayTableStatus;
  entryFee: number;
  maxPlayers: number;
  seats: PlayTableSeatView[];
  refundTxHash: string | null;
  version: number;
  matchId?: string | null;
  waitingUntil?: number | null;
};

/** Public lobby snapshot for one sit table. Occupancy is live, never invented. */
export type PlayLobbyGame = {
  tableId: string;
  game: GameType;
  label: string;
  slot: number;
  status: PlayTableStatus;
  entryFee: number;
  maxPlayers: number;
  seated: number;
  seatsLeft: number;
  seats: Array<{
    address: string;
    username: string;
    seat: number;
  }>;
  /** True when this wallet forfeited the last match at this table. */
  blocked?: boolean;
};

export type PlaySeatRecord = {
  tableId: string;
  address: string;
  seat: number;
  leaveToken: string;
  /** Sit payment that proves this seat on any server instance. */
  txHash?: string;
};

const SEAT_KEY = "board.play.seat";
const TABLE_KEY = "board.play.table";

export type PendingPlayPayment = {
  tableId: string;
  game: GameType;
  address: `0x${string}`;
  txHash: `0x${string}`;
  asset: typeof USDG_SYMBOL;
  chainId: number;
};
const PAYMENT_KEY = "board.play.pending-payment";

export function savePendingPlayPayment(payment: PendingPlayPayment) {
  // Persist the hash before waiting for a receipt so retries never charge twice.
  try {
    window.localStorage.setItem(PAYMENT_KEY, JSON.stringify(payment));
    return true;
  } catch {
    // The in-memory caller still retains the hash when storage is unavailable.
    return false;
  }
}

export function readPendingPlayPayment(): PendingPlayPayment | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PAYMENT_KEY) ?? "null",
    ) as PendingPlayPayment | null;
    if (
      !parsed ||
      parsed.asset !== USDG_SYMBOL ||
      parsed.chainId !== getBoardChainId()
    ) {
      window.localStorage.removeItem(PAYMENT_KEY);
      return null;
    }
    return parsed;
  }
  catch { return null; }
}

export function clearPendingPlayPayment() {
  try { window.localStorage.removeItem(PAYMENT_KEY); }
  catch { /* private mode / disabled storage */ }
}

export function savePlaySeat(record: PlaySeatRecord) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SEAT_KEY, JSON.stringify(record));
  } catch {
    // ignore quota / private mode
  }
}

export function readPlaySeat(): PlaySeatRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SEAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaySeatRecord;
    if (!parsed?.tableId || !parsed.address || !parsed.leaveToken) return null;
    return {
      tableId: parsed.tableId,
      address: parsed.address,
      seat: parsed.seat,
      leaveToken: parsed.leaveToken,
      txHash: typeof parsed.txHash === "string" ? parsed.txHash : undefined,
    };
  } catch {
    return null;
  }
}

export function clearPlaySeat() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SEAT_KEY);
    window.sessionStorage.removeItem(TABLE_KEY);
  } catch {
    // ignore
  }
}

/** Table returned by a successful sit, so the room can open if another instance has not caught up. */
export function savePlayTableSnapshot(table: PlayTableView) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TABLE_KEY, JSON.stringify(table));
  } catch {
    // ignore quota / private mode
  }
}

export function readPlayTableSnapshot(tableId: string): PlayTableView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(TABLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlayTableView;
    if (!parsed?.id || parsed.id.toUpperCase() !== tableId.toUpperCase()) return null;
    if (!Array.isArray(parsed.seats)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Local waiting table so the room can open the moment the wallet returns a sit tx. */
export function buildLocalWaitingTable(input: {
  tableId: string;
  game: GameType;
  address: string;
}): PlayTableView {
  const id = input.tableId.toUpperCase();
  const slot = PLAY_LOBBY_SLOTS.find((row) => row.id === id);
  const address = input.address.toLowerCase();
  const seats: PlayTableSeatView[] = [
    {
      address,
      username: shortenAddress(address),
      seat: 1,
      ready: false,
    },
  ];
  return {
    id,
    game: slot?.game ?? input.game,
    label: slot?.label ?? id,
    slot: slot?.slot ?? 1,
    status: "waiting",
    entryFee: PLAY_ENTRY_FEE,
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    seats,
    refundTxHash: null,
    version: 1,
  };
}

export function isPlayBot(id: string) {
  return id.startsWith("bot-");
}

/** Free-practice rivals. Never create these seats in a paid waiting table. */
export const PLAY_HOUSE_NPCS = [
  { id: "bot-pixel", username: "PixelBaron" },
  { id: "bot-dice", username: "DiceDuchess" },
  { id: "bot-rent", username: "RentSeeker" },
] as const;
