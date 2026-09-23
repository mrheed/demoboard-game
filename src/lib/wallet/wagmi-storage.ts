import { deserialize, parseCookie, type State } from "wagmi";

/** Preserve Wagmi's existing cookie key while keeping server hydration connector-free. */
export const BOARD_WAGMI_STORAGE_KEY = "wagmi";

/**
 * Reading the cookie does not require constructing the browser wallet connectors.
 * Keeping this separate prevents WalletConnect Core from being initialized once
 * by the server layout and again by the client-provider module graph.
 */
export function boardCookieToInitialState(
  cookie?: string | null,
): State | undefined {
  if (!cookie) return undefined;
  const parsed = parseCookie(cookie, `${BOARD_WAGMI_STORAGE_KEY}.store`);
  if (!parsed) return undefined;
  return deserialize<{ state: State }>(parsed).state;
}
