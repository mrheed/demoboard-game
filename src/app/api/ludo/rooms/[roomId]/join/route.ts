import { NextResponse } from "next/server";

import { errorResponse, failureResponse } from "@/server/lib/api-response";
import { requireUser } from "@/server/lib/require-user";
import { publishLudo } from "@/server/realtime/ludo-hub";
import { joinRoom } from "@/server/services/join-room.service";
import { LEGACY_MUTATIONS_RETIRED, legacyMutationRetiredResponse } from "@/server/lib/paid-game-route";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

/** POST /api/ludo/rooms/[roomId]/join · Ludo join (defers kickoff until ready). */
export async function POST(request: Request, context: RouteContext) {
  const { roomId } = await context.params;
  if (!roomId) {
    return NextResponse.json({ error: "Missing room id." }, { status: 400 });
  }
  if (LEGACY_MUTATIONS_RETIRED) return legacyMutationRetiredResponse();

  try {
    const { userId } = await requireUser(request);
    const result = await joinRoom(roomId, userId, {
      requireGame: "ludo",
      deferStart: true,
    });
    if (!result.ok) return failureResponse(result);

    publishLudo({
      type: "action",
      roomId: result.room.id,
      action: "join",
      seat: result.seat,
      room: result.room,
      ready: result.ready,
      source: result.source,
    });

    return NextResponse.json({
      room: result.room,
      seat: result.seat,
      balanceAfter: result.balanceAfter,
      started: result.started,
      ready: result.ready ?? {},
      ludo: result.ludo ?? null,
      source: result.source,
    });
  } catch (error) {
    return errorResponse(error, "POST /api/ludo/rooms/:roomId/join");
  }
}
