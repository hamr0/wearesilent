"use strict";

// Capture outgoing request bodies that Firefox webRequest may not expose.
// Dispatches CustomEvents to the content script with URL + body text.

(function () {
  var EVENT_NAME = "__wearesilent_request__";

  function notify(url, body) {
    if (!url || !body) return;
    var text = "";
    if (typeof body === "string") {
      text = body;
    } else if (body instanceof URLSearchParams) {
      text = body.toString();
    } else if (body instanceof FormData) {
      var parts = [];
      body.forEach(function (v, k) {
        if (typeof v === "string") parts.push(k + "=" + v);
      });
      text = parts.join("&");
    } else if (body instanceof ArrayBuffer) {
      try { text = new TextDecoder().decode(body); } catch (e) {}
    } else if (body instanceof Blob) {
      return;
    } else {
      try { text = String(body); } catch (e) {}
    }
    if (!text || text.length < 3) return;
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, {
        detail: { url: String(url), body: text }
      }));
    } catch (e) {}
  }

  // --- fetch ---
  var origFetch = window.fetch;
  window.fetch = function (resource, init) {
    try {
      var url = (resource instanceof Request) ? resource.url : String(resource);
      if (init && init.body) notify(url, init.body);
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };

  // --- XMLHttpRequest ---
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__was_url = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try { notify(this.__was_url, body); } catch (e) {}
    return origSend.apply(this, arguments);
  };

  // --- sendBeacon ---
  var origBeacon = navigator.sendBeacon;
  if (origBeacon) {
    navigator.sendBeacon = function (url, body) {
      try { notify(url, body); } catch (e) {}
      return origBeacon.apply(this, arguments);
    };
  }
})();
