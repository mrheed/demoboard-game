"use client";

import { useEffect, useRef, useState } from "react";
import { useDisconnect, useSwitchChain } from "wagmi";

import { useSignIn } from "@/components/account/sign-in-provider";
import { PixelButton } from "@/components/ui/pixel-button";
import { PixelCard } from "@/components/ui/pixel-card";
import { useBoardTokenBalance } from "@/hooks/use-board-token-balance";
import { useClientReady } from "@/hooks/use-client-ready";
import { formatPlayAmount, PLAY_STAKE_SYMBOL } from "@/lib/game/play-player";
import { cn } from "@/lib/utils";
import {
  getBoardChainLabel,
  shortenAddress,
} from "@/lib/wallet/chains";

/**
 * Play HUD wallet: address + live USDG balance, pinned top-right.
 */
export function PlayWalletChip() {
  const root = useRef<HTMLDivElement>(null);
  const wallet = useBoardTokenBalance();
  const ready = useClientReady();
  const { openSignIn } = useSignIn();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!ready || !wallet.isConnected || !wallet.address) {
    return (
      <PixelButton
        type="button"
        size="sm"
        variant="primary"
        onClick={openSignIn}
      >
        Connect
      </PixelButton>
    );
  }

  const label = shortenAddress(wallet.address, 4);
  const balance =
    wallet.amount === null
      ? wallet.loading
        ? "…"
        : "…"
      : formatPlayAmount(wallet.amount);

  async function copyAddress() {
    if (!wallet.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={`Wallet ${label}, ${balance} ${PLAY_STAKE_SYMBOL}`}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${label} · ${balance} ${PLAY_STAKE_SYMBOL}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex items-stretch overflow-hidden pixel-corners border-[3px] border-void shadow-pixel-sm",
          "transition-[transform,box-shadow] duration-100",
          "hover:-translate-y-px active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
        )}
      >
        <span className="flex min-w-0 flex-col justify-center gap-0.5 bg-[#1a0c06] px-2.5 py-1.5 text-left">
          <span className="font-pixel text-[9px] font-semibold uppercase leading-none tracking-[0.14em] text-gold">
            Wallet
          </span>
          <span className="font-sans text-[12px] font-semibold leading-none tracking-tight text-cream">
            {label}
          </span>
        </span>
        <span className="flex items-baseline gap-1 bg-gold px-2.5 py-1.5">
          <span className="font-sans text-[17px] font-bold tabular-nums leading-none tracking-tight text-void">
            {balance}
          </span>
          <span className="font-sans text-[11px] font-bold leading-none text-void/70">
            {PLAY_STAKE_SYMBOL}
          </span>
        </span>
      </button>

      {open ? (
        <PixelCard
          role="menu"
          size="md"
          tone="cream"
          className="absolute right-0 top-[calc(100%+0.45rem)] z-[55] w-[min(17.5rem,calc(100vw-1.5rem))]"
          faceClassName="overflow-hidden"
        >
          <div className="border-b-[3px] border-void bg-[#1a0c06] px-3 py-2.5">
            <p className="font-pixel text-[9px] font-semibold uppercase tracking-[0.14em] text-gold">
              Connected
            </p>
            <p className="mt-1.5 break-all font-sans text-[12px] font-semibold leading-snug tracking-tight text-cream">
              {wallet.address}
            </p>
          </div>

          <div className="px-3 py-3">
            <p className="font-pixel text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
              Balance
            </p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className="font-sans text-[28px] font-bold tabular-nums leading-none tracking-tight text-void">
                {balance}
              </span>
              <span className="font-sans text-sm font-bold text-void/55">
                {PLAY_STAKE_SYMBOL}
              </span>
            </p>
            <p className="mt-2 font-sans text-[12px] leading-snug text-muted">
              {wallet.onNetwork
                ? getBoardChainLabel()
                : `Wrong network · switch to ${getBoardChainLabel()}`}
            </p>
            {wallet.onNetwork && !wallet.canEnter && wallet.shortfall > 0 ? (
              <p className="mt-1 font-sans text-[12px] leading-snug text-gold-deep">
                Need {formatPlayAmount(wallet.shortfall)} {PLAY_STAKE_SYMBOL} more
                to sit.
              </p>
            ) : null}
            {wallet.onNetwork && wallet.hasEntry && !wallet.hasGas ? (
              <p className="mt-1 font-sans text-[12px] leading-snug text-gold-deep">
                Add a small amount of ETH for Robinhood Chain gas.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 border-t-[3px] border-void px-3 py-3">
            <PixelButton
              type="button"
              size="sm"
              variant="outline"
              className="w-full justify-center"
              onClick={() => void copyAddress()}
            >
              {copied ? "Copied" : "Copy address"}
            </PixelButton>
            {!wallet.onNetwork ? (
              <PixelButton
                type="button"
                size="sm"
                variant="primary"
                className="w-full justify-center"
                disabled={switching}
                onClick={() => {
                  void switchChainAsync({ chainId: wallet.expectedChainId });
                }}
              >
                {switching ? "Switching…" : "Switch network"}
              </PixelButton>
            ) : null}
            <PixelButton
              type="button"
              size="sm"
              variant="secondary"
              className="w-full justify-center"
              onClick={() => {
                setOpen(false);
                disconnect();
              }}
            >
              Disconnect
            </PixelButton>
          </div>
        </PixelCard>
      ) : null}
    </div>
  );
}
