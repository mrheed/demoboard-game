import { isAddress, parseUnits, type Address } from "viem";

import { getBoardChainEnv } from "@/lib/wallet/chains";

/** Canonical Paxos Global Dollar deployment on Robinhood Chain mainnet. */
export const ROBINHOOD_USDG_ADDRESS =
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;

/**
 * Stand-in stake token on Robinhood Chain testnet.
 *
 * Paxos has no testnet deployment, so paid play there runs against a token the
 * project deploys itself (contracts/script/Deploy.s.sol). It is mintable by
 * anyone and is worth nothing.
 */
export const ROBINHOOD_TESTNET_USDG_ADDRESS =
  "0x02E8950B4C0EBb85dF311cBd1629023c913d9b13" as Address;

/**
 * Stake token for the selected chain.
 *
 * Read this rather than the constants. Treating the mainnet address as
 * universal would make a testnet build verify transfers against a contract
 * that has no code there, so every sit would be rejected.
 */
export function getUsdgAddress(): Address {
  const override = process.env.NEXT_PUBLIC_USDG_ADDRESS?.trim();
  if (override) {
    // Validated, not asserted: a malformed address here would silently make
    // every transfer check compare against nonsense. Checksum casing is not
    // required, because operators routinely paste lowercase addresses.
    if (!isAddress(override, { strict: false })) {
      throw new Error(
        `NEXT_PUBLIC_USDG_ADDRESS is not a valid address: ${override}`,
      );
    }
    return override;
  }
  return getBoardChainEnv() === "testnet"
    ? ROBINHOOD_TESTNET_USDG_ADDRESS
    : ROBINHOOD_USDG_ADDRESS;
}

export const USDG_NAME = "Global Dollar";
export const USDG_SYMBOL = "USDG";
export const USDG_DECIMALS = 6;

export const USDG_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Transfer",
    anonymous: false,
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

export function parseUsdg(amount: string) {
  return parseUnits(amount, USDG_DECIMALS);
}
