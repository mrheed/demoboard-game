import { NextResponse } from "next/server";

import { errorResponse, failureResponse } from "@/server/lib/api-response";
import { requireUser } from "@/server/lib/require-user";
import { joinRoom } from "@/server/services/join-room.service";
import { LEGACY_MUTATIONS_RETIRED, legacyMutationRetiredResponse } from "@/server/lib/paid-game-route";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

/** POST /api/monopoly/rooms/[roomId]/join · take a seat and pay the entry fee. */
export async function POST(request: Request, context: RouteContext) {
  const { roomId } = await context.params;
  if (!roomId) {
    return NextResponse.json({ error: "Missing room id." }, { status: 400 });
  }
  if (LEGACY_MUTATIONS_RETIRED) return legacyMutationRetiredResponse();

  try {
    const { userId } = await requireUser(request);
    const result = await joinRoom(roomId, userId, { requireGame: "monopoly" });
    if (!result.ok) return failureResponse(result);

    return NextResponse.json({
      room: result.room,
      seat: result.seat,
      balanceAfter: result.balanceAfter,
      started: result.started,
      monopoly: result.monopoly ?? null,
      source: result.source,
    });
  } catch (error) {
    return errorResponse(error, "POST /api/monopoly/rooms/:roomId/join");
  }
}
