import { eq } from "drizzle-orm";
import { isGameEnabled, GAME_DISABLED_MESSAGE } from "@/lib/game-availability";

import { MOCK_BALANCE, MOCK_PLAYER, MOCK_ROOMS } from "@/lib/mock/lobby";
import type { LudoRoomState } from "@/lib/mock/ludo";
import type { MonopolyRoomState } from "@/lib/mock/monopoly";
import {
  MAX_PLAYERS_PER_ROOM,
  prizePool,
  seatsLeft,
  type Room,
} from "@/lib/types";
import { getDb } from "@/server/db";
import {
  matches,
  roomPlayers,
  rooms,
  transactions,
  users,
} from "@/server/db/schema";
import {
  applyBalanceDelta,
  lockAvailable,
} from "@/server/db/repositories/balances.repository";
import { toBoardColumn } from "@/lib/money";
import { notifyRoomsChanged } from "@/server/realtime/rooms-hub";
import { publishMonopoly } from "@/server/realtime/monopoly-hub";
import {
  seedMonopolyMatch,
  startMonopolyMock,
} from "@/server/services/monopoly-start.service";
import {
  seedLudoMatch,
  startLudoMock,
} from "@/server/services/ludo-start.service";
import { publishLudo } from "@/server/realtime/ludo-hub";
import { isDbConfigured as dbConfigured } from "@/server/lib/db-config";
import {
  findRoomByRef,
  formatRoomCode,
} from "@/server/db/repositories/rooms.repository";

/** Live mock Monopoly boards keyed by room code (filled after auto-start). */
export const MOCK_MONOPOLY_LIVE = new Map<string, MonopolyRoomState>();

/** Live mock Ludo boards keyed by room code (filled after ready-start). */
export const MOCK_LUDO_LIVE = new Map<string, LudoRoomState>();

/** Waiting-room ready flags for mock Ludo rooms: roomId → userId → ready. */
export const MOCK_ROOM_READY = new Map<string, Map<string, boolean>>();

export type JoinRoomResult =
  | {
      ok: true;
      room: Room;
      seat: number;
      balanceAfter: number;
      started: boolean;
      source: "database" | "mock";
      monopoly?: MonopolyRoomState;
      ludo?: LudoRoomState;
      ready?: Record<string, boolean>;
    }
  | {
      ok: false;
      code:
        | "NOT_FOUND"
        | "NOT_OPEN"
        | "FULL"
        | "ALREADY_JOINED"
        | "INSUFFICIENT_BALANCE"
        | "USER_NOT_FOUND"
        | "WRONG_GAME"
        | "GAME_DISABLED";
      message: string;
      shortfall?: number;
    };

export type JoinRoomOptions = {
  /** When set, reject rooms of the other game type. */
  requireGame?: "monopoly" | "ludo";
  /**
   * When true, filling the table does not kick off the match · callers must
   * start via ready-up (Ludo waiting room).
   */
  deferStart?: boolean;
};

function isRetiredLegacyEntry(game: string): boolean {
  return game === "ludo";
}

/**
 * Join a waiting room: validate balance, take the next free seat, deduct the
 * entry fee. When the table hits 4 players the room flips to `playing`, a
 * match row is created, and Monopoly tables are seeded for Monopoly rooms.
 */
