import { subscribePlayTable } from "@/server/realtime/play-hub";
import { getPlayTable } from "@/server/services/play-table.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 15_000;

type RouteContext = {
  params: Promise<{ tableId: string }>;
};

/** GET /api/play/tables/[tableId]/stream · SSE for waiting-table seats. */
export async function GET(request: Request, context: RouteContext) {
  const { tableId } = await context.params;
  if (!tableId) {
    return new Response(JSON.stringify({ error: "Missing table id." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const initial = await getPlayTable(tableId);
  if (!initial) {
    return new Response(
      JSON.stringify({ error: "Table not found.", code: "NOT_FOUND" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  let closed = false;
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

      push("table", { type: "table", table: initial });

      unsubscribe = subscribePlayTable(tableId, (payload) => {
        push(payload.type, payload);
      });

      heartbeatTimer = setInterval(() => {
        push("heartbeat", {
          type: "heartbeat",
          tableId,
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
