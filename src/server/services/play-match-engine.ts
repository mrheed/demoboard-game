import { randomInt, randomUUID } from "node:crypto";
import { formatUnits } from "viem";
import type { DieValue } from "@/lib/game/dice";
import { rollDice } from "@/lib/game/dice";
import type { LiveMatch, MatchAction } from "@/lib/game/live-match";
import { isPlayBot } from "@/lib/game/play-table";
import { PLAY_ENTRY_FEE_ATOMIC } from "@/lib/game/play-player";
import { USDG_DECIMALS } from "@/lib/wallet/usdg";
import { MATCH_TURN_SECONDS } from "@/lib/game/match-clock";
import { PRIZE_FEE_RATE } from "@/lib/types";
import { createLudoMatchForSeats, pawnsFinished } from "@/lib/mock/ludo";
import {
  advanceTurn,
  applyRollMove,
  buyTile,
  createMonopolyMatchForSeats,
  eliminateSeat,
  leaveJailByDoubles,
  leaveJailByFine,
  npcShouldBuy,
  recordAfkMiss,
  resolveLanding,
  soleWinner,
  stayInJail,
} from "@/lib/game/monopoly-rules";
import {
  chooseNpcMove,
  findCaptures,
  grantsExtraTurn,
  movablePawns,
  nextActiveSeat,
  recordLudoAfkMiss,
  registerSixRoll,
  sendHome,
} from "@/lib/game/ludo-rules";
import { secureDie } from "@/server/lib/secure-dice";
import { ServiceError } from "@/server/lib/service-error";

export function createLiveMatch(
  input: {
    roomId: string;
    game: "monopoly" | "ludo";
    seats: { id: string; username: string; seat: number }[];
    fundedSeats: number;
  },
  now = Date.now(),
): LiveMatch {
  const base = {
    id: randomUUID(),
    version: 0,
    deadline: now + MATCH_TURN_SECONDS * 1000,
    winnerSeat: null,
    fundedSeats: input.fundedSeats,
    settlement: null,
  };
  const match: LiveMatch =
    input.game === "monopoly"
      ? {
          ...base,
          game: "monopoly",
          state: createMonopolyMatchForSeats(input.roomId, input.seats),
          dice: null,
          pendingBuy: null,
          extraTurn: false,
        }
      : {
          ...base,
          game: "ludo",
          state: createLudoMatchForSeats(input.roomId, input.seats),
          die: null,
          sixes: 0,
        };
  resetDeadline(match, now);
  return match;
}

function resetDeadline(match: LiveMatch, now: number) {
  const actor = match.state.players.find(
    (p) => p.position === match.state.activeSeat,
  );
  match.deadline =
    now + (actor && isPlayBot(actor.id) ? 1000 : MATCH_TURN_SECONDS * 1000);
}

function finishMonopolyTurn(
  match: Extract<LiveMatch, { game: "monopoly" }>,
  now: number,
) {
  const seat = match.state.activeSeat;
  if (
    match.extraTurn &&
    match.state.players.find((p) => p.position === seat)?.status === "alive"
  ) {
    match.state.cue += 1;
  } else {
    match.state.extras[seat] = {
      ...match.state.extras[seat],
      consecutiveDoubles: 0,
    };
    match.state = advanceTurn(match.state, seat);
  }
  match.extraTurn = false;
  match.pendingBuy = null;
  resetDeadline(match, now);
}

function advanceLudo(match: Extract<LiveMatch, { game: "ludo" }>, now: number) {
  const next = nextActiveSeat(match.state.players, match.state.activeSeat);
  match.state.activeSeat = next.activeSeat;
  match.state.turn += next.turnDelta;
  match.state.lastRoll = null;
  match.sixes = 0;
  resetDeadline(match, now);
}

