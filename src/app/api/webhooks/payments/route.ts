import { NextResponse } from "next/server";

import {
  errorResponse,
  InvalidBodyError,
  readJsonBody,
  readOptionalInteger,
  readOptionalNumber,
  readOptionalString,
} from "@/server/lib/api-response";
import { assertServiceSecret } from "@/server/lib/service-auth";
import {
  processPaymentWebhook,
  type PaymentWebhookKind,
  type PaymentWebhookStatus,
} from "@/server/services/payment-webhook.service";

const KINDS = ["reward_payout", "deposit", "withdraw"] as const;
const STATUSES = ["paid", "confirmed", "failed"] as const;

/** Narrow an unvalidated body value to one of the allowed literals. */
function readLiteral<T extends string>(
  body: unknown,
  key: string,
  allowed: readonly T[],
): T {
  const raw = readOptionalString(body, key);
  const match = allowed.find((option) => option === raw);
  if (!match) {
    throw new InvalidBodyError(`${key} must be one of ${allowed.join(", ")}.`, 400);
  }
  return match;
}

/**
 * POST /api/webhooks/payments · chain-indexer hook that reports on-chain
 * payment status for reward payouts and deposit/withdraw ledger rows.
 *
 * Headers: `x-webhook-secret` or `Authorization: Bearer …`, matched against
 * `PAYMENT_WEBHOOK_SECRET`.
 *
 * Body: `{ kind, id, status, txHash?, treasuryTxHash?, burnTxHash?,
 * burnProofUri? }`
 */
export async function POST(request: Request) {
  try {
    assertServiceSecret(request);
    const body = await readJsonBody(request);

    const id = readOptionalString(body, "id");
    if (!id) {
      throw new InvalidBodyError("id is required.", 400);
    }

    const result = await processPaymentWebhook({
      kind: readLiteral<PaymentWebhookKind>(body, "kind", KINDS),
      id,
      status: readLiteral<PaymentWebhookStatus>(body, "status", STATUSES),
      txHash: readOptionalString(body, "txHash"),
      eventIndex: readOptionalInteger(body, "eventIndex", { min: 0, max: 2_147_483_647 }),
      amount: readOptionalNumber(body, "amount"),
      chain: readOptionalString(body, "chain"),
      walletAddress: readOptionalString(body, "walletAddress"),
      asset: readOptionalString(body, "asset"),
      treasuryTxHash: readOptionalString(body, "treasuryTxHash"),
      burnTxHash: readOptionalString(body, "burnTxHash"),
      burnProofUri: readOptionalString(body, "burnProofUri"),
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "POST /api/webhooks/payments");
  }
}
