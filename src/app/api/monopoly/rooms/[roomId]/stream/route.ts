import { subscribeMonopoly, type MonopolyStreamPayload } from "@/server/realtime/monopoly-hub";
import { getMonopolyState } from "@/server/services/monopoly-state.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 15_000;
/** Fallback poll so DB writes from other processes still reach clients. */
const POLL_MS = 2_000;

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

/**
 * GET /api/monopoly/rooms/[roomId]/stream · SSE for Monopoly actions + state.
 *
 * Events:
 * - `state`     full board snapshot (initial + after poll/diff)
 * - `action`    player action with updated state (published by game services)
 * - `heartbeat` keep-alive
 */
export async function GET(request: Request, context: RouteContext) {
  const { roomId } = await context.params;
  if (!roomId) {
    return new Response(JSON.stringify({ error: "Missing room id." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const initial = await getMonopolyState(roomId);
  if (!initial) {
    return new Response(
      JSON.stringify({ error: "Monopoly room not found.", code: "NOT_FOUND" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  let closed = false;
  let lastFingerprint = fingerprintState(initial.state);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const push = (event: string, data: unknown) => {
        if (closed) return;
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          cleanup();
          try { controller.close(); } catch { /* already closed */ }
          return;
        }
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const pushPayload = (payload: MonopolyStreamPayload) => {
        push(payload.type, payload);
        if (payload.type === "state" || payload.type === "action") {
          lastFingerprint = fingerprintState(payload.state);
        }
      };

      pushPayload({
        type: "state",
        roomId: initial.state.roomId,
        state: initial.state,
        source: initial.source,
      });

      unsubscribe = subscribeMonopoly(roomId, (payload) => {
        pushPayload(payload);
      });

      pollTimer = setInterval(() => {
        void (async () => {
          if (closed) return;
          try {
            const latest = await getMonopolyState(roomId);
            if (!latest) return;
            const next = fingerprintState(latest.state);
            if (next === lastFingerprint) return;
            lastFingerprint = next;
            pushPayload({
              type: "state",
              roomId: latest.state.roomId,
              state: latest.state,
              source: latest.source,
            });
          } catch (error) {
            console.error("[GET /api/monopoly/rooms/:roomId/stream]", error);
          }
        })();
      }, POLL_MS);

      heartbeatTimer = setInterval(() => {
        push("heartbeat", {
          type: "heartbeat",
          roomId,
          ts: Date.now(),
        });
      }, HEARTBEAT_MS);

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    if (closed) return;
    closed = true;
    if (pollTimer) clearInterval(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    unsubscribe?.();
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function fingerprintState(state: {
  turn: number;
  activeSeat: number;
  turnSecondsLeft: number;
  players: { cash: number; tile: number; status: string; owned: number }[];
  owners: Record<number, number>;
  log: { id: string }[];
}) {
  const players = state.players
    .map(
      (p) =>
        `${p.cash}:${p.tile}:${p.status}:${p.owned}`,
    )
    .join(",");
  const owners = Object.entries(state.owners)
    .map(([tile, seat]) => `${tile}:${seat}`)
    .join(",");
  return `${state.turn}|${state.activeSeat}|${state.log[0]?.id ?? ""}|${players}|${owners}`;
}
