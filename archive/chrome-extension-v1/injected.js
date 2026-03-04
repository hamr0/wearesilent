"use strict";

(function () {
  var TAG = "[wearesilent]";
  var recentValues = {}; // { value: { field, ts } }
  var MAX_VALUES = 30;
  var MIN_LENGTH = 4;
  var VALUE_TTL = 30000; // 30s — values older than this are ignored
  var leaksSent = {}; // dedup: "field:destination" → true

  // --- Track input values ---

  function recordValue(field, value) {
    if (!value || value.length < MIN_LENGTH) return;
    var trimmed = value.trim();
    if (trimmed.length < MIN_LENGTH) return;

    // Prune old entries
    var now = Date.now();
    var keys = Object.keys(recentValues);
    if (keys.length > MAX_VALUES) {
      for (var i = 0; i < keys.length; i++) {
        if (now - recentValues[keys[i]].ts > VALUE_TTL) {
          delete recentValues[keys[i]];
        }
      }
    }

    recentValues[trimmed] = { field: field, ts: now };
  }

  function getFieldName(el) {
    return el.name || el.id || el.type || "input";
  }

  // Wrap HTMLInputElement.prototype.value getter
  var inputDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (inputDesc && inputDesc.get) {
    var origGet = inputDesc.get;
    Object.defineProperty(HTMLInputElement.prototype, "value", {
      get: function () {
        var val = origGet.call(this);
        // Only track text-like inputs
        var type = (this.type || "text").toLowerCase();
        if (type === "text" || type === "email" || type === "tel" || type === "search" || type === "password" || type === "url") {
          recordValue(getFieldName(this), val);
        }
        return val;
      },
      set: inputDesc.set,
      configurable: true,
      enumerable: true
    });
  }

  // Wrap textarea value getter
  var textareaDesc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  if (textareaDesc && textareaDesc.get) {
    var origTextareaGet = textareaDesc.get;
    Object.defineProperty(HTMLTextAreaElement.prototype, "value", {
      get: function () {
        var val = origTextareaGet.call(this);
        recordValue(getFieldName(this), val);
        return val;
      },
      set: textareaDesc.set,
      configurable: true,
      enumerable: true
    });
  }

  // --- Intercept outgoing requests ---

  var pageOrigin = location.origin;

  function isCrossOrigin(url) {
    try {
      return new URL(url, location.href).origin !== pageOrigin;
    } catch (e) {
      return false;
    }
  }

  function getDomain(url) {
    try {
      return new URL(url, location.href).hostname;
    } catch (e) {
      return url;
    }
  }

  function checkForLeaks(url, body) {
    var now = Date.now();
    var destination = getDomain(url);
    var searchIn = (url + " " + (body || "")).toLowerCase();

    for (var value in recentValues) {
      var entry = recentValues[value];
      if (now - entry.ts > VALUE_TTL) continue;

      var lowerVal = value.toLowerCase();
      // Check raw, URL-encoded, and base64
      var encoded = encodeURIComponent(value).toLowerCase();

      if (searchIn.indexOf(lowerVal) !== -1 || searchIn.indexOf(encoded) !== -1) {
        var key = entry.field + ":" + destination;
        if (leaksSent[key]) continue;
        leaksSent[key] = true;

        window.postMessage({
          type: "wearesilent-leak",
          field: entry.field,
          value: value.length > 20 ? value.slice(0, 8) + "..." + value.slice(-4) : value,
          destination: destination,
          url: url.length > 120 ? url.slice(0, 120) + "..." : url,
          ts: now
        }, "*");
      }
    }
  }

  // Wrap fetch
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url ? input.url : "");
    if (isCrossOrigin(url)) {
      var body = init && init.body ? String(init.body) : "";
      checkForLeaks(url, body);
    }
    return origFetch.apply(this, arguments);
  };

  // Wrap XMLHttpRequest
  var origXHROpen = XMLHttpRequest.prototype.open;
  var origXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._wearesilent_url = url;
    return origXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    var url = this._wearesilent_url || "";
    if (isCrossOrigin(url)) {
      checkForLeaks(url, body ? String(body) : "");
    }
    return origXHRSend.apply(this, arguments);
  };

  // Wrap navigator.sendBeacon
  var origBeacon = navigator.sendBeacon;
  if (origBeacon) {
    navigator.sendBeacon = function (url, data) {
      if (isCrossOrigin(url)) {
        checkForLeaks(url, data ? String(data) : "");
      }
      return origBeacon.apply(this, arguments);
    };
  }

  // Wrap Image src setter (tracking pixels with data in URL)
  var imgDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  if (imgDesc && imgDesc.set) {
    var origImgSet = imgDesc.set;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      get: imgDesc.get,
      set: function (val) {
        if (val && isCrossOrigin(val)) {
          checkForLeaks(val, "");
        }
        return origImgSet.call(this, val);
      },
      configurable: true,
      enumerable: true
    });
  }
})();
