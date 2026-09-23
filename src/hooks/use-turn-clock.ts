"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { MATCH_TURN_SECONDS } from "@/lib/game/match-clock";

/**
 * Counts down while `running`. Restarts from 15s whenever `resetKey` changes.
 * `onExpire` fires once per countdown that reaches zero.
 */
export function useTurnClock({
  running,
  resetKey,
  onExpire,
}: {
  running: boolean;
  resetKey: string;
  onExpire: () => void;
}) {
  const [left, setLeft] = useState(MATCH_TURN_SECONDS);
  const expire = useEffectEvent(onExpire);

  useEffect(() => {
    const resetTimer = window.setTimeout(() => setLeft(MATCH_TURN_SECONDS), 0);
    if (!running) return () => window.clearTimeout(resetTimer);

    let remaining = MATCH_TURN_SECONDS;
    const id = window.setInterval(() => {
      remaining -= 1;
      setLeft(Math.max(0, remaining));
      if (remaining > 0) return;
      window.clearInterval(id);
      expire();
    }, 1000);

    return () => {
      window.clearTimeout(resetTimer);
      window.clearInterval(id);
    };
  }, [resetKey, running]);

  return left;
}
