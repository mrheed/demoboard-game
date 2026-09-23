import { robinhood, robinhoodTestnet } from "viem/chains";

export type BoardChainEnv = "mainnet" | "testnet";

/** Display name stored in the ledger / UI copy. */
export const ROBINHOOD_CHAIN_LABEL = "Robinhood Chain";

export const ROBINHOOD_TESTNET_FAUCET = "https://faucet.testnet.chain.robinhood.com/";

export function getBoardChainEnv(): BoardChainEnv {
  const raw = (process.env.NEXT_PUBLIC_CHAIN_ENV ?? "mainnet").toLowerCase();
  return raw === "mainnet" ? "mainnet" : "testnet";
}

/** Active Robinhood Chain definition for wagmi / viem. */
export function getBoardChain() {
  return getBoardChainEnv() === "testnet" ? robinhoodTestnet : robinhood;
}

export function getBoardChainId(): number {
  return getBoardChain().id;
}

export function getBoardRpcUrl(): string {
  const override = process.env.NEXT_PUBLIC_RPC_URL?.trim();
  if (override) return override;
  return getBoardChainEnv() === "testnet"
    ? "https://rpc.testnet.chain.robinhood.com"
    : "https://rpc.mainnet.chain.robinhood.com";
}

export function getBoardExplorerUrl(): string {
  const override = process.env.NEXT_PUBLIC_EXPLORER_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  return getBoardChainEnv() === "testnet"
    ? "https://explorer.testnet.chain.robinhood.com"
    : "https://robinhoodchain.blockscout.com";
}

export function getBoardChainLabel() {
  return getBoardChainEnv() === "testnet"
    ? "Robinhood Chain Testnet"
    : ROBINHOOD_CHAIN_LABEL;
}

/** Optional BOARD ERC-20. Paid play uses canonical USDG; this is for BOARD pages. */
export function getBoardTokenAddress(): `0x${string}` | null {
  const raw = process.env.NEXT_PUBLIC_BOARD_TOKEN_ADDRESS?.trim();
  if (!raw || !/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw as `0x${string}`;
}

/** Token page on the active Robinhood explorer, or null when CA is unset. */
export function getBoardTokenExplorerUrl(): string | null {
  const address = getBoardTokenAddress();
  if (!address) return null;
  return `${getBoardExplorerUrl()}/token/${address}`;
}

export function shortenAddress(address: string, size = 4): string {
  if (!/^0x[a-fA-F0-9]{40}$/i.test(address)) return address;
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`;
}
