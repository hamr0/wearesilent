"use strict";

// Inject page-level script via <script> element.
// Firefox's world:"MAIN" is unreliable — this is the proven approach.
// Must happen at document_start before any site scripts run.
var script = document.createElement("script");
script.src = browser.runtime.getURL("injected.js");
script.onload = function () { script.remove(); };
(document.documentElement || document.head || document.body).appendChild(script);

// Keep background alive (harmless on Firefox event pages)
var port = null;
function ensurePort() {
  if (port) return;
  try {
    port = browser.runtime.connect({ name: "keepalive" });
    port.onDisconnect.addListener(function () {
      port = null;
      setTimeout(ensurePort, 1000);
    });
  } catch (e) { port = null; }
}
ensurePort();

// Forward leak messages from injected.js (page context) to background
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

  browser.runtime.sendMessage(msg).catch(function () {
    ensurePort();
    browser.runtime.sendMessage(msg).catch(function () {});
  });
});
