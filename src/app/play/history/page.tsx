"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";
import { usePlaySession } from "@/hooks/use-play-session";
import { getBoardExplorerUrl } from "@/lib/wallet/chains";
import type { PlaySettlement } from "@/lib/game/live-match";
import { PLAY_ENTRY_FEE, PLAY_STAKE_SYMBOL } from "@/lib/game/play-player";

type History = {
  matches: { id: string; roomId: string; game: string; winnerSeat: number | null; settlement: PlaySettlement | null }[];
  refunds: { id: string; status: string; createdAt: number; txHash?: string; error?: string | null }[];
};

export default function PaidHistoryPage() {
  const { address } = useAccount();
  const ensureSession = usePlaySession();
  const [result, setResult] = useState<{ address: string; history: History } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const history = result && result.address === address ? result.history : null;

  async function refresh() {
    if (!address || busy) return;
    setBusy(true); setError(null);
    try {
      await ensureSession(address);
      const response = await fetch(`/api/play/history?address=${address}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load history.");
      setResult({ address, history: data });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load history."); }
    finally { setBusy(false); }
  }

  return <main className="relative z-[1] mx-auto min-h-screen w-full max-w-3xl bg-void px-6 pb-12 pt-24 text-cream">
    <Link href="/play" className="text-gold underline">Back to Ludo</Link>
    <h1 className="mt-6 font-pixel text-2xl">My matches and refunds</h1>
    <p className="mt-4">Results remain here after a lobby table is reused. Submitted payments are not confirmed payments. The payment worker retries saved transactions; you never need to pay entry again to claim a result.</p>
    <button onClick={() => void refresh()} disabled={!address || busy} className="my-6 border-2 border-gold px-4 py-2 text-gold disabled:opacity-50">
      {busy ? "Loading…" : address ? "Sign in / refresh history" : "Connect your playing wallet first"}
    </button>
    {error ? <p role="alert">{error}</p> : null}
    {history ? <>
      <h2 className="mt-4 text-xl">Matches</h2>
      {history.matches.length ? <ul className="mt-3 space-y-4">{history.matches.map((match) => <li key={match.id} className="border border-cream/30 p-4">
        <Link className="text-gold underline" href={`/room/${match.roomId}?match=${match.id}`}>{match.roomId} · open saved match</Link>
        <p>{match.winnerSeat === null ? "In progress" : `Winner: seat ${match.winnerSeat}`} · {match.settlement?.status ?? "No payout due yet"}</p>
        {match.settlement ? <p>Pot {match.settlement.grossPot} {PLAY_STAKE_SYMBOL} · fee {match.settlement.feeAmount} {PLAY_STAKE_SYMBOL} · winner {match.settlement.netPayout} {PLAY_STAKE_SYMBOL}</p> : null}
        {match.settlement?.txHash ? <a className="text-gold underline" href={`${getBoardExplorerUrl()}/tx/${match.settlement.txHash}`} target="_blank" rel="noreferrer">Payout transaction</a> : null}
        {match.settlement?.error ? <p>{match.settlement.error}</p> : null}
      </li>)}</ul> : <p>No paid matches for this wallet.</p>}
      <h2 className="mt-8 text-xl">Entry refunds</h2>
      {history.refunds.length ? <ul className="mt-3 space-y-4">{history.refunds.map((refund) => <li key={refund.id} className="border border-cream/30 p-4">
        <p>{PLAY_ENTRY_FEE} {PLAY_STAKE_SYMBOL} · {refund.status} · {new Date(refund.createdAt).toISOString()}</p>
        {refund.txHash ? <a className="text-gold underline" href={`${getBoardExplorerUrl()}/tx/${refund.txHash}`} target="_blank" rel="noreferrer">Refund transaction</a> : null}
        {refund.error ? <p>{refund.error}</p> : null}
      </li>)}</ul> : <p>No refunds for this wallet.</p>}
    </> : null}
  </main>;
}
