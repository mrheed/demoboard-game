"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDisconnect } from "wagmi";

import { PixelButton } from "@/components/ui/pixel-button";
import { PixelCard } from "@/components/ui/pixel-card";
import { useAuthMe } from "@/hooks/use-auth-me";
import { usePlatformWallet } from "@/hooks/use-platform-wallet";
import { clearBoardSession } from "@/lib/auth/session";
import {
  formatAge,
  formatBoard,
  formatBoardCompact,
  cn,
} from "@/lib/utils";
import { shortenAddress } from "@/lib/wallet/chains";
import { fetchJson } from "@/lib/fetch-json";

/** Recent wins shown in the profile dropdown. */
const RECENT_WINS_SHOWN = 4;

type RecentWin = {
  id: string;
  gameType: "monopoly" | "ludo" | string;
  netPayout: number;
  settledAt: string;
  status: string;
};

/**
 * Profile avatar button + dropdown: balance, recent games, sign out.
 */
export function ProfileMenu({ className }: { className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { disconnect } = useDisconnect();
  const { user, wallet, loading: authLoading, refresh } = useAuthMe();
  const { balance, loading: balanceLoading } = usePlatformWallet({
    enabled: true,
    pollMs: 30_000,
  });

  const [open, setOpen] = useState(false);
  const [wins, setWins] = useState<RecentWin[]>([]);
  const [winsLoading, setWinsLoading] = useState(false);
  const [winsLoadedAt, setWinsLoadedAt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const address = wallet?.address;
  const label = address ? shortenAddress(address) : "Account";
  const available = balance?.available ?? user?.balance ?? 0;
  const locked = balance?.locked ?? 0;

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

  useEffect(() => {
    if (!open) return;

    // Every state write happens in the async continuation, so the effect body
    // itself never calls setState.
    let cancelled = false;

    void (async () => {
      if (cancelled) return;
      setWinsLoading(true);
      try {
        const json = await fetchJson<{ wins?: RecentWin[] }>("/api/wins");
        if (!cancelled) setWins((json.wins ?? []).slice(0, RECENT_WINS_SHOWN));
      } catch {
        if (!cancelled) setWins([]);
      } finally {
        if (!cancelled) {
          // Freeze "now" at load time: reading Date.now() while rendering the
          // list makes the render impure.
          setWinsLoadedAt(Date.now());
          setWinsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("The server could not revoke this session.");
      clearBoardSession();
      try { disconnect(); } catch { /* the server session is already revoked */ }
      await refresh();
      setOpen(false);
      router.push("/");
      router.refresh();
    } catch (caught) {
      setSignOutError(caught instanceof Error ? caught.message : "Could not sign out. Retry.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        aria-label="Open profile menu"
        aria-expanded={open}
        aria-haspopup="menu"
        title={authLoading ? "Account" : label}
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="inline-flex max-w-[10.5rem] items-center justify-center pixel-corners border-[3px] border-void bg-gold px-3 py-2 font-pixel text-xs font-semibold uppercase leading-none text-void shadow-pixel-sm transition-[transform,box-shadow,background-color] duration-100 hover:bg-[#ffe566] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none sm:text-[10px]"
      >
        <span className="truncate">
          {authLoading ? "…" : label}
        </span>
      </button>

      {open ? (
        <PixelCard
          role="menu"
          size="lg"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-[55] w-[min(18.5rem,calc(100vw-1.5rem))]"
          faceClassName="overflow-hidden"
        >
          <div className="border-b-2 border-edge px-3 py-3">
            <p className="font-pixel text-xs font-semibold uppercase leading-none text-gold-deep">
              Profile
            </p>
            <p className="mt-2 break-all font-pixel text-sm font-bold text-parchment">
              {address ? shortenAddress(address, 6) : "no wallet"}
            </p>
            {user?.username ? (
              <p className="mt-1 font-pixel text-xs uppercase text-faint">
                {user.username}
              </p>
            ) : null}
          </div>

          <div className="border-b-2 border-edge px-3 py-3">
            <p className="font-pixel text-xs uppercase tracking-wider text-faint">
              Balance
            </p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div>
                <p className="font-pixel text-xs uppercase text-muted">
                  Available
                </p>
                <p className="mt-1 font-pixel text-[12px] text-gold">
                  {balanceLoading && balance == null
                    ? "…"
                    : formatBoardCompact(available)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-pixel text-xs uppercase text-muted">
                  Locked
                </p>
                <p className="mt-1 font-pixel text-[10px] text-parchment">
                  {formatBoardCompact(locked)}
                </p>
              </div>
            </div>
            <p className="mt-2 font-pixel text-xs uppercase text-faint">
              Available to stake
            </p>
          </div>

          <div className="border-b-2 border-edge px-3 py-3">
            <p className="font-pixel text-xs uppercase tracking-wider text-faint">
              Legacy BOARD history
            </p>
            <Link href="/play/history" onClick={() => setOpen(false)} className="mt-3 block text-sm text-gold underline">USDG Ludo matches and refunds</Link>

            {winsLoading ? (
              <p className="mt-3 font-pixel text-xs uppercase text-muted">
                Loading…
              </p>
            ) : wins.length === 0 ? (
              <p className="mt-3 text-[10px] leading-relaxed text-muted">
                No wins yet. Sit a table in the lobby.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {wins.map((win) => (
                  <li
                    key={win.id}
                    className="flex items-center justify-between gap-2 border border-edge bg-surface/40 px-2 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block font-pixel text-xs uppercase text-parchment">
                        {win.gameType}
                      </span>
                      <span className="mt-1 block font-pixel text-[11px] uppercase text-faint">
                        {formatAge(win.settledAt, winsLoadedAt)}
                      </span>
                    </span>
                    <span className="shrink-0 font-pixel text-xs text-gold">
                      +{formatBoard(win.netPayout)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2 p-3">
            <Link
              href="/account"
              role="menuitem"
              className="pixel-corners inline-flex items-center justify-center border-[3px] border-void bg-cream px-3 py-2 font-pixel text-xs font-semibold uppercase leading-none text-parchment shadow-pixel-sm hover:bg-gold"
              onClick={() => {
                setOpen(false);
              }}
            >
              Full account
            </Link>
            <PixelButton
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </PixelButton>
            {signOutError ? (
              <p role="alert" className="text-xs text-red-300">{signOutError}</p>
            ) : null}
          </div>
        </PixelCard>
      ) : null}
    </div>
  );
}
