import { NextResponse } from "next/server";

import {
  errorResponse,
  failureResponse,
  readJsonBody,
  readOptionalInteger,
} from "@/server/lib/api-response";
import { requireUser } from "@/server/lib/require-user";
import { settleMonopolyRent } from "@/server/services/monopoly-rent.service";
import { LEGACY_MUTATIONS_RETIRED, legacyMutationRetiredResponse } from "@/server/lib/paid-game-route";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

const TILE_RANGE = { min: 0, max: 39 };

/**
 * POST /api/monopoly/rooms/[roomId]/rent · pay rent for the current landing.
 *
 * Body (optional): `{ tileIndex?: number }`
 */
export async function POST(request: Request, context: RouteContext) {
  const { roomId } = await context.params;
  if (!roomId) {
    return NextResponse.json({ error: "Missing room id." }, { status: 400 });
  }
  if (LEGACY_MUTATIONS_RETIRED) return legacyMutationRetiredResponse();

  try {
    const { userId } = await requireUser(request);
    const body = await readJsonBody(request);
    const tileIndex = readOptionalInteger(body, "tileIndex", TILE_RANGE);

    const result = await settleMonopolyRent(roomId, userId, tileIndex);
    if (!result.ok) return failureResponse(result);

    return NextResponse.json({
      tileIndex: result.tileIndex,
      tileName: result.tileName,
      due: result.due,
      paid: result.paid,
      bankrupted: result.bankrupted,
      payerSeat: result.payerSeat,
      ownerSeat: result.ownerSeat,
      state: result.state,
      source: result.source,
    });
  } catch (error) {
    return errorResponse(error, "POST /api/monopoly/rooms/:roomId/rent");
  }
}
