// Widget -> parent postMessage protocol (Phase 7, Increment 3, Task 4B,
// AD-027). Unidirectional by deliberate design: the current architecture
// intentionally adopts a unidirectional communication model because no
// parent-to-widget message category presently provides architectural
// value. The widget is the sole source of every message; the parent
// integration layer only ever reacts (resizes its iframe container),
// never issues commands. No message carries conversation identity,
// transcript content, or any other business data.
//
// instanceId is mandatory from protocol version 1 even though only one
// widget instance is supported today: this is a public, long-lived
// contract embedded on third-party pages outside this project's release
// cadence. Adding a required field later would force a breaking version
// bump; generating a per-instance identifier now costs nothing and
// avoids that migration entirely if multi-instance embedding is ever
// authorized.

export const WIDGET_CHANNEL = "ai-kb-widget";
export const PROTOCOL_VERSION = 1;

export type WidgetDimensions = {
  width: number;
  height: number;
};

// Conservative, hand-derived approximations of this slice's actual
// rendered footprint (widget-app.tsx: launcher at fixed bottom-4
// right-4; panel at fixed bottom-20 right-4, h-[28rem] w-80), not
// pixel-exact CSS output. COLLAPSED_DIMENSIONS is also duplicated in the
// parent-side embed script (public/widget-embed.js -- a separate,
// unbuilt plain-JS file with no shared module boundary with this
// TypeScript app) for its initial iframe size; EXPANDED_DIMENSIONS is
// only needed here, since the parent learns the expanded size
// dynamically via RESIZE_REQUIRED rather than hard-coding it. Keep
// COLLAPSED_DIMENSIONS in sync by hand across both files if the
// collapsed footprint changes.
export const COLLAPSED_DIMENSIONS: WidgetDimensions = { width: 170, height: 64 };
export const EXPANDED_DIMENSIONS: WidgetDimensions = { width: 352, height: 528 };

type WidgetMessageType =
  "READY" | "STATE_CHANGED" | "RESIZE_REQUIRED" | "INIT_FAILURE" | "TEARDOWN";

type WidgetEnvelope<TType extends WidgetMessageType, TPayload> = {
  channel: typeof WIDGET_CHANNEL;
  version: typeof PROTOCOL_VERSION;
  instanceId: string;
  type: TType;
  payload: TPayload;
};

const instanceId = typeof crypto !== "undefined" ? crypto.randomUUID() : "";

function post<TType extends WidgetMessageType, TPayload>(type: TType, payload: TPayload): void {
  if (typeof window === "undefined" || window.parent === window) {
    return;
  }

  const envelope: WidgetEnvelope<TType, TPayload> = {
    channel: WIDGET_CHANNEL,
    version: PROTOCOL_VERSION,
    instanceId,
    type,
    payload,
  };

  window.parent.postMessage(envelope, "*");
}

export function postReady(): void {
  post("READY", {});
}

export function postStateChanged(state: "open" | "closed"): void {
  post("STATE_CHANGED", { state });
}

export function postResizeRequired(dimensions: WidgetDimensions): void {
  post("RESIZE_REQUIRED", { dimensions });
}

export function postInitFailure(reason: "invalid_identifier" | "unknown"): void {
  post("INIT_FAILURE", { reason });
}

export function postTeardown(): void {
  post("TEARDOWN", {});
}