export async function joinRoom(
  roomRef: string,
  userId: string,
  options: JoinRoomOptions = {},
): Promise<JoinRoomResult> {
  if (!dbConfigured()) {
    const result = joinRoomMock(roomRef, userId, options);
    if (result.ok) {
      notifyRoomsChanged();
      if (result.monopoly) {
        publishMonopoly({
          type: "action",
          roomId: result.monopoly.roomId,
          action: "start",
          seat: null,
          state: result.monopoly,
          source: "mock",
        });
      }
      if (result.ludo) {
        publishLudo({
          type: "action",
          roomId: result.ludo.roomId,
          action: "start",
          seat: null,
          state: result.ludo,
          source: "mock",
        });
      }
    }
    return result;
  }

  const db = getDb();

  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");

    if (!user) {
      return {
        ok: false as const,
        code: "USER_NOT_FOUND" as const,
        message: "User not found.",
      };
    }

    const room = await findRoomByRef(tx, roomRef);

    if (!room) {
      return {
        ok: false as const,
        code: "NOT_FOUND" as const,
        message: "Room not found.",
      };
    }

    if (!isGameEnabled(room.gameType)) {
      return {
        ok: false as const,
        code: "GAME_DISABLED" as const,
        message: GAME_DISABLED_MESSAGE,
      };
    }
    if (isRetiredLegacyEntry(room.gameType)) {
      return { ok: false as const, code: "GAME_DISABLED" as const,
        message: "Legacy BOARD-stake entry is retired. Use the four-human USDG Ludo rooms at /play. Existing records are preserved for recovery." };
    }
    if (options.requireGame && room.gameType !== options.requireGame) {
      return {
        ok: false as const,
        code: "WRONG_GAME" as const,
        message: `This endpoint only joins ${options.requireGame} rooms.`,
      };
    }

    const [lockedRoom] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.id, room.id))
      .limit(1)
      .for("update");

    if (!lockedRoom || lockedRoom.status !== "waiting") {
      return {
        ok: false as const,
        code: "NOT_OPEN" as const,
        message: "Room is not open for joining.",
      };
    }

    const existing = await tx
      .select()
      .from(roomPlayers)
      .where(eq(roomPlayers.roomId, lockedRoom.id));

    if (existing.some((seat) => seat.userId === userId)) {
      return {
        ok: false as const,
        code: "ALREADY_JOINED" as const,
        message: "You are already in this room.",
      };
    }

    if (existing.length >= lockedRoom.maxPlayers) {
      return {
        ok: false as const,
        code: "FULL" as const,
        message: "Room is full.",
      };
    }

    const fee = Number(lockedRoom.entryFee);
    // Read through the balance repository: `users.balance` alone is the legacy
    // column, and checking it let a player join on tokens that were still
    // withdrawable from `user_balances.available`.
    const balance = await lockAvailable(tx, userId);
    if (balance < fee) {
      return {
        ok: false as const,
        code: "INSUFFICIENT_BALANCE" as const,
        message: "Not enough BOARD to join this room.",
        shortfall: fee - balance,
      };
    }

    const taken = new Set(existing.map((seat) => seat.position));
    let seat = 1;
    while (taken.has(seat) && seat <= lockedRoom.maxPlayers) seat += 1;

    const balanceAfter = await applyBalanceDelta(tx, userId, -fee);

    // Record the fee on the ledger. The `entry_fee` transaction type already
    // existed and was queried by the wallet history, but nothing ever wrote
    // one, so the ledger never reconciled against the balance.
    await tx.insert(transactions).values({
      userId,
      type: "entry_fee",
      status: "confirmed",
      amount: toBoardColumn(-fee),
      referenceId: lockedRoom.id,
      note: `Entry fee · ${formatRoomCode(lockedRoom.id, lockedRoom.gameType)}`,
    });

    await tx.insert(roomPlayers).values({
      roomId: lockedRoom.id,
      userId,
      position: seat,
      status: "alive",
    });

    const filled = existing.length + 1;
    let started = false;
    let monopoly: MonopolyRoomState | undefined;
    let ludo: LudoRoomState | undefined;

    const players = await tx
      .select({
        id: users.id,
        username: users.username,
        avatarUrl: users.avatarUrl,
        position: roomPlayers.position,
        status: roomPlayers.status,
      })
      .from(roomPlayers)
      .innerJoin(users, eq(users.id, roomPlayers.userId))
      .where(eq(roomPlayers.roomId, lockedRoom.id))
      .orderBy(roomPlayers.position);

    const shouldAutoStart =
      filled >= lockedRoom.maxPlayers && !options.deferStart;

    if (shouldAutoStart) {
      started = true;
      await tx
        .update(rooms)
        .set({ status: "playing" })
        .where(eq(rooms.id, lockedRoom.id));

      const [match] = await tx
        .insert(matches)
        .values({
          roomId: lockedRoom.id,
          gameType: lockedRoom.gameType,
          prizePool: prizePool({
            entryFee: fee,
            maxPlayers: lockedRoom.maxPlayers,
          }).toFixed(2),
          status: "ongoing",
        })
        .returning();

      const seats = players.map((player) => ({
        userId: player.id,
        username: player.username,
        seat: player.position,
      }));

      if (lockedRoom.gameType === "monopoly" && match) {
        monopoly = await seedMonopolyMatch(tx, {
          matchId: match.id,
          roomCode: formatRoomCode(lockedRoom.id, lockedRoom.gameType),
          entryFee: fee,
          maxPlayers: lockedRoom.maxPlayers,
          seats,
        });
      }

      if (lockedRoom.gameType === "ludo" && match) {
        ludo = await seedLudoMatch(tx, {
          matchId: match.id,
          roomCode: formatRoomCode(lockedRoom.id, lockedRoom.gameType),
          entryFee: fee,
          maxPlayers: lockedRoom.maxPlayers,
          seats,
        });
      }
    }

    const readyRows = await tx
      .select({
        userId: roomPlayers.userId,
        ready: roomPlayers.ready,
      })
      .from(roomPlayers)
      .where(eq(roomPlayers.roomId, lockedRoom.id));

    const ready: Record<string, boolean> = {};
    for (const row of readyRows) ready[row.userId] = row.ready;

    return {
      ok: true as const,
      room: {
        id: formatRoomCode(lockedRoom.id, lockedRoom.gameType),
        gameType: lockedRoom.gameType,
        entryFee: fee,
        maxPlayers: lockedRoom.maxPlayers,
        status: (started ? "playing" : "waiting") as Room["status"],
        players,
        createdAt: lockedRoom.createdAt.toISOString(),
      },
      seat,
      balanceAfter,
      started,
      source: "database" as const,
      monopoly,
      ludo,
      ready,
    };
  });

  if (result.ok) {
    notifyRoomsChanged();
    if (result.monopoly) {
      publishMonopoly({
        type: "action",
        roomId: result.monopoly.roomId,
        action: "start",
        seat: null,
        state: result.monopoly,
        source: result.source,
      });
    }
    if (result.ludo) {
      publishLudo({
        type: "action",
        roomId: result.ludo.roomId,
        action: "start",
        seat: null,
        state: result.ludo,
        source: result.source,
      });
    }
  }
  return result;
}

