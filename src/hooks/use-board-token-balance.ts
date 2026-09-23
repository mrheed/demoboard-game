import { formatEther, formatUnits, zeroAddress } from "viem";
import { useAccount, useBalance, useReadContract } from "wagmi";

import {
  PLAY_ENTRY_FEE,
  PLAY_ENTRY_FEE_ATOMIC,
  PLAY_STAKE_SYMBOL,
} from "@/lib/game/play-player";
import { getBoardChainEnv, getBoardChainId } from "@/lib/wallet/chains";
import {
  getUsdgAddress,
  USDG_ABI,
  USDG_DECIMALS,
} from "@/lib/wallet/usdg";

export { PLAY_ENTRY_FEE };

/**
 * Canonical USDG balance plus the native ETH needed to submit the ERC-20
 * transfer on Robinhood Chain mainnet.
 */
export function useBoardTokenBalance() {
  const { address, isConnected, chainId } = useAccount();
  const expectedChainId = getBoardChainId();
  const chainEnv = getBoardChainEnv();
  const onNetwork = isConnected && chainId === expectedChainId;
  // Every supported chain has a stake token, so the balance is readable on
  // all of them. Gating this on mainnet left the testnet chip showing an
  // ellipsis forever, because the query simply never ran.
  const enabled = Boolean(onNetwork && address);

  const token = useReadContract({
    address: getUsdgAddress(),
    abi: USDG_ABI,
    functionName: "balanceOf",
    args: [address ?? zeroAddress],
    chainId: expectedChainId,
    query: {
      enabled,
      refetchInterval: 30_000,
    },
  });
  const gas = useBalance({
    address,
    chainId: expectedChainId,
    query: {
      enabled,
      refetchInterval: 30_000,
    },
  });

  const amount = token.data == null
    ? null
    : Number(formatUnits(token.data, USDG_DECIMALS));
  const hasEntry = token.data != null && token.data >= PLAY_ENTRY_FEE_ATOMIC;
  const hasGas = gas.data != null && gas.data.value > BigInt(0);
  const readError = token.error ?? gas.error;

  return {
    address: address ?? null,
    isConnected,
    onNetwork,
    expectedChainId,
    chainEnv,
    amount,
    gasAmount: gas.data ? Number(formatEther(gas.data.value)) : null,
    symbol: PLAY_STAKE_SYMBOL,
    entryFee: PLAY_ENTRY_FEE,
    loading:
      enabled &&
      (token.isLoading || token.isFetching || gas.isLoading || gas.isFetching) &&
      amount === null,
    // Only genuine read failures are errors now. Reporting "mainnet only" on
    // every other chain was left over from when testnet had no stake token.
    error: readError
      ? readError instanceof Error
        ? readError.message
        : "Balance error"
      : null,
    hasEntry,
    hasGas,
    canEnter: Boolean(onNetwork && hasEntry && hasGas),
    shortfall:
      token.data != null && token.data < PLAY_ENTRY_FEE_ATOMIC
        ? Number(formatUnits(PLAY_ENTRY_FEE_ATOMIC - token.data, USDG_DECIMALS))
        : 0,
    refetch: async () => {
      await Promise.all([token.refetch(), gas.refetch()]);
    },
  };
}
