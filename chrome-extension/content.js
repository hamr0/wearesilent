"use strict";

// Inject page-level script for prototype wrapping
(function () {
  var script = document.createElement("script");
  script.src = chrome.runtime.getURL("injected.js");
  script.onload = function () { script.remove(); };
  (document.head || document.documentElement).appendChild(script);
})();

// Listen for leak events from injected script
window.addEventListener("message", function (event) {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "wearesilent-leak") return;

  var leak = event.data;
  console.log("[wearesilent] LEAK:", leak.field, "→", leak.destination);

  chrome.runtime.sendMessage({
    type: "leak",
    domain: location.hostname,
    field: leak.field,
    value: leak.value,
    destination: leak.destination,
    url: leak.url,
    ts: leak.ts
  });
});
