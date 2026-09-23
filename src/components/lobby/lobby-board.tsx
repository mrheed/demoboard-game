"use client";

import { useEffect, useMemo, useState } from "react";

import {
  EntryFeeFilter,
  type EntryFeeFilter as EntryFeeFilterValue,
} from "@/components/lobby/entry-fee-filter";
import { GamePicker } from "@/components/lobby/game-picker";
import { RoomList } from "@/components/lobby/room-list";
import { PixelHeading } from "@/components/ui/pixel-label";
import type { GameOption } from "@/lib/mock/lobby";
import { rememberPreviewGame, readPreviewGame } from "@/lib/preview-game";
import type { GameType, Room } from "@/lib/types";

/**
 * Owns the lobby's client state: the picked game plus the entry-fee filters,
 * which together decide which rooms are listed. Data arrives from the server
 * as props.
 */
export function LobbyBoard({
  games,
  rooms,
  feeTiers,
  balance,
  now,
  defaultGame,
}: {
  games: GameOption[];
  rooms: Room[];
  feeTiers: readonly number[];
  balance: number;
  now: number;
  defaultGame?: GameType;
}) {
  const [selectedGame, setSelectedGame] = useState<GameType>(
    defaultGame ?? "monopoly",
  );
  const [feeFilter, setFeeFilter] = useState<EntryFeeFilterValue>(null);
  const [affordableOnly, setAffordableOnly] = useState(false);

  useEffect(() => {
    if (defaultGame) {
      rememberPreviewGame(defaultGame);
      const timer = window.setTimeout(() => setSelectedGame(defaultGame), 0);
      return () => window.clearTimeout(timer);
    }
    const stored = readPreviewGame();
    if (stored) {
      const timer = window.setTimeout(() => setSelectedGame(stored), 0);
      return () => window.clearTimeout(timer);
    }
  }, [defaultGame]);

  const gameRooms = useMemo(
    () => rooms.filter((room) => room.gameType === selectedGame),
    [rooms, selectedGame],
  );

  const countsByTier = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const room of gameRooms) {
      if (room.status !== "waiting") continue;
      counts[room.entryFee] = (counts[room.entryFee] ?? 0) + 1;
    }
    return counts;
  }, [gameRooms]);

  const visibleRooms = useMemo(
    () =>
      gameRooms.filter((room) => {
        if (feeFilter !== null && room.entryFee !== feeFilter) return false;
        if (affordableOnly && room.entryFee > balance) return false;
        return true;
      }),
    [gameRooms, feeFilter, affordableOnly, balance],
  );

  const isFiltered = feeFilter !== null || affordableOnly;

  return (
    <>
      <section aria-labelledby="game" className="mb-10 sm:mb-12">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <PixelHeading as="h2" id="game" size="sm">
            Pick your board
          </PixelHeading>
          <p className="max-w-xs text-xs leading-relaxed text-faint">
            One tap selects the game. Tables below update instantly.
          </p>
        </div>
        <GamePicker
          games={games}
          selected={selectedGame}
          onSelect={(game) => {
            setSelectedGame(game);
            rememberPreviewGame(game);
            setFeeFilter(null);
          }}
        />
      </section>

      <RoomList
        gameType={selectedGame}
        rooms={visibleRooms}
        balance={balance}
        now={now}
        filtered={isFiltered}
        toolbar={
          <EntryFeeFilter
            tiers={feeTiers}
            selected={feeFilter}
            onSelect={setFeeFilter}
            counts={countsByTier}
            affordableOnly={affordableOnly}
            onAffordableOnlyChange={setAffordableOnly}
          />
        }
      />
    </>
  );
}
