"use client";

import Link from "next/link";
import { useAccount, useSwitchChain } from "wagmi";

import { useSignIn } from "@/components/account/sign-in-provider";
import { PixelButton } from "@/components/ui/pixel-button";
import { PixelCard } from "@/components/ui/pixel-card";
import { usePlatformWallet } from "@/hooks/use-platform-wallet";
import {
  getBoardChainId,
  getBoardChainLabel,
  shortenAddress,
} from "@/lib/wallet/chains";
import { cn } from "@/lib/utils";

/**
 * Live network + wallet status for deposit/withdraw readiness.
 */
export function NetworkStatusBanner({ className }: { className?: string }) {
  const expectedChainId = getBoardChainId();
  const chainLabel = getBoardChainLabel();
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const { data, loading } = usePlatformWallet();
  const { openSignIn } = useSignIn();

  const wrongNetwork =
    isConnected && typeof chainId === "number" && chainId !== expectedChainId;
  const profileAddress = data?.network.walletAddress?.toLowerCase();
  const connectedAddress = address?.toLowerCase();
  const linked = Boolean(
    data?.network.connected &&
      profileAddress &&
      connectedAddress &&
      profileAddress === connectedAddress,
  );
  const profileMismatch = Boolean(
    data?.network.connected && profileAddress && connectedAddress && profileAddress !== connectedAddress,
  );
  const connected = isConnected && !wrongNetwork;

  const tone = !isConnected
    ? "bad"
    : wrongNetwork
      ? "warn"
      : linked
        ? "ok"
        : "warn";

  const walletLabel = address
    ? shortenAddress(address)
    : data?.network.walletAddress
      ? shortenAddress(data.network.walletAddress)
      : "No wallet connected";

  const warning = !isConnected
    ? `Connect a ${chainLabel} wallet before depositing or withdrawing.`
    : wrongNetwork
      ? `Your wallet is on the wrong network. Switch to ${chainLabel} (chain ID ${expectedChainId}).`
      : profileMismatch
        ? "This connected wallet is not the wallet linked to your signed-in BOARD profile. Switch accounts or sign in again."
        : !linked
          ? "Wallet connected · sign in to link it to your BOARD profile."
        : null;

  return (
    <div className={cn("space-y-3", className)}>
      <PixelCard
        size="sm"
        stroke={tone === "ok" ? "void" : tone === "bad" ? "danger" : "gold"}
        tone={tone === "ok" ? "surface" : tone === "bad" ? "surface" : "goldWash"}
        faceClassName={cn(
          "px-4 py-3",
          tone === "ok" &&
            "bg-[color-mix(in_srgb,var(--color-success)_10%,var(--color-surface))]",
          tone === "bad" &&
            "bg-[color-mix(in_srgb,var(--color-danger)_10%,var(--color-surface))]",
        )}
        role="status"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-pixel text-xs uppercase tracking-wide text-parchment">
            {loading
              ? "Checking wallet…"
              : connected
                ? linked
                  ? "Wallet linked"
                  : "Wallet connected"
                : "Wallet disconnected"}
          </p>
          <p
            className={cn(
              "font-pixel text-xs uppercase",
              tone === "ok" && "text-success",
              tone === "warn" && "text-gold",
              tone === "bad" && "text-danger",
            )}
          >
            {wrongNetwork ? "Wrong network" : chainLabel}
          </p>
        </div>
        <p className="mt-2 text-xs text-muted">{walletLabel}</p>
        {warning ? (
          <p
            role="alert"
            className={cn(
              "mt-3 text-sm leading-relaxed",
              tone === "bad" ? "text-danger" : "text-gold",
            )}
          >
            {warning}
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">
            Ready to deposit or withdraw on {chainLabel}.
          </p>
        )}
      </PixelCard>

      <div className="flex flex-wrap gap-2">
        {!isConnected ? (
          <PixelButton type="button" size="sm" onClick={openSignIn}>
            Sign in with wallet
          </PixelButton>
        ) : null}
        {wrongNetwork ? (
          <PixelButton
            type="button"
            size="sm"
            onClick={() => switchChain({ chainId: expectedChainId })}
            disabled={isPending}
          >
            {isPending ? "Switching…" : "Switch network"}
          </PixelButton>
        ) : null}
        {isConnected && !wrongNetwork && !linked ? (
          <PixelButton
            type="button"
            size="sm"
            variant="secondary"
            onClick={openSignIn}
          >
            Sign in to link
          </PixelButton>
        ) : null}
        {isConnected ? (
          <Link
            href="/account"
            className="px-3 py-2 font-pixel text-xs uppercase text-muted hover:text-gold"
          >
            Account
          </Link>
        ) : null}
      </div>
    </div>
  );
}
