import { requirePlayWallet } from "@/server/lib/require-play-wallet";
import { NextResponse } from "next/server";

import {
  errorResponse,
  failureResponse,
  InvalidBodyError,
  readJsonBody,
  readOptionalString,
} from "@/server/lib/api-response";
import { leavePlayTable } from "@/server/services/play-table.service";

export const maxDuration = 20;

type RouteContext = {
  params: Promise<{ tableId: string }>;
};

/** POST /api/play/tables/[tableId]/leave · leave a waiting table and refund USDG. */
export async function POST(request: Request, context: RouteContext) {
  const { tableId } = await context.params;
  if (!tableId) {
    return NextResponse.json({ error: "Missing table id." }, { status: 400 });
  }

  try {
    const body = await readJsonBody(request);
    const leaveToken = readOptionalString(body, "leaveToken");
    if (!leaveToken) {
      throw new InvalidBodyError("leaveToken is required.", 400);
    }
    const result = await leavePlayTable({
      tableId,
      leaveToken,
      address: await requirePlayWallet(request, readOptionalString(body, "address")),
      txHash: readOptionalString(body, "txHash"),
    });
    if (!result.ok) return failureResponse(result);
    return NextResponse.json({
      table: result.table,
      refundTxHash: result.refundTxHash ?? null,
      refundPending: result.refundPending ?? false,
    });
  } catch (error) {
    return errorResponse(error, "POST /api/play/tables/:tableId/leave");
  }
}
