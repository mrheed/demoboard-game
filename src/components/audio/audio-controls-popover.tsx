"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { PixelButton } from "@/components/ui/pixel-button";
import { PixelCard } from "@/components/ui/pixel-card";
import {
  audioManager,
  playSfx,
  unlockAudio,
} from "@/lib/audio/audio-manager";
import { cn } from "@/lib/utils";

const STEP = 0.1;

/**
 * Header sound control. On narrow screens the panel is a full-width sheet
 * under the header so it never clips off the left edge.
 */
export function AudioControlsPopover({
  className,
  panel = "header",
}: {
  className?: string;
  /** `corner` opens the mixer above a bottom-left control. */
  panel?: "header" | "corner";
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVolume(audioManager.getVolume());
      setMuted(audioManager.isMuted());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;

    function onPointer(event: PointerEvent) {
      const node = event.target;
      if (!(node instanceof Node)) return;
      if (root.current?.contains(node)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointer);
    }, 0);

    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function applyVolume(next: number) {
    const clamped = Math.min(1, Math.max(0, next));
    audioManager.setVolume(clamped);
    audioManager.setMusicVolume(Math.min(1, Math.max(0.12, clamped * 0.7)));
    if (clamped > 0) {
      audioManager.setMuted(false);
      audioManager.setMusicMuted(false);
      setMuted(false);
    }
    setVolume(clamped);
    void unlockAudio().then(() => {
      if (clamped > 0) audioManager.startMusic();
    });
  }

  function toggleMute() {
    const next = !(muted || volume === 0);
    if (next) {
      audioManager.setMuted(true);
      audioManager.setMusicMuted(true);
      setMuted(true);
      return;
    }

    audioManager.setMuted(false);
    audioManager.setMusicMuted(false);
    setMuted(false);
    if (volume === 0) {
      applyVolume(0.8);
      return;
    }
    void unlockAudio().then(() => {
      audioManager.startMusic();
      playSfx("ui_click");
    });
  }

  function toggleOpen() {
    void unlockAudio();
    setOpen((value) => !value);
  }

  const silent = volume === 0 || muted;

  return (
    <div ref={root} className={cn("relative overflow-visible", className)}>
      <button
        type="button"
        aria-label="Sound volume"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-click-sfx=""
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full border-[3px] border-void shadow-none transition-[transform,background-color,color] duration-150 hover:bg-gold hover:text-void active:translate-y-px sm:size-9",
          silent ? "bg-void text-cream" : "bg-cream text-void",
        )}
        onClick={(event) => {
          event.stopPropagation();
          toggleOpen();
        }}
      >
        {silent ? (
          <VolumeX className="pointer-events-none size-4 sm:size-3.5" aria-hidden />
        ) : (
          <Volume2 className="pointer-events-none size-4 sm:size-3.5" aria-hidden />
        )}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Sound volume"
          className={cn(
            "z-[80]",
            panel === "corner"
              ? "absolute bottom-[calc(100%+10px)] left-0 w-[16.5rem]"
              : "fixed inset-x-4 top-[calc(env(safe-area-inset-top)+4.85rem)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+10px)] sm:w-[16.5rem]",
          )}
        >
          <PixelCard size="sm" faceClassName="p-4 sm:p-3">
            <p className="mb-3 font-pixel text-xs font-bold uppercase text-parchment">
              Sound
            </p>
            <div className="flex items-center gap-2">
              <PixelButton
                type="button"
                size="sm"
                variant="outline"
                aria-label="Lower volume"
                className="min-h-11 min-w-11 px-2 sm:min-h-10 sm:min-w-10"
                onClick={() => applyVolume(volume - STEP)}
              >
                -
              </PixelButton>
              <input
                type="range"
                min={0}
                max={1}
                step={STEP}
                value={silent && volume === 0 ? 0 : volume}
                onChange={(event) => applyVolume(Number(event.target.value))}
                className="h-11 w-full accent-gold sm:h-8"
                aria-label="Volume"
              />
              <PixelButton
                type="button"
                size="sm"
                variant="outline"
                aria-label="Increase volume"
                className="min-h-11 min-w-11 px-2 sm:min-h-10 sm:min-w-10"
                onClick={() => applyVolume(volume + STEP)}
              >
                +
              </PixelButton>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="font-pixel text-xs uppercase text-muted">
                {silent ? "Muted" : `${Math.round(volume * 100)}%`}
              </p>
              <PixelButton
                type="button"
                size="sm"
                variant={silent ? "primary" : "outline"}
                className="min-h-11 px-3 sm:min-h-9"
                sfx={false}
                onClick={toggleMute}
              >
                {silent ? "Unmute" : "Mute"}
              </PixelButton>
            </div>
          </PixelCard>
        </div>
      ) : null}
    </div>
  );
}
