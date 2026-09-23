"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PixelButton } from "@/components/ui/pixel-button";
import { PixelField } from "@/components/ui/pixel-field";
import { notifyDemoAccessChange } from "@/hooks/use-demo-access";
import { DEMO_DEFAULT_NEXT, safeNextPath } from "@/lib/demo-access";
import {
  lobbyPathForGame,
  parsePreviewGame,
  readPreviewGame,
  rememberPreviewGame,
} from "@/lib/preview-game";

type DemoGateFormProps = {
  nextPath?: string;
  game?: string | null;
  errorCode?: string;
};

export function DemoGateForm({
  nextPath = DEMO_DEFAULT_NEXT,
  game,
  errorCode,
}: DemoGateFormProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(() => parsePreviewGame(game));
  const [error, setError] = useState(
    errorCode ? messageForError(errorCode) : "",
  );

  useEffect(() => {
    const fromQuery = parsePreviewGame(game);
    const stored = readPreviewGame();
    const next = fromQuery ?? stored;
    if (next) {
      rememberPreviewGame(next);
      const timer = window.setTimeout(() => setPicked(next), 0);
      return () => window.clearTimeout(timer);
    }
  }, [game]);

  const resolvedNext = useMemo(() => {
    const safe = safeNextPath(nextPath);
    if (safe !== DEMO_DEFAULT_NEXT) return safe;
    if (picked) return lobbyPathForGame(picked);
    return safe;
  }, [nextPath, picked]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/demo/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          next: resolvedNext,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        next?: string;
      };

      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Wrong access code.");
        setBusy(false);
        return;
      }

      notifyDemoAccessChange();
      router.replace(safeNextPath(payload.next));
      router.refresh();
    } catch {
      setError("Could not reach the demo gate. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {picked ? (
        <p className="font-pixel text-xs font-semibold uppercase leading-relaxed text-parchment">
          {picked === "ludo"
            ? "Ludo is selected. You will land on those tables."
            : "Monopoly is selected. You will land on those tables."}
        </p>
      ) : null}
      <PixelField
        id="demo-code"
        name="code"
        label="Access code"
        autoComplete="off"
        spellCheck={false}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        error={error}
        hint="Use the code from the project link, or paste the whole link. It unlocks on its own."
        placeholder="Enter your access code"
      />
      <PixelButton
        type="submit"
        size="lg"
        variant="primary"
        disabled={busy || code.trim().length === 0}
        className="w-full justify-center"
      >
        {busy ? "Opening…" : "Enter closed demo"}
      </PixelButton>
    </form>
  );
}

function messageForError(code: string): string {
  if (code === "code") return "That access code did not match.";
  return "Could not open the demo with that link.";
}
