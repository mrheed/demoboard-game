"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDisconnect } from "wagmi";

import { PixelButton } from "@/components/ui/pixel-button";
import { clearBoardSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/**
 * Sign out · revokes server session, clears client keys, disconnects wallet.
 */
export function LogoutButton({
  className,
  onLoggedOut,
}: {
  className?: string;
  onLoggedOut?: () => void;
}) {
  const router = useRouter();
  const { disconnect } = useDisconnect();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("The server could not revoke this session.");
      clearBoardSession();
      try { disconnect(); } catch { /* the server session is already revoked */ }
      onLoggedOut?.();
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign out. Retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn(className)}>
      <PixelButton
        type="button"
        variant="outline"
        size="md"
        className="w-full"
        disabled={busy}
        onClick={() => void logout()}
      >
        {busy ? "Signing out…" : "Sign out"}
      </PixelButton>
      {error ? <p role="alert" className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
