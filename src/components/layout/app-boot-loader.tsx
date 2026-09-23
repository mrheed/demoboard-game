"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import Image from "next/image";

import { PIP_LAYOUT, randomDie, type DieValue } from "@/lib/game/dice";
import { prefersReducedMotion } from "@/lib/motion/gsap-config";
import { cn } from "@/lib/utils";

const MIN_MS = 400;
const MAX_MS = 1800;
const BOOT_SEEN_KEY = "board.boot.seen";

type Phase = "loading" | "leaving" | "gone";

/**
 * Full-viewport boot splash on first document load.
 * Dice roll is the hero motion; no typing / cursor effects.
 */
export function AppBootLoader() {
  const root = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState(6);
  const [faces, setFaces] = useState<readonly [DieValue, DieValue]>([5, 3]);
  const startedAt = useRef(0);

  // No mount guard: effects only run on the client, and `mounted` was never
  // read during render, so the extra state was one wasted render pass.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(BOOT_SEEN_KEY) === "1") {
        const timer = window.setTimeout(() => setPhase("gone"), 0);
        return () => window.clearTimeout(timer);
      }
    } catch {
      // private mode still shows the splash
    }

    startedAt.current = performance.now();
    const reduced = prefersReducedMotion();
    const node = root.current;

    document.documentElement.dataset.boardBoot = "1";
    document.body.style.overflow = "hidden";

    let progressTimer = 0;
    let leaveTimer = 0;
    let hardCap = 0;
    let finished = false;
    let rollTl: gsap.core.Timeline | null = null;
    let flicker = 0;

    const tickProgress = () => {
      setProgress((p) => {
        if (p >= 88) return p;
        const next = p + (p < 40 ? 1.8 : p < 70 ? 0.9 : 0.35);
        return Math.min(88, next);
      });
      progressTimer = window.setTimeout(tickProgress, 70);
    };

    if (!reduced) {
      progressTimer = window.setTimeout(tickProgress, 80);
    } else {
      // Deferred rather than set inline: a synchronous setState in an effect
      // body forces a second render pass before paint.
      progressTimer = window.setTimeout(() => setProgress(92), 0);
    }

    if (node && !reduced) {
      const dieA = node.querySelector<HTMLElement>("[data-boot-die='a']");
      const dieB = node.querySelector<HTMLElement>("[data-boot-die='b']");
      const shadowA = node.querySelector<HTMLElement>("[data-boot-shadow='a']");
      const shadowB = node.querySelector<HTMLElement>("[data-boot-shadow='b']");

      if (dieA && dieB) {
        const clearFlicker = () => {
          if (flicker) window.clearInterval(flicker);
          flicker = 0;
        };

        rollTl = gsap.timeline({ repeat: -1, repeatDelay: 0.35 });

        rollTl.to([dieA, dieB], {
          rotation: (i) => (i === 0 ? -10 : 12),
          y: -3,
          duration: 0.16,
          yoyo: true,
          repeat: 2,
          ease: "sine.inOut",
          stagger: 0.04,
        });

        rollTl.to([dieA, dieB], {
          x: (i) => (i === 0 ? -8 : 8),
          rotation: (i) => (i === 0 ? -22 : 24),
          duration: 0.045,
          yoyo: true,
          repeat: 7,
          ease: "none",
          stagger: 0.015,
        });

        rollTl.add(() => {
          clearFlicker();
          flicker = window.setInterval(() => {
            setFaces([randomDie(), randomDie()]);
          }, 50);
        });

        rollTl
          .to(
            [dieA, dieB],
            {
              y: (i) => (i === 0 ? -72 : -88),
              x: (i) => (i === 0 ? -18 : 22),
              rotation: (i) => (i === 0 ? "+=380" : "-=420"),
              scale: 1.18,
              duration: 0.42,
              ease: "power2.out",
              stagger: 0.04,
            },
            "<",
          )
          .to(
            [shadowA, shadowB].filter(Boolean),
            {
              scaleX: 0.55,
              opacity: 0.35,
              duration: 0.42,
              ease: "power2.out",
            },
            "<",
          );

        rollTl
          .to([dieA, dieB], {
            y: 0,
            x: 0,
            rotation: (i) => (i === 0 ? -6 : 8),
            scale: 1,
            duration: 0.38,
            ease: "bounce.out",
            stagger: 0.05,
          })
          .to(
            [shadowA, shadowB].filter(Boolean),
            {
              scaleX: 1,
              opacity: 0.6,
              duration: 0.38,
              ease: "bounce.out",
            },
            "<",
          );

        rollTl.add(() => {
          clearFlicker();
          setFaces([randomDie(), randomDie()]);
        });

        rollTl.to([dieA, dieB], {
          rotation: 0,
          duration: 0.2,
          ease: "power2.out",
        });

        rollTl.to({}, { duration: 0.35 });
      }
    }

    const finish = async () => {
      if (finished) return;
      finished = true;

      try {
        if (document.fonts?.ready) {
          await Promise.race([
            document.fonts.ready,
            new Promise((resolve) => setTimeout(resolve, 800)),
          ]);
        }
      } catch {
        // ignore
      }

      const elapsed = performance.now() - startedAt.current;
      const wait = reduced ? 0 : Math.max(0, MIN_MS - elapsed);

      leaveTimer = window.setTimeout(() => {
        setProgress(100);
        rollTl?.kill();
        rollTl = null;
        if (flicker) {
          window.clearInterval(flicker);
          flicker = 0;
        }
        setPhase("leaving");
        window.setTimeout(() => {
          setPhase("gone");
          try {
            window.sessionStorage.setItem(BOOT_SEEN_KEY, "1");
          } catch {
            // ignore
          }
          delete document.documentElement.dataset.boardBoot;
          document.body.style.overflow = "";
        }, reduced ? 0 : 220);
      }, wait);
    };

    const onReady = () => {
      void finish();
    };

    if (document.readyState === "complete") {
      onReady();
    } else {
      window.addEventListener("load", onReady, { once: true });
    }

    hardCap = window.setTimeout(onReady, MAX_MS);

    return () => {
      window.clearTimeout(progressTimer);
      window.clearTimeout(leaveTimer);
      window.clearTimeout(hardCap);
      if (flicker) window.clearInterval(flicker);
      window.removeEventListener("load", onReady);
      rollTl?.kill();
      delete document.documentElement.dataset.boardBoot;
      document.body.style.overflow = "";
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      ref={root}
      role="status"
      aria-live="polite"
      aria-busy={phase === "loading"}
      aria-label="Loading BOARD"
      className={cn(
        "fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#7ed6ff]",
        "transition-opacity duration-[420ms] ease-out",
        phase === "leaving" && "pointer-events-none opacity-0",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "url('/pixel-playground.svg')",
          backgroundSize: "cover",
          backgroundPosition: "center top",
          imageRendering: "pixelated",
        }}
      />

      <div className="relative z-10 flex w-full max-w-[20rem] flex-col items-center px-6">
        <Image
          src="/board-logo.png"
          alt=""
          width={40}
          height={40}
          data-pixel
          className="mb-5 size-9 bg-transparent sm:size-10"
          draggable={false}
          priority
        />

        <p className="font-pixel text-[clamp(2rem,6vw,2.6rem)] font-bold leading-[1.25] text-parchment">
          BOARD
        </p>

        <div
          aria-hidden
          className="mt-8 flex items-end justify-center gap-5 sm:gap-6"
        >
          <BootDie face={faces[0]} which="a" />
          <BootDie face={faces[1]} which="b" />
        </div>

        <p className="mt-8 font-pixel text-xs font-semibold uppercase text-muted">
          Rolling tables
        </p>

        <div className="mt-6 w-full">
          <div className="h-4 w-full overflow-hidden pixel-corners border-[3px] border-void bg-cream p-0.5 shadow-pixel-sm">
            <div
              className="h-full bg-gold transition-[width] duration-150 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between font-pixel text-xs font-semibold uppercase text-faint">
            <span>{phase === "leaving" ? "Ready" : "Loading"}</span>
            <span className="text-gold-deep">{Math.round(progress)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BootDie({
  face,
  which,
}: {
  face: DieValue;
  which: "a" | "b";
}) {
  const pips = PIP_LAYOUT[face];

  return (
    <div className="relative">
      <div
        data-boot-shadow={which}
        className="absolute -bottom-2.5 left-1/2 h-2.5 w-[78%] -translate-x-1/2 bg-void/35"
      />
      <div
        data-boot-die={which}
        className="relative grid size-[4.25rem] grid-cols-3 grid-rows-3 gap-1.5 pixel-corners border-4 border-void bg-cream p-1.5 shadow-pixel-lg sm:size-[4.75rem] sm:gap-[7px] sm:p-2"
        style={{ transformOrigin: "50% 85%" }}
      >
        <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-white/35" />
        <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-white/20" />
        {Array.from({ length: 9 }, (_, cell) => (
          <span
            key={cell}
            className={cn(
              pips.includes(cell) ? "bg-void pixel-corners" : "bg-transparent",
            )}
          />
        ))}
      </div>
    </div>
  );
}
