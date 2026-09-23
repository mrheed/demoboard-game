import { NextResponse } from "next/server";

import {
  getBoardChainEnv,
  getBoardChainId,
  getBoardChainLabel,
  ROBINHOOD_TESTNET_FAUCET,
} from "@/lib/wallet/chains";
import { PLAY_ENTRY_FEE, PLAY_STAKE_SYMBOL } from "@/lib/game/play-player";
import { getPlayTreasuryStatus } from "@/server/lib/play-chain";
import { getPlayConfig } from "@/server/services/play-table.service";
import { getPlayEntryReadiness } from "@/server/lib/play-readiness";

/** GET /api/play/config · treasury + sit fee for the play client. */
export async function GET() {
  try {
    const config = getPlayConfig();
    const treasury = await getPlayTreasuryStatus();
    const readiness = await getPlayEntryReadiness();
    return NextResponse.json({
      ...config,
      ...readiness,
      entriesAllowed: readiness.entriesAllowed && treasury.canRefund,
      entryBlockReason: readiness.entryBlockReason ?? (treasury.canRefund ? null : treasury.error ?? "Paid entries paused: treasury USDG or ETH gas reserve is insufficient."),
      symbol: PLAY_STAKE_SYMBOL,
      chainId: getBoardChainId(),
      chainLabel: getBoardChainLabel(),
      faucet: getBoardChainEnv() === "testnet" ? ROBINHOOD_TESTNET_FAUCET : null,
      entryFee: PLAY_ENTRY_FEE,
      treasuryBalance: treasury.balanceUsdg,
      treasuryGasBalanceWei: treasury.gasBalanceWei,
      canRefund: treasury.canRefund,
    });
  } catch (error) {
    console.error("[play-config]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not load play config.",
        symbol: PLAY_STAKE_SYMBOL,
        chainId: getBoardChainId(),
        chainLabel: getBoardChainLabel(),
        faucet: getBoardChainEnv() === "testnet" ? ROBINHOOD_TESTNET_FAUCET : null,
        entryFee: PLAY_ENTRY_FEE,
        treasury: null,
        treasuryBalance: "0",
        canRefund: false,
      },
      { status: 500 },
    );
  }
}
