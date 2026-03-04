"use strict";

// Keep service worker alive by opening a long-lived port.
// MV3 service workers die after ~30s of inactivity; a connected port prevents that.
var port = null;

function ensurePort() {
  if (port) return;
  try {
    port = chrome.runtime.connect({ name: "keepalive" });
    port.onDisconnect.addListener(function () {
      port = null;
      // Reconnect after a short delay if the SW restarted
      setTimeout(ensurePort, 1000);
    });
  } catch (e) {
    port = null;
  }
}

ensurePort();

// Forward leak messages from injected.js (MAIN world) to the service worker
window.addEventListener("message", function (event) {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "wearesilent-leak") return;

  var msg = {
    type: "leak",
    domain: location.hostname,
    label: event.data.label,
    value: event.data.value,
    destination: event.data.destination,
    url: event.data.url,
    ts: event.data.ts
  };

  chrome.runtime.sendMessage(msg).catch(function () {
    // SW may have just restarted; reconnect port and retry
    ensurePort();
    chrome.runtime.sendMessage(msg).catch(function () {});
  });
});
