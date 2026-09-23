import { requirePlayWallet } from "@/server/lib/require-play-wallet";
import { NextResponse } from "next/server";

import {
  errorResponse,
  failureResponse,
  InvalidBodyError,
  readJsonBody,
  readOptionalString,
} from "@/server/lib/api-response";
import { sitPlayTable, claimUnpaidSit } from "@/server/services/play-table.service";
import type { Hex } from "viem";

function readHex(body: unknown, key: string, bytes: 20 | 32): Hex {
  const raw = readOptionalString(body, key);
  const size = bytes * 2;
  if (!raw || !new RegExp(`^0x[a-fA-F0-9]{${size}}$`).test(raw)) {
    throw new InvalidBodyError(`${key} must be a 0x-prefixed ${bytes}-byte hex value.`, 400);
  }
  return raw.toLowerCase() as Hex;
}

export const maxDuration = 20;

/** POST /api/play/sit · verify the exact 1 USDG transfer and take a waiting seat. */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const game = readOptionalString(body, "game");
    if (game !== "monopoly" && game !== "ludo") {
      throw new InvalidBodyError("game must be monopoly or ludo.", 400);
    }
    const address = await requirePlayWallet(request, readHex(body, "address", 20));
    const tableId = readOptionalString(body, "tableId") ?? undefined;
    const rawTx = readOptionalString(body, "txHash");
    const result = rawTx
      ? await sitPlayTable({
          game,
          tableId,
          address,
          txHash: readHex(body, "txHash", 32),
        })
      : await claimUnpaidSit({ game, tableId, address });
    if (!result.ok) return failureResponse(result);
    return NextResponse.json({
      table: result.table,
      seat: result.seat,
      leaveToken: result.leaveToken,
      alreadySeated: result.alreadySeated,
      txHash: result.txHash,
    });
  } catch (error) {
    return errorResponse(error, "POST /api/play/sit");
  }
}
