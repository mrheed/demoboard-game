"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import gsap from "gsap";

import { PixelArt } from "@/components/game/pixel-art";
import { WorkInProgressWatermark } from "@/components/game/work-in-progress";
import {
  enabledPlayGame,
  isGameEnabled,
  WORK_IN_PROGRESS,
} from "@/lib/game-availability";
import { SeatDots } from "@/components/lobby/seat-dots";
import { PlayArena, PlaySign } from "@/components/play/play-arena";
import { PixelButton } from "@/components/ui/pixel-button";
import { ludoPawnSprite, pawnSprite } from "@/lib/game/pawn-sprite";
import {
  formatPlayAmount,
  PLAY_ENTRY_FEE,
  PLAY_STAKE_SYMBOL,
} from "@/lib/game/play-player";
import { PLAY_LOBBY_SLOTS, type PlayLobbyGame } from "@/lib/game/play-table";
import { PLAY_WORLDS } from "@/lib/mock/play";
import { prefersReducedMotion } from "@/lib/motion/gsap-config";
import { rememberPreviewGame, type PreviewGame } from "@/lib/preview-game";
import { cn } from "@/lib/utils";
import { getBoardChainLabel } from "@/lib/wallet/chains";
import { MAX_PLAYERS_PER_ROOM } from "@/lib/types";
import type { PlaySit } from "@/hooks/use-play-sit";

const EMPTY_GAMES: PlayLobbyGame[] = PLAY_LOBBY_SLOTS.filter((slot) =>
  isGameEnabled(slot.game),
).map(emptyLobbyFromSlot);
const LOBBY_POLL_MS = 8000;

function readForfeitNotice(): "leave" | "afk" | null {
  if (typeof window === "undefined") return null;
  const forfeit = new URLSearchParams(window.location.search).get("forfeit");
  if (forfeit === "afk") return "afk";
  if (forfeit) return "leave";
  return null;
}

function emptyLobbyFromSlot(
  slot: (typeof PLAY_LOBBY_SLOTS)[number],
): PlayLobbyGame {
  return {
    tableId: slot.id,
    game: slot.game,
    label: slot.label,
    slot: slot.slot,
    status: "waiting",
    entryFee: PLAY_ENTRY_FEE,
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    seated: 0,
    seatsLeft: MAX_PLAYERS_PER_ROOM,
    seats: [],
  };
}

function lobbySnapshot(games: PlayLobbyGame[]) {
  return games
    .map(
      (game) =>
        `${game.tableId}:${game.status}:${game.seated}:${game.blocked ? 1 : 0}:${game.seats
          .map((seat) => `${seat.seat}:${seat.address}`)
          .join(",")}`,
    )
    .join("|");
}