/** In-memory join against the lobby mocks · no durable write. */
function joinRoomMock(
  roomRef: string,
  userId: string,
  options: JoinRoomOptions,
): JoinRoomResult {
  if (userId !== MOCK_PLAYER.id && userId !== "me") {
    return {
      ok: false,
      code: "USER_NOT_FOUND",
      message: "User not found.",
    };
  }

  const room = MOCK_ROOMS.find(
    (entry) => entry.id.toUpperCase() === roomRef.toUpperCase(),
  );
  if (!room) {
    return { ok: false, code: "NOT_FOUND", message: "Room not found." };
  }
  if (!isGameEnabled(room.gameType)) {
    return { ok: false, code: "GAME_DISABLED", message: GAME_DISABLED_MESSAGE };
  }
  if (isRetiredLegacyEntry(room.gameType)) return { ok: false, code: "GAME_DISABLED",
    message: "Legacy BOARD-stake entry is retired. Use the four-human USDG Ludo rooms at /play." };
  if (options.requireGame && room.gameType !== options.requireGame) {
    return {
      ok: false,
      code: "WRONG_GAME",
      message: `This endpoint only joins ${options.requireGame} rooms.`,
    };
  }
  if (room.status !== "waiting") {
    return {
      ok: false,
      code: "NOT_OPEN",
      message: "Room is not open for joining.",
    };
  }
  if (seatsLeft(room) <= 0) {
    return { ok: false, code: "FULL", message: "Room is full." };
  }
  if (room.players.some((player) => player.id === MOCK_PLAYER.id)) {
    return {
      ok: false,
      code: "ALREADY_JOINED",
      message: "You are already in this room.",
    };
  }
  if (MOCK_BALANCE.available < room.entryFee) {
    return {
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      message: "Not enough BOARD to join this room.",
      shortfall: room.entryFee - MOCK_BALANCE.available,
    };
  }

  const taken = new Set(room.players.map((player) => player.position));
  let seat = 1;
  while (taken.has(seat) && seat <= room.maxPlayers) seat += 1;

  const players = [
    ...room.players,
    {
      id: MOCK_PLAYER.id,
      username: MOCK_PLAYER.username,
      avatarUrl: MOCK_PLAYER.avatarUrl,
      position: seat,
      status: "alive" as const,
    },
  ];
  const started =
    !options.deferStart &&
    players.length >= (room.maxPlayers || MAX_PLAYERS_PER_ROOM);
  const balanceAfter = MOCK_BALANCE.available - room.entryFee;

  room.players = players;
  room.status = started ? "playing" : "waiting";
  MOCK_BALANCE.available = balanceAfter;
  MOCK_BALANCE.locked += room.entryFee;

  let readyMap = MOCK_ROOM_READY.get(room.id);
  if (!readyMap) {
    readyMap = new Map();
    MOCK_ROOM_READY.set(room.id, readyMap);
  }
  for (const player of players) {
    if (!readyMap.has(player.id)) {
      // Mock NPCs sit ready; only the live player needs to tap Ready.
      readyMap.set(player.id, player.id !== MOCK_PLAYER.id);
    }
  }
  const ready: Record<string, boolean> = {};
  for (const [id, value] of readyMap) ready[id] = value;

  let monopoly: MonopolyRoomState | undefined;
  let ludo: LudoRoomState | undefined;
  if (started && room.gameType === "monopoly") {
    monopoly = startMonopolyMock(
      room.id,
      room.entryFee,
      room.maxPlayers,
      players.map((player) => ({
        userId: player.id,
        username: player.username,
        seat: player.position,
      })),
    );
    MOCK_MONOPOLY_LIVE.set(room.id, monopoly);
  }
  if (started && room.gameType === "ludo") {
    ludo = startLudoMock(
      room.id,
      room.entryFee,
      room.maxPlayers,
      players.map((player) => ({
        userId: player.id,
        username: player.username,
        seat: player.position,
      })),
    );
    MOCK_LUDO_LIVE.set(room.id, ludo);
  }

  return {
    ok: true,
    room: { ...room, players, status: room.status },
    seat,
    balanceAfter,
    started,
    source: "mock",
    monopoly,
    ludo,
    ready,
  };
}
