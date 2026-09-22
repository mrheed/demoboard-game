"use client";

import { Globe } from "lucide-react";

import { AudioControlsPopover } from "@/components/audio/audio-controls-popover";
import {
  DexscreenerLogo,
  TelegramLogo,
  XLogo,
} from "@/components/icons/brand-logos";
import { PlayWalletChip } from "@/components/play/play-wallet-chip";
import { COMMUNITY_LINKS } from "@/lib/community-links";
import { cn } from "@/lib/utils";
import { getWebsiteUrl } from "@/lib/website-url";

/**
 * Game-client HUD. Wallet + social top-right, speaker bottom-left.
 * The hanging wooden sign on the arena is the identity. No website logo.
 */
export function PlayChrome() {
  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <div className="pointer-events-auto absolute right-2 top-2 flex max-w-[calc(100%-0.75rem)] flex-wrap items-center justify-end gap-2 sm:right-4 sm:top-4">
        <PlaySocialCapsule />
        <PlayWalletChip />
      </div>
      <div className="pointer-events-auto absolute bottom-3 left-3 sm:bottom-4 sm:left-4">
        <AudioControlsPopover panel="corner" />
      </div>
    </div>
  );
}

function PlaySocialCapsule() {
  const x = COMMUNITY_LINKS.find((link) => link.id === "x");
  const telegram = COMMUNITY_LINKS.find((link) => link.id === "telegram");
  const dex = COMMUNITY_LINKS.find((link) => link.id === "dexscreener");

  return (
    <div className="flex items-center gap-1 rounded-full border-[3px] border-void bg-[#2a160c]/92 p-1 shadow-pixel-sm">
      {x ? (
        <SocialIcon href={x.href} label="X">
          <XLogo className="size-3.5" />
        </SocialIcon>
      ) : null}
      <SocialIcon href={getWebsiteUrl()} label="BOARD website">
        <Globe className="size-3.5" aria-hidden />
      </SocialIcon>
      {telegram ? (
        <SocialIcon href={telegram.href} label="Telegram">
          <TelegramLogo className="size-3.5" />
        </SocialIcon>
      ) : null}
      {dex ? (
        <SocialIcon href={dex.href} label="Dexscreener">
          <DexscreenerLogo className="size-3.5" />
        </SocialIcon>
      ) : null}
    </div>
  );
}

function SocialIcon({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  const className = cn(
    "grid size-8 place-items-center rounded-full text-cream transition-colors duration-150",
    "hover:bg-gold hover:text-void",
  );

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={className}
    >
      {children}
    </a>
  );
}
