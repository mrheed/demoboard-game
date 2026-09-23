import { getBoardChainEnv, getBoardChainId } from "@/lib/wallet/chains";
import { withPlayDocument } from "@/server/lib/play-store";
import { getPlayTreasuryAddress } from "@/server/lib/play-chain";

type WorkerHealth = { gameplayAt?: number; paymentsAt?: number; paymentError?: string | null };
function healthKey() {
  return `play-worker-${getBoardChainId()}-${getPlayTreasuryAddress().toLowerCase()}`;
}
export async function recordPlayWorkerHealth(kind: "gameplay" | "payments", error: string | null = null) {
  await withPlayDocument<WorkerHealth, void>(healthKey(), () => ({}), async (record) => {
    if (kind === "gameplay") record.gameplayAt = Date.now();
    else { record.paymentsAt = Date.now(); record.paymentError = error; }
  });
}

export async function getPlayEntryReadiness() {
  // Mainnet moves real money, so it stays behind an explicit release flag.
  // Testnet stakes a worthless stand-in token, so it needs no such gate; the
  // worker-health check below still applies to both.
  if (getBoardChainEnv() === "mainnet" && process.env.PLAY_MAINNET_ENABLED !== "true")
    return { entriesAllowed: false, entryBlockReason: "Mainnet entries are disabled pending release approval." };
  // Unit tests exercise mainnet money movement exclusively through a fake RPC.
  if (process.env.NODE_ENV === "test")
    return { entriesAllowed: true, entryBlockReason: null };
  const record = await withPlayDocument<WorkerHealth, WorkerHealth>(healthKey(), () => ({}), async (value) => value);
  const now = Date.now();
  const healthy = now - (record.gameplayAt ?? 0) < 30_000 && now - (record.paymentsAt ?? 0) < 60_000 && !record.paymentError;
  return { entriesAllowed: healthy, entryBlockReason: healthy ? null : "Paid rooms are paused while the game and payment worker recovers. Existing entries remain recoverable." };
}
