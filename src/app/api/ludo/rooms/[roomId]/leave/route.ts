import { NextResponse } from "next/server";

import { errorResponse, failureResponse } from "@/server/lib/api-response";
import { requireUser } from "@/server/lib/require-user";
import { leaveLudoMatch } from "@/server/services/ludo-turn.service";
import { LEGACY_MUTATIONS_RETIRED, legacyMutationRetiredResponse } from "@/server/lib/paid-game-route";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

/** POST /api/ludo/rooms/[roomId]/leave · forfeit / leave the match. */
export async function POST(request: Request, context: RouteContext) {
  const { roomId } = await context.params;
  if (!roomId) {
    return NextResponse.json({ error: "Missing room id." }, { status: 400 });
  }
  if (LEGACY_MUTATIONS_RETIRED) return legacyMutationRetiredResponse();

  try {
    const { userId } = await requireUser(request);
    const result = await leaveLudoMatch(roomId, userId);
    if (!result.ok) return failureResponse(result);

    return NextResponse.json({
      action: result.action,
      seat: result.seat,
      state: result.state,
      source: result.source,
    });
  } catch (error) {
    return errorResponse(error, "POST /api/ludo/rooms/:roomId/leave");
  }
}