function checkWinner(match: LiveMatch) {
  if (match.winnerSeat !== null) return;
  const players = match.state.players.filter((p) => p.status !== "eliminated");
  const winner =
    match.game === "monopoly"
      ? soleWinner(match.state)?.seat
      : (match.state.players.find(
          (p) => p.status !== "eliminated" && pawnsFinished(p) === 4,
        )?.position ??
        (players.length === 1 ? players[0].position : undefined));
  if (winner === undefined) return;
  match.winnerSeat = winner;
  const gross = PLAY_ENTRY_FEE_ATOMIC * BigInt(match.fundedSeats);
  const fee =
    (gross * BigInt(Math.round(PRIZE_FEE_RATE * 10_000))) / BigInt(10_000);
  const player = match.state.players.find((p) => p.position === winner)!;
  match.settlement = {
    status: isPlayBot(player.id) ? "house" : "pending",
    grossPot: formatUnits(gross, USDG_DECIMALS),
    feeAmount: formatUnits(fee, USDG_DECIMALS),
    netPayout: formatUnits(gross - fee, USDG_DECIMALS),
    txHash: null,
    confirmedAt: null,
    error: null,
  };
}

/** Only server callers provide dice. HTTP requests never supply outcomes or a board. */
export function applyMatchAction(
  match: LiveMatch,
  actorId: string,
  action: MatchAction,
  pawnId?: string,
  now = Date.now(),
  die: () => DieValue = secureDie,
) {
  const actor = match.state.players.find(
    (p) => p.id.toLowerCase() === actorId.toLowerCase(),
  );
  if (!actor) throw new ServiceError("You are not seated in this match.", 403);
  if (match.winnerSeat !== null)
    throw new ServiceError("The match has finished.", 409);
  if (actor.status !== "alive")
    throw new ServiceError("This seat is no longer active.", 409);
  if (action !== "forfeit" && actor.position !== match.state.activeSeat)
    throw new ServiceError("It is not your turn.", 409);
  const seat = actor.position;

  if (action === "forfeit") {
    const active = seat === match.state.activeSeat;
    if (match.game === "monopoly") {
      match.state = eliminateSeat(
        match.state,
        seat,
        `${actor.username} forfeited. Entry is not refunded.`,
      );
      if (active) {
        match.pendingBuy = null;
        match.extraTurn = false;
      }
    } else {
      match.state.players = match.state.players.map((p) =>
        p.position === seat
          ? { ...p, status: "eliminated", pawns: p.pawns.map(sendHome) }
          : p,
      );
      if (active) advanceLudo(match, now);
    }
    if (active) resetDeadline(match, now);
  } else if (match.game === "monopoly") {
    if (action === "roll") {
      if (match.pendingBuy !== null)
        throw new ServiceError("Buy or decline the property first.", 409);
      const roll = rollDice(die);
      match.dice = roll.dice;
      const jailed = Boolean(match.state.extras[seat]?.inJail);
      if (jailed && !roll.isDouble) {
        match.state = stayInJail(match.state, seat);
        finishMonopolyTurn(match, now);
      } else {
        if (jailed) match.state = leaveJailByDoubles(match.state, seat);
        const moved = applyRollMove(match.state, seat, roll);
        const landed = moved.goToJail
          ? null
          : resolveLanding(
              moved.state,
              seat,
              roll.isDouble && !jailed,
              randomInt,
            );
        match.state = landed?.state ?? moved.state;
        match.pendingBuy = landed?.pendingBuy ?? null;
        match.extraTurn = landed?.extraTurn ?? false;
        if (match.pendingBuy === null) finishMonopolyTurn(match, now);
        else resetDeadline(match, now);
      }
    } else if (action === "buy" || action === "end-turn") {
      if (match.pendingBuy === null)
        throw new ServiceError("There is no pending purchase.", 409);
      if (action === "buy") {
        const next = buyTile(match.state, seat, match.pendingBuy);
        if (!next)
          throw new ServiceError("This property cannot be purchased.", 409);
        match.state = next;
      }
      finishMonopolyTurn(match, now);
    } else if (action === "pay-jail") {
      if (match.pendingBuy !== null)
        throw new ServiceError("Resolve your purchase first.", 409);
      const next = leaveJailByFine(match.state, seat);
      if (!next) throw new ServiceError("You cannot pay the jail fine.", 409);
      match.state = next;
    } else throw new ServiceError("Unsupported Monopoly action.", 400);
  } else {
    if (action === "roll") {
      if (match.state.lastRoll !== null)
        throw new ServiceError("Move a pawn before rolling again.", 409);
      const value = die();
      match.die = value;
      const six =
        value === 6
          ? registerSixRoll(match.sixes)
          : { nextCount: 0, voided: false };
      match.sixes = six.nextCount;
      match.state.log.unshift({
        id: randomUUID(),
        seat,
        message: `${actor.username} rolled ${value}${six.voided ? " · third six, turn forfeited" : ""}.`,
      });
      const player = match.state.players.find((p) => p.position === seat)!;
      if (six.voided)
        advanceLudo(match, now);
      else if (movablePawns(match.state, player, value).length === 0) {
        if (value === 6) resetDeadline(match, now);
        else advanceLudo(match, now);
      }
      else {
        match.state.lastRoll = value;
        resetDeadline(match, now);
      }
    } else if (action === "move") {
      const value = match.state.lastRoll as DieValue | null;
      const player = match.state.players.find((p) => p.position === seat)!;
      const move =
        value &&
        movablePawns(match.state, player, value).find(
          (p) => p.pawnId === pawnId,
        );
      if (!value || !move)
        throw new ServiceError(
          "Choose a legal pawn for the current roll.",
          409,
        );
      const captures = findCaptures(match.state, seat, move.next);
      match.state.players = match.state.players.map((p) => ({
        ...p,
        pawns: p.pawns.map((pawn) =>
          pawn.id === move.pawnId && p.position === seat
            ? move.next
            : captures.some(
                  (hit) =>
                    hit.victimSeat === p.position &&
                    hit.victimPawnId === pawn.id,
                )
              ? sendHome(pawn)
              : pawn,
        ),
      }));
      match.state.lastRoll = null;
      match.state.log.unshift({
        id: randomUUID(),
        seat,
        message: `${actor.username} moved a pawn${captures.length ? " and captured a rival" : ""}.`,
      });
      if (
        !grantsExtraTurn({
          roll: value,
          movedPawn: move.next,
          captured: captures.length > 0,
        })
      )
        advanceLudo(match, now);
      else resetDeadline(match, now);
    } else throw new ServiceError("Unsupported Ludo action.", 400);
  }
  match.version += 1;
  checkWinner(match);
}