export function PlayLobby({
  initialGame,
  play,
}: {
  initialGame: PreviewGame;
  play: PlaySit;
}) {
  const router = useRouter();
  const root = useRef<HTMLElement>(null);
  const {
    wallet,
    sit,
    sitPhase,
    sitTableId,
    sitError,
    switching,
    switchNetwork,
    pendingPayment,
  } = play;
  const [games, setGames] = useState<PlayLobbyGame[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadBlocked, setLoadBlocked] = useState(false);
  const [selected, setSelected] = useState<PreviewGame>(
    enabledPlayGame(initialGame),
  );
  const selectMonopoly = useCallback(
    () => setSelected(enabledPlayGame("monopoly")),
    [],
  );
  const selectLudo = useCallback(() => setSelected("ludo"), []);

  useEffect(() => {
    rememberPreviewGame(selected);
  }, [selected]);

  useEffect(() => {
    if (loadBlocked) return;
    let cancelled = false;
    let inFlight = false;

    async function load() {
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const query = wallet.address
          ? `?address=${encodeURIComponent(wallet.address)}`
          : "";
        const response = await fetch(`/api/play/lobby${query}`, {
          cache: "no-store",
        });
        const raw = await response.text();
        let payload: { games?: PlayLobbyGame[]; error?: string } = {};
        if (raw) {
          try {
            payload = JSON.parse(raw) as {
              games?: PlayLobbyGame[];
              error?: string;
            };
          } catch {
            throw new Error(
              response.ok
                ? "Lobby returned invalid JSON."
                : `Lobby unavailable (${response.status}).`,
            );
          }
        } else if (!response.ok) {
          throw new Error(`Lobby unavailable (${response.status}).`);
        }
        if (response.status === 503) {
          if (!cancelled) {
            setGames(null);
            setLoadError(
              payload.error ??
                "Paid lobby setup requires operator attention.",
            );
            setLoadBlocked(true);
          }
          return;
        }
        if (!response.ok || !payload.games) {
          throw new Error(payload.error ?? "Could not load the lobby.");
        }
        if (cancelled) return;
        setGames((prev) => {
          if (prev && lobbySnapshot(prev) === lobbySnapshot(payload.games!)) {
            return prev;
          }
          return payload.games!;
        });
        setLoadError(null);
      } catch (caught) {
        if (!cancelled) {
          setLoadError(
            caught instanceof Error
              ? caught.message
              : "Could not load the lobby.",
          );
        }
      } finally {
        inFlight = false;
      }
    }

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, LOBBY_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadBlocked, wallet.address]);

  useEffect(() => {
    const node = root.current;
    if (!node || prefersReducedMotion()) return;
    const intro = gsap.timeline();
    const sign = node.querySelector<HTMLElement>("[data-play-sign]");
    const picks = node.querySelectorAll<HTMLElement>("[data-lobby-game]");
    const list = node.querySelector<HTMLElement>("[data-lobby-list]");
    if (sign) {
      intro.from(sign, {
        y: -14,
        duration: 0.35,
        ease: "power3.out",
        clearProps: "transform",
      });
    }
    if (picks.length) {
      intro.from(
        picks,
        {
          y: 12,
          duration: 0.3,
          stagger: 0.05,
          ease: "power3.out",
          clearProps: "transform",
        },
        "-=0.18",
      );
    }
    if (list) {
      intro.from(
        list,
        {
          y: 10,
          duration: 0.28,
          ease: "power3.out",
          clearProps: "transform",
        },
        "-=0.14",
      );
    }
    return () => {
      intro.kill();
    };
  }, []);

  const tables = games ?? EMPTY_GAMES;
  const [refundQueued, setRefundQueued] = useState(false);
  const [forfeitNotice] = useState(readForfeitNotice);
  const releasing = false;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    void Promise.resolve().then(() =>
      setRefundQueued(params.get("refund") === "queued"),
    );
  }, []);

  const mine = (() => {
    if (!wallet.address) return null;
    const address = wallet.address.toLowerCase();
    for (const table of tables) {
      if (table.blocked) continue;
      const seat = table.seats.find(
        (row) => row.address.toLowerCase() === address,
      );
      if (seat)
        return { game: table.game, tableId: table.tableId, seat: seat.seat };
    }
    return null;
  })();

  const selectedTables = useMemo(
    () => tables.filter((table) => table.game === selected),
    [tables, selected],
  );
  const world =
    PLAY_WORLDS.find((item) => item.id === selected) ?? PLAY_WORLDS[0];
  const handleSit = useCallback(
    (game: PreviewGame, tableId: string) => {
      void sit(game, tableId);
    },
    [sit],
  );

  return (
    <section
      ref={root}
      aria-label="Play lobby"
      className="relative isolate flex min-h-[100dvh] flex-1 flex-col overflow-x-hidden overflow-y-auto"
    >
      <PlayArena accent={selected} />

      <div className="relative z-[1] mx-auto flex w-full max-w-[44rem] flex-col items-center px-4 pb-24 pt-[4.75rem] sm:pb-10 sm:pt-16">
        <PlaySign label="LOBBY" compact />

        <p className="mt-3 max-w-[42ch] text-center font-pixel text-[10px] font-semibold uppercase leading-relaxed tracking-wide text-void/80">
          Ludo is live. Sit any open table. Monopoly is a work in progress.
        </p>

        {refundQueued ? (
          <p className="mt-3 max-w-md text-center font-pixel text-[10px] uppercase leading-relaxed text-[#5a1e00]">
            You left the table. Your 1 USDG refund is queued and will retry
            when the house wallet has gas.
          </p>
        ) : null}

        {forfeitNotice === "afk" ? (
          <p className="mt-3 max-w-md text-center font-pixel text-[10px] uppercase leading-relaxed text-[#5a1e00]">
            You were kicked for missing three rolls. Your entry fee is not
            refunded. Sit again to play. The entry fee is charged again.
          </p>
        ) : null}

        {forfeitNotice === "leave" ? (
          <p className="mt-3 max-w-md text-center font-pixel text-[10px] uppercase leading-relaxed text-[#5a1e00]">
            You left the match. Your entry fee is not refunded. Sit again to
            play. The entry fee is charged again.
          </p>
        ) : null}

        <div
          role="listbox"
          aria-label="Game"
          className="mt-5 grid w-full grid-cols-2 gap-3 sm:gap-4"
        >
          <GamePickCard
            game="monopoly"
            active={selected === "monopoly"}
            onSelect={selectMonopoly}
          />
          <GamePickCard
            game="ludo"
            active={selected === "ludo"}
            onSelect={selectLudo}
          />
        </div>

        {loadError ? (
          <div
            role="alert"
            className="mt-3 flex max-w-lg flex-col items-center gap-2 text-center font-pixel text-[10px] uppercase leading-relaxed text-[#5a1e00]"
          >
            <p>{loadError}</p>
            <p>
              {loadBlocked
                ? "Operator setup is required. Automatic retries are paused."
                : "Showing empty tables while the lobby retries automatically."}
            </p>
            {loadBlocked ? (
              <PixelButton
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setLoadBlocked(false)}
              >
                Retry lobby
              </PixelButton>
            ) : null}
          </div>
        ) : null}

        {wallet.isConnected && !wallet.onNetwork ? (
          <div className="mt-4 w-full space-y-2 border-[3px] border-void bg-[#2a160c]/88 px-3 py-3 text-center">
            <p className="font-pixel text-[10px] uppercase text-gold">
              Switch to {getBoardChainLabel()} to sit.
            </p>
            <PixelButton
              type="button"
              size="md"
              variant="primary"
              className="w-full justify-center sm:w-auto"
              disabled={switching}
              onClick={switchNetwork}
            >
              {switching ? "Switching…" : "Switch network"}
            </PixelButton>
          </div>
        ) : null}

        {sitError ? (
          <p className="mt-3 text-center font-pixel text-[10px] uppercase leading-relaxed text-[#5a1e00]">
            {sitError}
          </p>
        ) : null}

        {pendingPayment && (
          <div className="mt-3 text-center">
            <p className="text-sm">
              Entry payment for {pendingPayment.tableId} is awaiting
              verification.
            </p>
            <PixelButton
              disabled={sitPhase !== "idle"}
              onClick={() =>
                void sit(pendingPayment.game, pendingPayment.tableId)
              }
            >
              Check existing payment
            </PixelButton>
          </div>
        )}

        {mine && !isGameEnabled(mine.game) && (
          <div className="mt-4 text-center">
            <p className="mb-2 text-sm">You have an existing entry at {mine.tableId}.</p>
            <PixelButton onClick={() => router.push(`/room/${mine.tableId}`)}>
              Recover existing entry
            </PixelButton>
          </div>
        )}

        <div data-lobby-list className="mt-5 w-full">
          <div className="pixel-card-shadow-lg">
            <div
              className={cn(
                "pixel-notch border-[4px] border-void p-[3px]",
                selected === "monopoly" ? "bg-[#0b3d52]" : "bg-[#4a1230]",
              )}
            >
              <div className="pixel-notch overflow-hidden bg-[#1a0c06]">
                <div className="flex items-end justify-between gap-3 border-b-[3px] border-void px-3 py-2.5">
                  <div>
                    <p className="font-pixel text-[10px] uppercase tracking-wide text-cream/60">
                      {world.sign} tables
                    </p>
                    <p className="font-pixel text-sm font-bold uppercase text-cream">
                      {world.punch}
                    </p>
                  </div>
                  <p className="shrink-0 font-sans text-[12px] font-bold tabular-nums tracking-tight text-gold">
                    Sit {formatPlayAmount(PLAY_ENTRY_FEE)} {PLAY_STAKE_SYMBOL}
                  </p>
                </div>
                <ul className="divide-y-[3px] divide-void">
                  {selectedTables.map((table) => (
                    <LobbyTableRow
                      key={table.tableId}
                      table={table}
                      loading={games === null}
                      sitPhase={sitPhase}
                      sitTableId={sitTableId}
                      viewerAddress={wallet.address}
                      walletLoading={wallet.loading}
                      onNetwork={wallet.onNetwork}
                      walletError={Boolean(wallet.error)}
                      canEnter={wallet.canEnter}
                      symbol={wallet.symbol}
                      entryFee={wallet.entryFee}
                      releasing={releasing}
                      mine={releasing ? null : mine}
                      onSit={() => handleSit(table.game, table.tableId)}
                    />
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}

const GamePickCard = memo(function GamePickCard({
  game,
  active,
  onSelect,
}: {
  game: PreviewGame;
  active: boolean;
  onSelect: () => void;
}) {
  const monopoly = game === "monopoly";
  const world = PLAY_WORLDS.find((item) => item.id === game) ?? PLAY_WORLDS[0];

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      disabled={!isGameEnabled(game)}
      aria-label={
        !isGameEnabled(game) ? `${world.sign}: ${WORK_IN_PROGRESS}` : world.sign
      }
      data-lobby-game
      onClick={onSelect}
      className={cn(
        "min-w-0 text-left transition-[transform,filter] duration-200",
        !isGameEnabled(game)
          ? "cursor-not-allowed"
          : active
            ? "brightness-100"
            : "brightness-[0.78] hover:brightness-95",
      )}
    >
      <div className="pixel-card-shadow-lg">
        <div
          className={cn(
            "pixel-notch border-[4px] border-void p-[3px]",
            active ? (monopoly ? "bg-monopoly" : "bg-ludo") : "bg-[#5a2408]",
          )}
        >
          <div
            className={cn(
              "pixel-notch overflow-hidden",
              monopoly ? "bg-[#0b3d52]" : "bg-[#4a1230]",
            )}
          >
            <div className="pointer-events-none relative mx-auto w-full max-w-[16rem] px-2 pt-2">
              <GamePickStill game={game} />
              {!isGameEnabled(game) && <WorkInProgressWatermark />}
            </div>
            <div className="border-t-[3px] border-void bg-[#1a0c06]/85 px-2.5 py-2">
              <p
                className={cn(
                  "font-pixel text-base font-bold uppercase leading-none tracking-wide sm:text-lg",
                  monopoly ? "text-[#7ad4f0]" : "text-[#ff9ec8]",
                )}
              >
                {world.sign}
              </p>
              <p className="mt-1 font-pixel text-[10px] uppercase leading-snug text-cream/75">
                {world.punch}
              </p>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
});

const GamePickStill = memo(function GamePickStill({
  game,
}: {
  game: PreviewGame;
}) {
  const monopoly = game === "monopoly";

  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[14rem]"
      aria-hidden
    >
      {monopoly ? (
        <div className="absolute inset-[6%] grid grid-cols-5 grid-rows-5 gap-px border-[3px] border-void bg-void">
          {Array.from({ length: 25 }, (_, index) => {
            const row = Math.floor(index / 5);
            const col = index % 5;
            const edge = row === 0 || row === 4 || col === 0 || col === 4;
            const colors = [
              "#c45a32",
              "#3ec9b0",
              "#ff7a59",
              "#6cff9f",
              "#d4a017",
            ];
            return (
              <span
                key={index}
                className={edge ? "block" : "block bg-[#1a6b4a]"}
                style={
                  edge
                    ? { backgroundColor: colors[index % colors.length] }
                    : undefined
                }
              />
            );
          })}
        </div>
      ) : (
        <div className="absolute inset-[8%] grid grid-cols-2 grid-rows-2 gap-1 border-[3px] border-void bg-[#2a0c18] p-1">
          <span className="bg-[#e23b3b]" />
          <span className="bg-[#2f6fe4]" />
          <span className="bg-[#22a84a]" />
          <span className="bg-[#f5c518]" />
        </div>
      )}
      {([1, 2, 3, 4] as const).map((seat) => (
        <span
          key={seat}
          className={cn(
            "absolute w-7 sm:w-8",
            seat === 1 && "bottom-[10%] left-[10%]",
            seat === 2 && "bottom-[10%] right-[10%]",
            seat === 3 && "top-[10%] right-[10%]",
            seat === 4 && "top-[10%] left-[10%]",
          )}
        >
          <PixelArt
            sprite={monopoly ? pawnSprite(seat) : ludoPawnSprite(seat)}
          />
        </span>
      ))}
    </div>
  );
});

const LobbyTableRow = memo(function LobbyTableRow({
  table,
  loading,
  sitPhase,
  sitTableId,
  viewerAddress,
  walletLoading,
  onNetwork,
  walletError,
  canEnter,
  symbol,
  entryFee,
  releasing,
  mine,
  onSit,
}: {
  table: PlayLobbyGame;
  loading: boolean;
  sitPhase: PlaySit["sitPhase"];
  sitTableId: string | null;
  viewerAddress: string | null;
  walletLoading: boolean;
  onNetwork: boolean;
  walletError: boolean;
  canEnter: boolean;
  symbol: string;
  entryFee: number;
  releasing: boolean;
  mine: { game: PreviewGame; tableId: string | null; seat: number } | null;
  onSit: () => void;
}) {
  const router = useRouter();
  const viewerHere = Boolean(
    viewerAddress &&
      table.seats.some(
        (row) => row.address.toLowerCase() === viewerAddress.toLowerCase(),
      ),
  );
  const seatedHere = mine?.tableId === table.tableId;
  const sittingThis = sitPhase !== "idle" && sitTableId === table.tableId;
  const inPlay = table.status === "playing";
  const full = table.seatsLeft <= 0 && !seatedHere;
  const busy = sitPhase !== "idle";
  const ticker = symbol;

  let action: ReactNode;
  if (releasing && viewerHere) {
    action = (
      <PixelButton
        type="button"
        size="sm"
        variant={table.game === "monopoly" ? "monopoly" : "ludo"}
        disabled
      >
        Sit
      </PixelButton>
    );
  } else if (mine?.tableId && !seatedHere) {
    action = (
      <PixelButton
        type="button"
        size="sm"
        variant={mine.game === "monopoly" ? "monopoly" : "ludo"}
        onClick={() => router.push(`/room/${mine.tableId}`)}
      >
        Open {mine.tableId}
      </PixelButton>
    );
  } else if (inPlay && !seatedHere) {
    action = (
      <span className="font-pixel text-[10px] uppercase text-gold">
        In play
      </span>
    );
  } else if (table.blocked) {
    action = (
      <span className="font-pixel text-[10px] uppercase text-gold">Left</span>
    );
  } else if (full) {
    action = (
      <span className="font-pixel text-[10px] uppercase text-gold">Full</span>
    );
  } else if (seatedHere && mine?.tableId) {
    action = (
      <PixelButton
        type="button"
        size="sm"
        variant={table.game === "monopoly" ? "monopoly" : "ludo"}
        onClick={() => router.push(`/room/${mine.tableId}`)}
      >
        Open
      </PixelButton>
    );
  } else if (loading || walletLoading) {
    action = (
      <span className="font-pixel text-[10px] uppercase text-cream/55">…</span>
    );
  } else if (!onNetwork) {
    action = (
      <span className="font-pixel text-[10px] uppercase text-cream/55">
        Network
      </span>
    );
  } else if (walletError) {
    action = (
      <span className="font-pixel text-[10px] uppercase text-gold">No RPC</span>
    );
  } else if (canEnter) {
    action = (
      <PixelButton
        type="button"
        size="sm"
        variant={table.game === "monopoly" ? "monopoly" : "ludo"}
        disabled={busy}
        onClick={onSit}
      >
        {sittingThis && sitPhase === "sending"
          ? "Wallet…"
          : sittingThis && sitPhase === "confirming"
            ? "Chain…"
            : sittingThis && sitPhase === "seating"
              ? "Sit…"
              : "Sit"}
      </PixelButton>
    );
  } else {
    action = (
      <PixelButton
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        title={`Check for an existing ${formatPlayAmount(entryFee)} ${ticker} payment`}
        onClick={onSit}
      >
        {sittingThis ? "Checking…" : "Check payment"}
      </PixelButton>
    );
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2.5 sm:gap-3">
      <div className="flex w-16 shrink-0 items-end gap-0.5 sm:w-[4.5rem]">
        {Array.from({ length: table.maxPlayers }, (_, index) => {
          const seat = index + 1;
          const filled = table.seats.some((row) => row.seat === seat);
          return (
            <span
              key={seat}
              className={cn("w-3.5 sm:w-4", !filled && "opacity-30")}
              title={filled ? `Seat ${seat} taken` : `Seat ${seat} open`}
            >
              <PixelArt
                sprite={
                  table.game === "ludo"
                    ? ludoPawnSprite(seat)
                    : pawnSprite(seat)
                }
              />
            </span>
          );
        })}
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-pixel text-sm font-bold uppercase leading-none text-cream">
          {table.label}
        </p>
        <p className="mt-1 font-pixel text-[10px] uppercase tracking-wide text-cream/60">
          {loading ? "…" : `${table.seated}/${table.maxPlayers} sitting`}
          <span className="sm:hidden">
            {" "}
            ·{" "}
            <span className="font-sans font-bold tabular-nums tracking-tight text-gold normal-case">
              {formatPlayAmount(table.entryFee)} {PLAY_STAKE_SYMBOL}
            </span>
          </span>
        </p>
      </div>

      <p className="hidden shrink-0 font-sans text-sm font-bold tabular-nums tracking-tight text-gold sm:block">
        {formatPlayAmount(table.entryFee)} {PLAY_STAKE_SYMBOL}
      </p>

      <div className="hidden shrink-0 sm:block">
        <SeatDots
          filled={table.seated}
          total={table.maxPlayers}
          palette={table.game === "ludo" ? "ludo" : undefined}
        />
      </div>

      <div className="shrink-0">{action}</div>
    </li>
  );
});
