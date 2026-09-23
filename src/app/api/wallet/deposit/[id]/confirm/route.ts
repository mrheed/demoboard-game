import { NextResponse } from "next/server";

import {
  errorResponse,
  readJsonBody,
  readOptionalBoolean,
  readOptionalInteger,
  readOptionalNumber,
  readOptionalString,
} from "@/server/lib/api-response";
import { assertServiceSecret } from "@/server/lib/service-auth";
import { confirmDeposit } from "@/server/services/deposit-confirm.service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/wallet/deposit/[id]/confirm · chain-listener hook.
 *
 * Credits the user's balance, so it is authenticated with the shared service
 * secret rather than a player session. Body (optional):
 * `{ txHash?: string, fail?: boolean }`
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing deposit id." }, { status: 400 });
  }

  try {
    assertServiceSecret(request);
    const body = await readJsonBody(request);

    const result = await confirmDeposit({
      transactionId: id,
      txHash: readOptionalString(body, "txHash"),
      eventIndex: readOptionalInteger(body, "eventIndex", { min: 0, max: 2_147_483_647 }),
      amount: readOptionalNumber(body, "amount"),
      chain: readOptionalString(body, "chain"),
      walletAddress: readOptionalString(body, "walletAddress"),
      asset: readOptionalString(body, "asset"),
      fail: readOptionalBoolean(body, "fail") ?? false,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "POST /api/wallet/deposit/:id/confirm");
  }
}
