"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { LudoRoom } from "@/components/room/ludo-room";
import { MonopolyRoom } from "@/components/room/monopoly-room";
import { LeaveMatchModal } from "@/components/room/leave-match-modal";
import { RoomHeader } from "@/components/room/room-header";
import { WaitingRoom } from "@/components/play/waiting-room";
import { PixelButton, PixelButtonLink } from "@/components/ui/pixel-button";
import { isGameEnabled, WORK_IN_PROGRESS } from "@/lib/game-availability";
import { useLiveMatch } from "@/hooks/use-live-match";
import { usePlaySession } from "@/hooks/use-play-session";
import { forfeitPlayMatch } from "@/lib/game/forfeit-match";
import { fetchJson } from "@/lib/fetch-json";
import { isPlayBot, type PlayTableView } from "@/lib/game/play-table";

export function GameRoom({
  roomId,
  requestedMatchId,
}: {
  roomId: string;
  requestedMatchId?: string;
}) {
  const router = useRouter();
  const { address } = useAccount();
  const ensureSession = usePlaySession();
  const [table, setTable] = useState<PlayTableView | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(0);
  const [signing, setSigning] = useState(false);
  const [pinnedMatchId, setPinnedMatchId] = useState(requestedMatchId);
  const live = useLiveMatch(roomId, table?.game, pinnedMatchId, address);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function load() {
      try {
        const payload = await fetchJson<{ table: PlayTableView }>(
          `/api/play/tables/${encodeURIComponent(roomId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!stopped) {
          setTable(payload.table);
          setTableError(null);
          if (payload.table.status === "playing" && payload.table.matchId) {
            setPinnedMatchId((current) => {
              if (current) return current;
              return payload.table.matchId!;
            });
          }
        }
      } catch (error) {
        if (!stopped)
          setTableError(
            error instanceof Error
              ? error.message
              : "Could not load the table.",
          );
      } finally {
        if (!stopped) timer = setTimeout(load, 2000);
      }
    }
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [roomId]);

  useEffect(() => {
    if (pinnedMatchId) {
      const url = new URL(window.location.href);
      url.searchParams.set("match", pinnedMatchId);
      window.history.replaceState(null, "", url);
    }
  }, [pinnedMatchId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  async function exitMatch() {
    if (leaving) return;
    setLeaving(true);
    try {
      if (!address) throw new Error("Connect your playing wallet.");
      await ensureSession(address);
    } catch (error) {
      setTableError(error instanceof Error ? error.message : "Could not sign in.");
      setLeaving(false);
      setLeaveOpen(false);
      return;
    }
    const left = await forfeitPlayMatch({ tableId: roomId, address });
    if (left) router.push("/play?forfeit=1");
    else {
      setTableError(
        "Leaving was not confirmed. Reconnect your playing wallet and try again.",
      );
      setLeaving(false);
      setLeaveOpen(false);
    }
  }

  async function reconnect() {
    if (!address || signing) return;
    setSigning(true);
    try {
      await ensureSession(address);
      setTableError(null);
    } catch (error) {
      setTableError(
        error instanceof Error ? error.message : "Could not sign in.",
      );
    } finally {
      setSigning(false);
    }
  }

  if (!table)
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p role="status">{tableError ?? "Loading the server table…"}</p>
      </main>
    );
  const match = live.match;
  const fundedSeats =
    match?.fundedSeats ??
    table.seats.filter((seat) => !isPlayBot(seat.address)).length;
  const secondsLeft =
    match && now ? Math.max(0, Math.ceil((match.deadline - now) / 1000)) : 0;
  const yourSeat = match?.state.players.find(
    (player) => player.id.toLowerCase() === address?.toLowerCase(),
  );
  const yourTurn = Boolean(
    match &&
      match.winnerSeat === null &&
      yourSeat?.status === "alive" &&
      yourSeat.position === match.state.activeSeat,
  );
  const viewerAlive = yourSeat?.status === "alive";
  const waiting = !pinnedMatchId && table.status !== "playing";
  const strikes =
    match && yourSeat
      ? match.game === "monopoly"
        ? (match.state.extras[yourSeat.position]?.afkStrikes ?? 0)
        : (match.state.afkStrikes?.[yourSeat.position] ?? 0)
      : 0;

  return (
    <>
      <RoomHeader
        roomId={table.id}
        turn={match?.state.turn ?? 0}
        turnSecondsLeft={secondsLeft}
        pot={table.entryFee * fundedSeats}
        entryFee={table.entryFee}
        seats={fundedSeats}
        waiting={waiting}
        clockActive={yourTurn}
        afkStrikes={strikes}
        onLeave={
          waiting || match?.winnerSeat != null
            ? undefined
            : viewerAlive
              ? () => setLeaveOpen(true)
              : () => router.push("/play")
        }
      />
      {!isGameEnabled(table.game) && (
        <div role="status" className="border-b-[3px] border-gold bg-void p-5 text-center">
          <p className="font-pixel text-xl text-gold">Monopoly · {WORK_IN_PROGRESS}</p>
          <p className="my-3 text-sm text-cream/75">
            New Monopoly games are disabled. Existing paid entries can still be recovered,
            waiting entries refunded, and started matches finished and settled.
          </p>
          <PixelButtonLink href="/play?game=ludo" variant="ludo">Play Ludo</PixelButtonLink>
        </div>
      )}
      {(tableError || live.error) && (
        <div role="alert" className="p-3 text-center text-sm text-gold">
          <p>{tableError ?? live.error}</p>
          {address && (
            <PixelButton disabled={signing} onClick={() => void reconnect()}>
              {signing ? "Signing…" : "Reconnect playing wallet"}
            </PixelButton>
          )}
        </div>
      )}
      {!waiting && !live.connected && (
        <p role="status" className="p-3 text-center text-sm text-gold">
          Reconnecting to the server. Game controls are paused.
        </p>
      )}
      {waiting ? (
        <WaitingRoom table={table} onTable={setTable} />
      ) : match ? (
        <main className="mx-auto w-full max-w-[1800px] flex-1 px-3 py-3 sm:px-6 sm:py-5">
          {match.game === "ludo" ? (
            <LudoRoom
              match={match}
              address={address}
              busy={live.busy}
              connected={live.connected}
              secondsLeft={secondsLeft}
              onAction={(action, pawn) => void live.act(action, pawn)}
              onSettle={() => void live.act("settle")}
            />
          ) : (
            <MonopolyRoom
              match={match}
              address={address}
              busy={live.busy}
              connected={live.connected}
              secondsLeft={secondsLeft}
              onAction={(action) => void live.act(action)}
              onSettle={() => void live.act("settle")}
            />
          )}
        </main>
      ) : (
        <main className="flex flex-1 items-center justify-center p-8">
          <p role="status">
            {table.matchId
              ? "Loading the shared board…"
              : "This older table has no server match. Leave it and enter a new table."}
          </p>
        </main>
      )}
      <LeaveMatchModal
        open={leaveOpen}
        busy={leaving}
        onStay={() => setLeaveOpen(false)}
        onLeave={() => void exitMatch()}
      />
    </>
  );
}
