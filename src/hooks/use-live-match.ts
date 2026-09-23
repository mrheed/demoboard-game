"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveMatch, MatchAction } from "@/lib/game/live-match";
import type { GameType } from "@/lib/types";
import { fetchJson } from "@/lib/fetch-json";

export function isLiveActionAcknowledged(
  pending: { matchId: string; version: number } | null,
  next: Pick<LiveMatch, "id" | "version">,
) {
  return Boolean(pending && pending.matchId === next.id && next.version > pending.version);
}

export function useLiveMatch(
  roomId: string,
  game: GameType | undefined,
  matchId: string | null | undefined,
  address?: string,
) {
  const [match, setMatch] = useState<LiveMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const current = useRef<LiveMatch | null>(null);
  const sending = useRef(false);
  const actionSequence = useRef(0);
  const inFlight = useRef<{ id: number; matchId: string; version: number } | null>(null);
  const generation = useRef(0);
  const endpoint = `/api/${game}/rooms/${encodeURIComponent(roomId)}`;
  const publish = useCallback(
    (next: LiveMatch) => {
      if (next.id !== matchId) return;
      if (
        current.current?.id === next.id &&
        current.current.version > next.version
      )
        return;
      current.current = next;
      setMatch(next);
      const pending = inFlight.current;
      if (isLiveActionAcknowledged(pending, next)) {
        inFlight.current = null;
        sending.current = false;
        setBusy(false);
      }
    },
    [matchId],
  );

  useEffect(() => {
    const epoch = ++generation.current;
    if (!game || !matchId) return;
    let stopped = false;
    let polling = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      if (polling || stopped) return;
      polling = true;
      try {
        const payload = await fetchJson<{ match: LiveMatch }>(
          `${endpoint}?matchId=${encodeURIComponent(matchId!)}`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(8000),
            ]),
          },
        );
        if (stopped || generation.current !== epoch) return;
        publish(payload.match);
        setConnected(true);
      } catch {
        if (stopped) return;
        setConnected(false);
      } finally {
        polling = false;
        if (!stopped) timer = setTimeout(poll, 1000);
      }
    }
    void poll();
    const refresh = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void poll();
      }
    };
    window.addEventListener("online", refresh);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
      window.removeEventListener("online", refresh);
    };
  }, [endpoint, game, matchId, publish]);

  const act = useCallback(
    async (action: MatchAction | "settle", pawnId?: string) => {
      const snapshot = current.current;
      if (sending.current || !snapshot || snapshot.id !== matchId) return;
      const epoch = generation.current;
      const requestId = ++actionSequence.current;
      sending.current = true;
      inFlight.current = { id: requestId, matchId: snapshot.id, version: snapshot.version };
      setBusy(true);
      setError(null);
      try {
        const payload = await fetchJson<{ match: LiveMatch }>(
          `${endpoint}/${action}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(25000),
            body: JSON.stringify({
              matchId: snapshot.id,
              version: snapshot.version,
              address,
              pawnId,
            }),
          },
        );
        if (generation.current === epoch) {
          publish(payload.match);
          setConnected(true);
        }
      } catch (caught) {
        if (generation.current === epoch && inFlight.current?.id === requestId)
          setError(
            caught instanceof Error
              ? caught.message
              : "Action failed. Refresh and try again.",
          );
      } finally {
        if (inFlight.current?.id === requestId) {
          inFlight.current = null;
          sending.current = false;
          setBusy(false);
        }
      }
    },
    [address, endpoint, matchId, publish],
  );

  // Settle from the server winner only. Failed settlements require an explicit retry.
  const status = match?.settlement?.status;
  const participant = match?.state.players.some(
    (p) => p.id.toLowerCase() === address?.toLowerCase(),
  );
  useEffect(() => {
    if (!participant || (status !== "pending" && status !== "submitted"))
      return;
    const timer = setTimeout(
      () => {
        void act("settle");
      },
      status === "pending" ? 100 : 4000,
    );
    return () => clearTimeout(timer);
  }, [act, match?.version, participant, status]);

  return {
    match: match?.id === matchId ? match : null,
    error,
    connected,
    busy,
    act,
  };
}
