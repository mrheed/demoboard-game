import { NextResponse } from "next/server";
import type { GameType } from "@/lib/types";
import type { MatchAction } from "@/lib/game/live-match";
import { isPlayLobbySlotId } from "@/lib/game/play-table";
import {
  errorResponse,
  readJsonBody,
  readOptionalString,
} from "@/server/lib/api-response";
import { requirePlayWallet } from "@/server/lib/require-play-wallet";
import { ServiceError } from "@/server/lib/service-error";
import {
  actPaidMatch,
  getPaidMatch,
} from "@/server/services/play-table.service";
import { settlePaidMatch } from "@/server/services/play-settlement.service";

export const LEGACY_MUTATIONS_RETIRED = true;

export function legacyMutationRetiredResponse() {
  return NextResponse.json(
    {
      error: "This retired legacy match is read-only. Paid gameplay is available only through current lobby tables.",
      code: "LEGACY_RETIRED",
    },
    { status: 410 },
  );
}

/** Existing game URLs, with paid tables bound to their persisted match. */
export async function paidGameRoute(
  request: Request,
  roomId: string,
  game: GameType,
  action?: MatchAction | "settle",
) {
  if (!isPlayLobbySlotId(roomId)) {
    if (!action) return null;
    return legacyMutationRetiredResponse();
  }
  try {
    const url = new URL(request.url);
    if (!action)
      return NextResponse.json(
        {
          match: await getPaidMatch(
            roomId,
            game,
            url.searchParams.get("matchId") ?? undefined,
          ),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    const body = await readJsonBody(request);
    const address = await requirePlayWallet(
      request,
      readOptionalString(body, "address"),
    );
    const matchId = readOptionalString(body, "matchId");
    if (!matchId) throw new ServiceError("matchId is required.", 400);
    if (action === "settle") {
      const match = await getPaidMatch(roomId, game, matchId);
      if (
        !match.state.players.some(
          (player) => player.id.toLowerCase() === address,
        )
      )
        throw new ServiceError("You are not seated in this match.", 403);
      return NextResponse.json({ match: await settlePaidMatch(match) });
    }
    const version = (body as Record<string, unknown> | null)?.version;
    if (
      typeof version !== "number" ||
      !Number.isSafeInteger(version) ||
      version < 0
    )
      throw new ServiceError("A valid match version is required.", 400);
    const match = await actPaidMatch({
      tableId: roomId,
      game,
      address,
      matchId,
      version,
      action,
      pawnId: readOptionalString(body, "pawnId"),
    });
    return NextResponse.json({ match });
  } catch (error) {
    return errorResponse(error, `paid ${game} ${action ?? "state"}`);
  }
}
