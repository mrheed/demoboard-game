import { shortenAddress } from "@/lib/wallet/chains";
import { parseUsdg, USDG_SYMBOL } from "@/lib/wallet/usdg";

/** Exact USDG amount required for one paid seat. */
export const PLAY_ENTRY_FEE = 1;

export const PLAY_ENTRY_FEE_USDG = "1";

export const PLAY_ENTRY_FEE_ATOMIC = parseUsdg(PLAY_ENTRY_FEE_USDG);

export const PLAY_STAKE_SYMBOL = USDG_SYMBOL;

/**
 * USDG amounts use at most the token's six decimal places. Pixel titles are
 * not used for this string.
 */
export function formatPlayAmount(amount: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(amount);
}

const PLAYER_KEY = "board.play.player";

export type PlayPlayer = {
  address: string;
  username: string;
};

export function savePlayPlayer(address: string) {
  if (typeof window === "undefined") return;
  const player: PlayPlayer = {
    address: address.toLowerCase(),
    username: shortenAddress(address),
  };
  try {
    window.sessionStorage.setItem(PLAYER_KEY, JSON.stringify(player));
  } catch {
    // ignore quota / private mode
  }
}

export function readPlayPlayer(): PlayPlayer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PLAYER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlayPlayer;
    if (!parsed?.address || !parsed.username) return null;
    return parsed;
  } catch {
    return null;
  }
}
