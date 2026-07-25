/**
 * Public Chat Widget parent-page embed script.
 * Phase 7, Increment 3, Task 4B (AD-025, AD-026, AD-027).
 *
 * Plain, dependency-free JavaScript: this file runs unmodified on an
 * arbitrary third-party host page and must not assume any framework
 * runtime is present. It has no shared module boundary with the
 * TypeScript application, so the protocol constants and dimensions
 * below are hand-kept in sync with src/lib/widget-client/parent-channel.ts
 * rather than imported.
 *
 * Responsibilities (AD-025): inject the iframe at an initial size, and
 * resize its container only in response to an explicit,
 * origin-and-source-validated signal from the iframe. This script never
 * sends the iframe any message -- the protocol is unidirectional by
 * design (see parent-channel.ts).
 */
(function () {
  "use strict";

  if (window.__aiKbWidgetEmbedInitialized) {
    console.warn(
      "[ai-kb-widget] embed script already initialized on this page; ignoring duplicate include."
    );
    return;
  }
  window.__aiKbWidgetEmbedInitialized = true;

  var WIDGET_CHANNEL = "ai-kb-widget";
  var PROTOCOL_VERSION = 1;

  // Only the collapsed size is needed here: the expanded size is
  // supplied dynamically by the widget itself via RESIZE_REQUIRED -- the
  // parent never hard-codes it.
  var COLLAPSED_DIMENSIONS = { width: 170, height: 64 };
  var MAX_DIMENSION_PX = 2000;

  var currentScript = document.currentScript;
  if (!currentScript) {
    console.error(
      "[ai-kb-widget] embed script could not locate its own <script> element; aborting."
    );
    return;
  }

  var publicChatbotIdentifier = currentScript.getAttribute("data-public-chatbot-identifier");
  if (!publicChatbotIdentifier) {
    console.error(
      "[ai-kb-widget] missing required data-public-chatbot-identifier attribute; aborting."
    );
    return;
  }

  var widgetOrigin = new URL(currentScript.src).origin;
  var iframeSrc =
    widgetOrigin + "/widget?publicChatbotIdentifier=" + encodeURIComponent(publicChatbotIdentifier);

  var iframe = document.createElement("iframe");
  iframe.src = iframeSrc;
  iframe.title = "Chat widget";
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.style.position = "fixed";
  iframe.style.bottom = "0";
  iframe.style.right = "0";
  iframe.style.border = "none";
  iframe.style.zIndex = "2147483647";
  iframe.style.width = COLLAPSED_DIMENSIONS.width + "px";
  iframe.style.height = COLLAPSED_DIMENSIONS.height + "px";

  document.body.appendChild(iframe);

  var knownInstanceId = null;
  var tornDown = false;

  function isValidDimension(value) {
    return typeof value === "number" && isFinite(value) && value > 0 && value <= MAX_DIMENSION_PX;
  }

  function applyResize(dimensions) {
    if (
      !dimensions ||
      typeof dimensions !== "object" ||
      !isValidDimension(dimensions.width) ||
      !isValidDimension(dimensions.height)
    ) {
      return;
    }

    iframe.style.width = dimensions.width + "px";
    iframe.style.height = dimensions.height + "px";
  }

  function teardown() {
    if (tornDown) {
      return;
    }

    tornDown = true;
    window.removeEventListener("message", handleMessage);
  }

  // Every failed check below returns immediately: the message is
  // ignored, no partial handling occurs, no response is emitted, and no
  // diagnostic is exposed to the embedding page. This is a deliberate,
  // uniform failure mode -- see Task 4B Review Package requirement 6.
  function handleMessage(event) {
    if (tornDown) {
      return;
    }

    if (event.source !== iframe.contentWindow) {
      return;
    }

    if (event.origin !== widgetOrigin) {
      return;
    }

    var data = event.data;

    if (!data || typeof data !== "object") {
      return;
    }

    if (data.channel !== WIDGET_CHANNEL) {
      return;
    }

    if (data.version !== PROTOCOL_VERSION) {
      return;
    }

    if (typeof data.instanceId !== "string" || data.instanceId.length === 0) {
      return;
    }

    if (knownInstanceId === null) {
      knownInstanceId = data.instanceId;
    } else if (data.instanceId !== knownInstanceId) {
      return;
    }

    switch (data.type) {
      case "READY":
        return;
      case "STATE_CHANGED":
        return;
      case "RESIZE_REQUIRED":
        applyResize(data.payload && data.payload.dimensions);
        return;
      case "INIT_FAILURE":
        // Presentation-neutral by design: the widget remains the sole
        // authority for its own presentation (AD-027). This script
        // takes no visual action -- it only surfaces the event for the
        // embedding developer's own diagnostics.
        console.warn(
          "[ai-kb-widget] widget reported an initialization failure:",
          data.payload && data.payload.reason
        );
        return;
      case "TEARDOWN":
        teardown();
        return;
      default:
        return;
    }
  }

  window.addEventListener("message", handleMessage);
})();
