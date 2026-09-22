"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ProfileMenu } from "@/components/account/profile-menu";
import { SignInButton } from "@/components/account/sign-in-button";
import { AudioControlsPopover } from "@/components/audio/audio-controls-popover";
import { DemoLeaveButton } from "@/components/demo/demo-leave-button";
import { BoardLogo } from "@/components/layout/board-logo";
import { LinksMenu } from "@/components/layout/links-menu";
import { PixelButtonLink } from "@/components/ui/pixel-button";
import { BalanceWidget } from "@/components/wallet/balance-widget";
import { useAuthMe } from "@/hooks/use-auth-me";
import { useDemoAccess } from "@/hooks/use-demo-access";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/faq", label: "FAQ" },
  { href: "/how-to", label: "How to play" },
  { href: "/rules", label: "Prizes & fees" },
] as const;

const NAV_CHIP =
  "inline-flex shrink-0 items-center rounded-full px-3 py-2 font-pixel text-xs font-semibold uppercase leading-none tracking-[0.12em] text-parchment transition-[transform,colors] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-gold hover:text-void active:translate-y-px";

export function SiteHeader({ className }: { className?: string }) {
  const pathname = usePathname();
  const { authenticated, loading } = useAuthMe();
  const { unlocked } = useDemoAccess();
  const navLinks = NAV_LINKS;
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;
  const panelId = useId();

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuPath(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <>
      <header
        className={cn(
          "pointer-events-none fixed inset-x-0 top-0 z-[40] pt-[env(safe-area-inset-top)]",
          className,
        )}
      >
        <div className="pointer-events-auto mx-3 mt-3 sm:mx-5 sm:mt-4 lg:mx-auto lg:max-w-[64rem] lg:px-6 xl:max-w-[68rem]">
          <div
            className={cn(
              "border-[3px] border-void bg-cream shadow-pixel transition-[border-radius] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
              menuOpen ? "rounded-[1.75rem]" : "rounded-full",
            )}
          >
            <div
              className={cn(menuOpen ? "rounded-[1.6rem]" : "rounded-full")}
            >
              <div className="flex h-14 items-center gap-1.5 px-2 sm:h-[3.75rem] sm:gap-2 sm:px-2.5">
                <Link
                  href="/"
                  aria-label="BOARD home"
                  className="shrink-0 rounded-full px-1 py-1"
                >
                  <BoardLogo
                    variant="mark"
                    className="text-base text-parchment sm:text-lg"
                  />
                </Link>

                <nav
                  aria-label="Primary"
                  className="hidden min-w-0 flex-1 items-center gap-0.5 lg:flex"
                >
                  {navLinks.map((link) => (
                    <NavChip
                      key={link.href}
                      href={link.href}
                      label={link.label}
                      active={isActivePath(pathname, link.href)}
                    />
                  ))}
                  <LinksMenu label="Community" triggerClassName={NAV_CHIP} />
                </nav>

                <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
                  <AudioControlsPopover />
                  {unlocked && authenticated ? (
                    <BalanceWidget
                      compact
                      live
                      className="hidden lg:inline-flex"
                    />
                  ) : null}

                  {unlocked ? (
                    authenticated ? (
                      <ProfileMenu />
                    ) : (
                      <SignInButton
                        variant="ghost"
                        size="sm"
                        className="hidden rounded-full px-3 text-xs text-parchment hover:bg-gold hover:text-void sm:inline-flex"
                      >
                        {loading ? "…" : "Sign in"}
                      </SignInButton>
                    )
                  ) : null}

                  {unlocked ? (
                    <DemoLeaveButton className="hidden rounded-full px-3 text-xs text-parchment hover:bg-gold hover:text-void lg:inline-flex" />
                  ) : null}

                  <button
                    type="button"
                    className="grid size-9 shrink-0 place-items-center rounded-full border-[3px] border-void bg-cream text-parchment transition-colors duration-200 hover:bg-gold lg:hidden"
                    aria-expanded={menuOpen}
                    aria-controls={panelId}
                    aria-haspopup="true"
                    data-nav-menu-toggle
                    onClick={() => {
                      setMenuPath(menuOpen ? null : pathname);
                    }}
                  >
                    <span className="sr-only">
                      {menuOpen ? "Close menu" : "Open menu"}
                    </span>
                    <span aria-hidden className="relative block size-3.5">
                      <span
                        className={cn(
                          "absolute left-0 block h-[3px] w-3.5 bg-current transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
                          menuOpen ? "top-[5px] rotate-45" : "top-[2px]",
                        )}
                      />
                      <span
                        className={cn(
                          "absolute left-0 block h-[3px] w-3.5 bg-current transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
                          menuOpen ? "top-[5px] -rotate-45" : "top-[9px]",
                        )}
                      />
                    </span>
                  </button>

                  <PixelButtonLink
                    href="/play"
                    variant="primary"
                    size="sm"
                    aria-current={
                      isActivePath(pathname, "/play") ? "page" : undefined
                    }
                    className={cn(
                      "rounded-full px-3 whitespace-nowrap shadow-pixel-sm sm:px-4",
                      isActivePath(pathname, "/play") &&
                        "bg-void text-gold hover:bg-void hover:text-gold",
                    )}
                  >
                    Play
                  </PixelButtonLink>
                </div>
              </div>

              {menuOpen ? (
                <nav
                  id={panelId}
                  aria-label="Primary"
                  className="flex flex-col gap-1 border-t-[3px] border-void px-3 py-3 lg:hidden"
                >
                  {navLinks.map((link) => (
                    <NavChip
                      key={link.href}
                      href={link.href}
                      label={link.label}
                      active={isActivePath(pathname, link.href)}
                      className="w-full justify-start px-3 py-3"
                    />
                  ))}
                  <LinksMenu
                    label="Community"
                    variant="inline"
                    className="w-full"
                    triggerClassName={cn(NAV_CHIP, "w-full justify-start px-3 py-3")}
                  />
                  {unlocked ? (
                    <div className="mt-2 px-1 pt-2">
                      <DemoLeaveButton className="rounded-full px-3 text-xs text-parchment hover:bg-gold hover:text-void" />
                    </div>
                  ) : null}
                </nav>
              ) : null}
            </div>
          </div>
        </div>
      </header>
      <div
        aria-hidden
        className="h-[4.75rem] shrink-0 pt-[env(safe-area-inset-top)] sm:h-[5.25rem]"
      />
    </>
  );
}

function NavChip({
  href,
  label,
  active,
  className,
}: {
  href: string;
  label: string;
  active: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(NAV_CHIP, active && "bg-void text-gold hover:bg-void hover:text-gold", className)}
    >
      {label}
    </Link>
  );
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
