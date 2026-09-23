"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { audioManager, unlockAudio } from "@/lib/audio/audio-manager";
import { cn } from "@/lib/utils";

/**
 * Mute toggle for BOARD SFX. Unlocks AudioContext on first interaction.
 */
export function AudioMuteToggle({ className }: { className?: string }) {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMuted(audioManager.isMuted()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <button
      type="button"
      aria-label={muted ? "Unmute sound effects" : "Mute sound effects"}
      aria-pressed={muted}
      className={cn(
        "grid size-8 place-items-center pixel-corners border-[3px] border-void shadow-pixel-sm transition-[transform,background-color,color] duration-150 hover:brightness-105 active:translate-y-px sm:size-9",
        className,
        muted ? "bg-void text-cream" : "bg-cream text-void",
      )}
      onClick={() => {
        void unlockAudio();
        setMuted(audioManager.toggleMute());
      }}
    >
      {muted ? (
        <VolumeX className="size-3.5" aria-hidden />
      ) : (
        <Volume2 className="size-3.5" aria-hidden />
      )}
    </button>
  );
}
