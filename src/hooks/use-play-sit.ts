"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { encodeFunctionData, type Hex } from "viem";
import { usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { useBoardTokenBalance } from "@/hooks/use-board-token-balance";
import { usePlaySession } from "@/hooks/use-play-session";
import { readResponseJson } from "@/lib/fetch-json";
import { PLAY_ENTRY_FEE_ATOMIC, savePlayPlayer } from "@/lib/game/play-player";
import {
  clearPendingPlayPayment,
  readPendingPlayPayment,
  savePendingPlayPayment,
  savePlaySeat,
  type PendingPlayPayment,
  type PlayTableView,
} from "@/lib/game/play-table";
import { rememberPreviewGame, type PreviewGame } from "@/lib/preview-game";
import { isGameEnabled, GAME_DISABLED_MESSAGE } from "@/lib/game-availability";
import { getUsdgAddress, USDG_ABI } from "@/lib/wallet/usdg";

export type SitPhase = "idle" | "sending" | "confirming" | "seating";

type SeatResponse = {
  table?: PlayTableView;
  seat?: number;
  leaveToken?: string;
  txHash?: string;
  code?: string;
  error?: string;
  refund?: boolean;
};

export function usePlaySit() {
  const router = useRouter();
  const wallet = useBoardTokenBalance();
  const ensureSession = usePlaySession();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient({ chainId: wallet.expectedChainId });
  const busy = useRef(false);
  const [sitPhase, setSitPhase] = useState<SitPhase>("idle");
  const [sitTableId, setSitTableId] = useState<string | null>(null);
  const [sitError, setSitError] = useState<string | null>(null);
  const [pendingPayment, setPendingPayment] =
    useState<PendingPlayPayment | null>(null);
  useEffect(() => {
    void Promise.resolve().then(() =>
      setPendingPayment(readPendingPlayPayment()),
    );
  }, []);

  async function sit(game: PreviewGame, tableId: string) {
    const address = wallet.address;
    if (!address || busy.current) return;
    busy.current = true;
    setSitError(null);
    setSitTableId(tableId);
    setSitPhase("seating");
    try {
      await ensureSession(address);
      let pending = readPendingPlayPayment();
      if (pending && pending.address.toLowerCase() !== address.toLowerCase()) {
        throw new Error(
          "Reconnect the wallet with the pending entry payment before starting another entry.",
        );
      }
      if (pending && pending.tableId.toUpperCase() !== tableId.toUpperCase()) {
        throw new Error(
          `An entry for ${pending.tableId} is awaiting verification. Retry that table first.`,
        );
      }
      const requestSeat = async (hash?: Hex) => {
        const response = await fetch("/api/play/sit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ game, tableId, address, txHash: hash }),
        });
        const payload = (await readResponseJson(
          response,
        )) as SeatResponse | null;
        return { response, payload };
      };
      let result = await requestSeat(pending?.txHash);
      if (
        !result.response.ok &&
        !pending &&
        result.payload?.code === "NO_PAYMENT"
      ) {
        // Never open a wallet transfer for a disabled game, even with a stale server.
        if (!isGameEnabled(game)) throw new Error(GAME_DISABLED_MESSAGE);
        if (!wallet.hasEntry)
          throw new Error(
            "You need at least 1 USDG on Robinhood Chain mainnet to sit.",
          );
        if (!wallet.hasGas)
          throw new Error("You need a small amount of ETH on Robinhood Chain mainnet for transaction gas.");
        const configResponse = await fetch("/api/play/config", {
          cache: "no-store",
        });
        const config = (await readResponseJson(configResponse)) as {
          treasury?: Hex;
          token?: Hex;
          entryFeeAtomic?: string;
          confirmations?: number;
          entriesAllowed?: boolean;
          entryBlockReason?: string;
          error?: string;
        } | null;
        if (!configResponse.ok || !config?.treasury)
          throw new Error(config?.error ?? "Play treasury is not ready.");
        if (
          config.token?.toLowerCase() !== getUsdgAddress().toLowerCase() ||
          config.entryFeeAtomic !== PLAY_ENTRY_FEE_ATOMIC.toString() ||
          !Number.isSafeInteger(config.confirmations) ||
          (config.confirmations ?? 0) < 1 ||
          (config.confirmations ?? 0) > 1_000
        ) {
          throw new Error("The play server returned an unsafe USDG payment configuration.");
        }
        if (!config.entriesAllowed)
          throw new Error(config.entryBlockReason ?? "Paid entries are paused.");
        setSitPhase("sending");
        if (wallet.address?.toLowerCase() !== address.toLowerCase()) {
          throw new Error("Wallet account changed. Retry with the wallet you signed in with.");
        }
        let replacementHash: Hex | null = null;
        const submittedHash = await sendTransactionAsync({
          account: address,
          to: getUsdgAddress(),
          data: encodeFunctionData({
            abi: USDG_ABI,
            functionName: "transfer",
            args: [config.treasury, PLAY_ENTRY_FEE_ATOMIC],
          }),
          chainId: wallet.expectedChainId,
        });
        pending = {
          tableId,
          game,
          address,
          txHash: submittedHash,
          asset: "USDG",
          chainId: wallet.expectedChainId,
        };
        setPendingPayment(pending);
        savePendingPlayPayment(pending);
        setSitPhase("confirming");
        if (publicClient) {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: submittedHash,
            confirmations: config.confirmations,
            timeout: 60_000,
            onReplaced(replacement) {
              if (replacement.reason === "cancelled") {
                clearPendingPlayPayment();
                setPendingPayment(null);
                pending = null;
                return;
              }
              replacementHash = replacement.transaction.hash;
              const replaced = {
                tableId,
                game,
                address,
                txHash: replacement.transaction.hash,
                asset: "USDG",
                chainId: wallet.expectedChainId,
              } satisfies PendingPlayPayment;
              pending = replaced;
              setPendingPayment(replaced);
              savePendingPlayPayment(replaced);
            },
          });
          if (receipt.status !== "success") {
            clearPendingPlayPayment();
            setPendingPayment(null);
            throw new Error("Entry transaction reverted. No seat was opened.");
          }
          const confirmedHash = replacementHash ?? receipt.transactionHash;
          if (confirmedHash !== pending.txHash) {
            pending = { ...pending, txHash: confirmedHash };
            setPendingPayment(pending);
            savePendingPlayPayment(pending);
          }
        }
        if (!pending) {
          throw new Error("Entry transaction was cancelled in the wallet.");
        }
        result = await requestSeat(pending.txHash);
      }
      for (
        let attempt = 0;
        pending &&
        !result.response.ok &&
        result.payload?.code === "BAD_TX" &&
        attempt < 3;
        attempt += 1
      ) {
        setSitPhase("confirming");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        result = await requestSeat(pending.txHash);
      }
      const seated = result.payload;
      if (
        !result.response.ok ||
        !seated?.table ||
        !seated.leaveToken ||
        seated.seat == null
      ) {
        // Keep unresolved hashes recoverable. No invented seat or local-ready fallback.
        if (
          seated?.refund ||
          seated?.code === "TX_FAILED" ||
          seated?.code === "TX_MISMATCH" ||
          seated?.code === "TX_USED"
        ) {
          clearPendingPlayPayment();
          setPendingPayment(null);
        }
        throw new Error(
          seated?.error ??
            "Entry is not verified yet. Retry this table to check the same payment.",
        );
      }
      clearPendingPlayPayment();
      setPendingPayment(null);
      savePlayPlayer(address);
      savePlaySeat({
        tableId: seated.table.id,
        address,
        seat: seated.seat,
        leaveToken: seated.leaveToken,
        txHash: seated.txHash,
      });
      rememberPreviewGame(game);
      void wallet.refetch();
      router.push(`/room/${seated.table.id}`);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Could not verify your entry.";
      setSitError(
        /user rejected|user denied/i.test(message)
          ? "Cancelled in wallet."
          : message,
      );
    } finally {
      busy.current = false;
      setSitPhase("idle");
      setSitTableId(null);
    }
  }

  return {
    wallet,
    sit,
    sitPhase,
    sitTableId,
    sitError,
    switching,
    pendingPayment,
    switchNetwork: () => {
      void switchChainAsync({ chainId: wallet.expectedChainId });
    },
  };
}
export type PlaySit = ReturnType<typeof usePlaySit>;
