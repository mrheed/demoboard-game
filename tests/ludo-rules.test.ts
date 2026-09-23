import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveMatch, applyMatchAction, tickMatch } from "../src/server/services/play-match-engine";
import { sharedTrack, trackCellForSeat } from "../src/lib/game/ludo-geometry";
import { HOME_LANES, SAFE_CELLS, ludoCellsForRules } from "../src/lib/game/ludo-board";
import { previewMove, findCaptures, movablePawns } from "../src/lib/game/ludo-rules";
import type { DieValue } from "../src/lib/game/dice";

function fixture() {
  const match = createLiveMatch({ roomId: "LUD-1", game: "ludo", fundedSeats: 4,
    seats: [1, 2, 3, 4].map((seat) => ({ seat, id: `0x${String(seat).repeat(40)}`, username: `Human ${seat}` })) }, 0);
  if (match.game !== "ludo") throw new Error("Wrong fixture");
  return match;
}

test("new rules use 52 unique squares; legacy 56-square matches retain their route", () => {
  assert.equal(sharedTrack(2).length, 52);
  assert.equal(new Set(sharedTrack(2).map(String)).size, 52);
  assert.equal(sharedTrack(1).length, 56);
  for (const [row, col] of sharedTrack(2)) assert.ok(!(row >= 6 && row <= 8 && col >= 6 && col <= 8));
  for (const version of [1, 2] as const) for (let seat = 1; seat <= 4; seat++) {
    const match = fixture(); match.state.rulesVersion = version;
    const pawn = match.state.players[seat - 1].pawns[0];
    const door = sharedTrack(version).length - 2;
    assert.equal(previewMove(match.state, seat, { ...pawn, status: "track", steps: door }, 6)?.next.status, "finished");
    assert.deepEqual(trackCellForSeat(seat, 0, version), trackCellForSeat(seat, 0, 2));
  }
});

test("rendered cells preserve legacy corners and hide them for current rules", () => {
  const removed = new Set(["6:6", "6:8", "8:6", "8:8"]);
  const legacy = ludoCellsForRules(1).filter((cell) => removed.has(`${cell.row}:${cell.col}`));
  const current = ludoCellsForRules(2).filter((cell) => removed.has(`${cell.row}:${cell.col}`));
  assert.equal(legacy.length, 4);
  assert.ok(legacy.every((cell) => cell.kind === "path"));
  assert.ok(current.every((cell) => cell.kind === "void"));
});

test("all seats, track positions and dice obey exact progress and private home boundaries", () => {
  const match = fixture();
  for (let seat = 1; seat <= 4; seat++) {
    const pawn = match.state.players[seat - 1].pawns[0];
    for (let steps = 0; steps <= 50; steps++) for (let roll = 1; roll <= 6; roll++) {
      const move = previewMove(match.state, seat, { ...pawn, status: "track", steps }, roll as DieValue);
      assert.ok(move);
      const progress = move.next.status === "track" ? move.next.steps : move.next.status === "home" ? 51 + move.next.steps : 56;
      assert.equal(progress, steps + roll);
    }
    for (let steps = 0; steps < HOME_LANES[seat].length; steps++) for (let roll = 1; roll <= 6; roll++) {
      const move = previewMove(match.state, seat, { ...pawn, status: "home", steps }, roll as DieValue);
      if (steps + roll > 5) assert.equal(move, null);
      else assert.equal(move?.next.status, steps + roll === 5 ? "finished" : "home");
    }
  }
});

test("unsafe singles are captured; safe singles are not; enemy pairs block passing and landing", () => {
  for (let target = 1; target <= 50; target++) {
    const match = fixture();
    const player = match.state.players[0], opponent = match.state.players[1];
    const cell = trackCellForSeat(1, target);
    const otherSteps = (target - 13 + 52) % 52;
    if (otherSteps > 50) continue;
    player.pawns[0] = { ...player.pawns[0], status: "track", steps: target - 1 };
    opponent.pawns[0] = { ...opponent.pawns[0], status: "track", steps: otherSteps };
    const move = previewMove(match.state, 1, player.pawns[0], 1)!;
    const safe = SAFE_CELLS.some(([r, c]) => r === cell[0] && c === cell[1]);
    assert.equal(findCaptures(match.state, 1, move.next).length, safe ? 0 : 1);
    opponent.pawns[1] = { ...opponent.pawns[1], status: "track", steps: otherSteps };
    assert.equal(previewMove(match.state, 1, player.pawns[0], 1), null);
    assert.equal(previewMove(match.state, 1, player.pawns[0], 2), null);
    opponent.status = "eliminated";
    assert.ok(previewMove(match.state, 1, player.pawns[0], 1));
    assert.equal(findCaptures(match.state, 1, move.next).length, 0);
  }
});

test("an unplayable six preserves the extra roll, but the third six ends the turn", () => {
  const match = fixture();
  const player = match.state.players[0];
  player.pawns = player.pawns.map((pawn) => ({ ...pawn, status: "home", steps: 4 }));
  for (let i = 1; i <= 3; i++) {
    applyMatchAction(match, player.id, "roll", undefined, 0, () => 6);
    assert.equal(match.state.lastRoll, null);
    assert.equal(match.state.activeSeat, i < 3 ? 1 : 2);
  }
});

test("timeout catch-up works with zero browsers and preserves a single last-survivor winner", () => {
  const match = fixture();
  tickMatch(match, 1_000_000);
  assert.notEqual(match.winnerSeat, null);
  assert.equal(match.state.players.filter((p) => p.status !== "eliminated").length, 1);
  assert.equal(match.settlement?.netPayout, "3.92");
  const ended = structuredClone(match);
  tickMatch(match, 2_000_000);
  assert.deepEqual(match, ended);
});

test("missing a move deadline discards the unused roll and counts one missed decision", () => {
  const match = fixture();
  applyMatchAction(match, match.state.players[0].id, "roll", undefined, 0, () => 6);
  tickMatch(match, match.deadline);
  assert.equal(match.state.lastRoll, null);
  assert.equal(match.state.activeSeat, 2);
  assert.equal(match.state.afkStrikes?.[1], 1);
  assert.equal(match.state.players[0].pawns.every((p) => p.status === "yard"), true);
});

test("twenty seeded complete four-human games conserve pawns and reach a rules-based winner", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const match = fixture();
    let rng = seed;
    const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng; };
    for (let step = 0; match.winnerSeat === null && step < 20000; step++) {
      const player = match.state.players.find((p) => p.position === match.state.activeSeat)!;
      if (match.state.lastRoll === null) applyMatchAction(match, player.id, "roll", undefined, 0, () => (random() % 6 + 1) as DieValue);
      else {
        const moves = movablePawns(match.state, player, match.state.lastRoll as DieValue);
        assert.ok(moves.length);
        applyMatchAction(match, player.id, "move", moves[random() % moves.length].pawnId, 0);
      }
      assert.ok(match.state.players.every((p) => p.pawns.length === 4 && new Set(p.pawns.map((pawn) => pawn.id)).size === 4));
    }
    assert.notEqual(match.winnerSeat, null, `seed ${seed} did not finish`);
    assert.equal(match.state.players.find((p) => p.position === match.winnerSeat)?.pawns.every((p) => p.status === "finished"), true);
  }
});
