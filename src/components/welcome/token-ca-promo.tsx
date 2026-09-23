"use client";

import { useState } from "react";

import { PixelButton } from "@/components/ui/pixel-button";
import { PixelCard } from "@/components/ui/pixel-card";
import { shortenAddress } from "@/lib/wallet/chains";
import { cn } from "@/lib/utils";

type TokenCaPromoProps = {
  address: `0x${string}` | null;
  explorerUrl: string | null;
  chainLabel: string;
  /** Slim strip for the hero dock; full card elsewhere. */
  compact?: boolean;
  className?: string;
};

/**
 * BOARD ERC-20 contract address promo. Copy plus explorer.
 */
export function TokenCaPromo({
  address,
  explorerUrl,
  chainLabel,
  compact = false,
  className,
}: TokenCaPromoProps) {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can fail without permission. Leave UI unchanged.
    }
  }

  if (compact) {
    return (
      <aside
        aria-labelledby="token-ca-title"
        className={cn("border-t-[3px] border-void pt-4", className)}
      >
        <div className="flex items-baseline justify-between gap-3">
          <p
            id="token-ca-title"
            className="font-pixel text-xs font-semibold uppercase leading-none text-gold-deep"
          >
            Token CA
          </p>
          <p className="font-pixel text-xs font-semibold uppercase leading-none text-faint">
            {chainLabel}
          </p>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-muted">
          BOARD token only. Paid Ludo uses canonical USDG, not this contract.
        </p>

        {address ? (
          <>
            <p
              className="mt-2 break-all font-pixel text-xs leading-relaxed text-parchment sm:text-sm"
              title={address}
            >
              <span className="sm:hidden">{shortenAddress(address, 6)}</span>
              <span className="hidden sm:inline">{address}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <PixelButton
                type="button"
                size="sm"
                variant="primary"
                onClick={copyAddress}
                aria-live="polite"
              >
                {copied ? "Copied" : "Copy CA"}
              </PixelButton>
              {explorerUrl ? (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "pixel-corners inline-flex select-none items-center justify-center border-2 border-edge-bright",
                    "bg-transparent px-3 py-2 font-pixel text-xs uppercase text-parchment shadow-pixel-sm",
                    "transition-[transform,box-shadow,background-color] duration-100",
                    "hover:bg-surface-hover active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                  )}
                >
                  Explorer
                </a>
              ) : null}
            </div>
          </>
        ) : (
          <p className="mt-2 font-pixel text-xs leading-relaxed text-muted sm:text-xs">
            CA soon. Verify here before you trade.
          </p>
        )}
      </aside>
    );
  }

  return (
    <PixelCard
      as="aside"
      aria-labelledby="token-ca-title"
      tone="goldWash"
      stroke="gold"
      className={className}
      faceClassName="p-5 sm:p-6"
    >
      <p className="font-pixel text-xs uppercase tracking-[0.2em] text-gold">
        Official contract
      </p>
      <h3
        id="token-ca-title"
        className="mt-2 font-pixel text-[11px] leading-snug text-parchment sm:text-xs"
      >
        BOARD token CA
      </h3>
      <p className="mt-2 max-w-[48ch] text-xs leading-relaxed text-muted sm:text-xs">
        Optional BOARD token on {chainLabel}. Paid Ludo entries and payouts use
        canonical USDG through the operator treasury, not this token contract.
      </p>

      {address ? (
        <>
          <div className="mt-5 border-2 border-edge bg-ink px-3 py-3 sm:px-4">
            <p className="font-pixel text-xs uppercase tracking-wider text-faint">
              Contract address
            </p>
            <p
              className="mt-2 break-all font-pixel text-[11px] leading-relaxed text-gold sm:text-xs"
              title={address}
            >
              <span className="sm:hidden">{shortenAddress(address, 6)}</span>
              <span className="hidden sm:inline">{address}</span>
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <PixelButton
              type="button"
              size="sm"
              variant="primary"
              onClick={copyAddress}
              aria-live="polite"
            >
              {copied ? "Copied" : "Copy CA"}
            </PixelButton>
            {explorerUrl ? (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "pixel-corners inline-flex select-none items-center justify-center border-2 border-edge-bright",
                  "bg-transparent px-3 py-2 font-pixel text-xs uppercase text-parchment shadow-pixel-sm",
                  "transition-[transform,box-shadow,background-color] duration-100",
                  "hover:bg-surface-hover active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                )}
              >
                View on explorer
              </a>
            ) : null}
          </div>
        </>
      ) : (
        <div className="mt-5 border-2 border-dashed border-edge bg-ink/60 px-3 py-4 sm:px-4">
          <p className="font-pixel text-xs uppercase tracking-wider text-gold">
            CA soon
          </p>
          <p className="mt-2 font-pixel text-xs leading-relaxed text-muted sm:text-[10px]">
            Contract address will appear here the moment BOARD is live on{" "}
            {chainLabel}. Bookmark this page and verify the CA before trading.
          </p>
        </div>
      )}
    </PixelCard>
  );
}