/** Called under the same lock on reads/actions; disconnected humans cannot freeze a turn. */
export function tickMatch(
  match: LiveMatch,
  now = Date.now(),
  die: () => DieValue = secureDie,
) {
  // Replay expired deadlines, not browser-return time. Bounded to keep requests
  // responsive; the durable worker resumes any remaining backlog.
  for (let step = 0; step < 256; step += 1) {
    if (match.winnerSeat !== null || now < match.deadline) return;
    const version = match.version;
    tickOneDeadline(match, match.deadline, die);
    if (match.version === version) return;
  }
}

function tickOneDeadline(
  match: LiveMatch,
  now: number,
  die: () => DieValue,
) {
  if (match.winnerSeat !== null || now < match.deadline) return;
  const actor = match.state.players.find(
    (p) => p.position === match.state.activeSeat,
  );
  if (!actor) return;
  if (isPlayBot(actor.id)) {
    if (match.game === "monopoly") {
      const action =
        match.pendingBuy === null
          ? "roll"
          : npcShouldBuy(match.state, actor.position, match.pendingBuy)
            ? "buy"
            : "end-turn";
      applyMatchAction(match, actor.id, action, undefined, now, die);
    } else if (match.state.lastRoll === null)
      applyMatchAction(match, actor.id, "roll", undefined, now, die);
    else {
      const player = match.state.players.find(
        (p) => p.position === actor.position,
      )!;
      const move = chooseNpcMove(
        match.state,
        player,
        match.state.lastRoll as DieValue,
      );
      if (move)
        applyMatchAction(match, actor.id, "move", move.pawnId, now, die);
      else {
        advanceLudo(match, now);
        match.version += 1;
      }
    }
    return;
  }
  if (match.game === "monopoly") {
    if (match.pendingBuy !== null) finishMonopolyTurn(match, now);
    else match.state = recordAfkMiss(match.state, actor.position).state;
    match.extraTurn = false;
  } else {
    match.state = recordLudoAfkMiss(match.state, actor.position).state;
    match.state.players = match.state.players.map((p) =>
      p.status === "eliminated" ? { ...p, pawns: p.pawns.map(sendHome) } : p,
    );
    match.sixes = 0;
  }
  resetDeadline(match, now);
  match.version += 1;
  checkWinner(match);
}
