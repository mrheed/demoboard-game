import { NextResponse } from "next/server";

import { PLAY_STAKE_SYMBOL } from "@/lib/game/play-player";
import { errorResponse } from "@/server/lib/api-response";
import { listPlayLobby } from "@/server/services/play-table.service";

/** GET /api/play/lobby · live occupancy for Monopoly and Ludo sit tables. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const raw = url.searchParams.get("address");
    const address =
      raw && /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw.toLowerCase() : null;
    return NextResponse.json({
      games: await listPlayLobby(address),
      symbol: PLAY_STAKE_SYMBOL,
    });
  } catch (error) {
    return errorResponse(error, "GET /api/play/lobby");
  }
}
