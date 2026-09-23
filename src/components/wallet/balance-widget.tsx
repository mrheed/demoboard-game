"use client";

import { Wallet } from "lucide-react";

import { BoardAmount } from "@/components/ui/board-amount";
import { PixelCard } from "@/components/ui/pixel-card";
import { usePlatformWallet } from "@/hooks/use-platform-wallet";
import { MOCK_WALLET_BALANCE } from "@/lib/mock/wallet";
import type { WalletBalance } from "@/lib/types";
import { cn } from "@/lib/utils";

type BalanceWidgetProps = {
  balance?: WalletBalance;
  /** When true, fetch live balance from /api/wallet. */
  live?: boolean;
  /** Compact chip for the site header. */
  compact?: boolean;
  className?: string;
};

/**
 * Shared BOARD balance readout · available (+ locked when expanded).
 */
export function BalanceWidget({
  balance,
  live = false,
  compact = false,
  className,
}: BalanceWidgetProps) {
  const liveState = usePlatformWallet({
    enabled: live,
    pollMs: live ? 30_000 : 0,
  });
  const resolved = balance ?? (live ? liveState.balance : MOCK_WALLET_BALANCE);

  if (!resolved) {
    const label = liveState.loading ? "Loading…" : "Balance unavailable";
    if (compact) {
      return (
        <div className={cn("pixel-corners inline-flex items-center gap-2 border-[3px] border-void bg-gold px-3 py-2", className)}>
          <Wallet className="size-3.5 text-void" aria-hidden />
          <span className="font-pixel text-xs uppercase text-void">{label}</span>
        </div>
      );
    }
    return (
      <PixelCard size="sm" tone="cream" className={className} faceClassName="p-4">
        <p className="font-pixel text-xs font-bold uppercase tracking-wide text-faint">BOARD balance</p>
        <p role={liveState.error ? "alert" : undefined} className="mt-2 text-sm text-muted">{label}</p>
      </PixelCard>
    );
  }

  if (compact) {
    return (
      <div
        className={cn(
          "pixel-corners inline-flex items-center gap-2 border-[3px] border-void bg-gold px-3 py-2",
          className,
        )}
        title="BOARD available"
      >
        <Wallet className="size-3.5 text-void" aria-hidden />
        <BoardAmount value={resolved.available} size="sm" tone="default" compact />
        <span className="sr-only">BOARD available</span>
      </div>
    );
  }

  return (
    <PixelCard
      size="sm"
      tone="cream"
      className={className}
      faceClassName="p-4"
    >
      <p className="font-pixel text-xs font-bold uppercase tracking-wide text-faint">
        BOARD balance
      </p>
      <div className="mt-2">
        <BoardAmount value={resolved.available} size="lg" tone="gold" />
      </div>
      <p className="mt-2 text-xs text-muted">
        Available to join rooms · locked{" "}
        <BoardAmount value={resolved.locked} size="xs" tone="muted" />
      </p>
    </PixelCard>
  );
}
