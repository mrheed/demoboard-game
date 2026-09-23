"use client";

import { ActivityLog } from "@/components/room/activity-log";
import { FinishCountPanel } from "@/components/room/finish-count-panel";
import { LudoActionBar } from "@/components/room/ludo-action-bar";
import { LudoBoardStage } from "@/components/room/ludo-board-stage";
import { LudoPawnLayer } from "@/components/room/ludo-pawn-layer";
import { LudoPlayerRail } from "@/components/room/ludo-player-rail";
import { WinnerScreen } from "@/components/room/winner-screen";
import { pawnsForBoard } from "@/lib/game/ludo-geometry";
import { movablePawns } from "@/lib/game/ludo-rules";
import type { DieValue } from "@/lib/game/dice";
import type { LiveMatch, MatchAction } from "@/lib/game/live-match";

export function LudoRoom({
  match,
  address,
  busy,
  connected,
  secondsLeft,
  onAction,
  onSettle,
}: {
  match: Extract<LiveMatch, { game: "ludo" }>;
  address?: string;
  busy: boolean;
  connected: boolean;
  secondsLeft: number;
  onAction: (action: MatchAction, pawnId?: string) => void;
  onSettle: () => void;
}) {
  const state = match.state;
  const players = state.players.map((player) => ({
    ...player,
    isYou: player.id.toLowerCase() === address?.toLowerCase(),
  }));
  const you = players.find((player) => player.isYou);
  const yourTurn =
    connected &&
    !busy &&
    match.winnerSeat === null &&
    you?.status === "alive" &&
    you.position === state.activeSeat;
  const moves =
    yourTurn && you && state.lastRoll !== null
      ? movablePawns(state, you, state.lastRoll as DieValue)
      : [];
  const winner = players.find((player) => player.position === match.winnerSeat);

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
      <LudoPlayerRail
        players={players}
        activeSeat={state.activeSeat}
        className="order-2 lg:order-1"
      />
      <div className="order-1 flex flex-col gap-4 lg:order-2">
        <LudoBoardStage
          className="max-w-[min(100%,78vh)]"
          rulesVersion={state.rulesVersion}
          overlay={
            <>
              <LudoPawnLayer
                pawns={pawnsForBoard(players, state.rulesVersion)}
                selectableIds={moves.map((move) => move.pawnId)}
                movingId={null}
                movePath={null}
                returnPaths={{}}
                onSelect={(id) => onAction("move", id)}
                onMoveComplete={() => {}}
                onReturnComplete={() => {}}
              />
              {winner && (
                <WinnerScreen
                  game="ludo"
                  winner={{
                    seat: winner.position,
                    username: winner.username,
                    isYou: winner.isYou,
                    pot: Number(match.settlement?.grossPot ?? 0),
                    subtitle: "The server confirmed the match winner.",
                  }}
                  settlement={match.settlement}
                  matchId={match.id}
                  onSettle={onSettle}
                  settling={busy}
                />
              )}
            </>
          }
        />
        <LudoActionBar
          yourTurn={yourTurn}
          rolling={busy}
          value={match.die}
          canRoll={state.lastRoll === null}
          canEndTurn={false}
          secondsLeft={yourTurn ? secondsLeft : null}
          onRoll={() => onAction("roll")}
          onEndTurn={() => {}}
        />
        <p className="text-center text-xs text-muted">
          {moves.length
            ? "Pick a glowing pawn to move."
            : you?.status === "eliminated"
              ? "You are out. The remaining players are still playing."
              : "6 exits yard · capture / 6 / finish = extra roll"}
        </p>
      </div>
      <aside className="order-3 flex flex-col gap-4">
        <FinishCountPanel players={players} />
        <ActivityLog entries={state.log} palette="ludo" />
      </aside>
    </div>
  );
}
