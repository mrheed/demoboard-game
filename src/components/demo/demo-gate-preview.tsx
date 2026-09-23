"use client";

import { useEffect, useState } from "react";

import { PixelCard } from "@/components/ui/pixel-card";
import { LudoDemo, MonopolyDemo } from "@/components/welcome/game-demos";
import {
  parsePreviewGame,
  readPreviewGame,
  rememberPreviewGame,
  type PreviewGame,
} from "@/lib/preview-game";

/**
 * Access-code sidebar preview. Follows the landing table choice.
 */
export function DemoGatePreview({ game }: { game?: string | null }) {
  const [chosen, setChosen] = useState<PreviewGame>(
    parsePreviewGame(game) ?? "ludo",
  );

  useEffect(() => {
    const fromProp = parsePreviewGame(game);
    const stored = readPreviewGame();
    const next = fromProp ?? stored ?? "ludo";
    rememberPreviewGame(next);
    const timer = window.setTimeout(() => setChosen(next), 0);
    return () => window.clearTimeout(timer);
  }, [game]);

  const Demo = chosen === "monopoly" ? MonopolyDemo : LudoDemo;

  return (
    <PixelCard size="lg" tone="cream" faceClassName="p-4">
      <p className="mb-3 font-pixel text-xs font-semibold uppercase text-parchment">
        {chosen === "monopoly" ? "Monopoly preview" : "Ludo preview"}
      </p>
      <Demo />
    </PixelCard>
  );
}
