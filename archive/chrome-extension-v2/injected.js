"use strict";

(function () {
  // ---- Config ----
  var MIN_LENGTH = 3;
  var VALUE_TTL = 60000;
  var MAX_ENTRIES = 50;

  // ---- State ----
  var trackedValues = {}; // { normalizedValue: { label, raw, ts } }
  var leaksSent = {};     // "label\tdestination" → true

  // ---- ARIA label resolution ----

  function getAriaLabel(el) {
    // 1. aria-labelledby
    var labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      var parts = labelledBy.split(/\s+/);
      var texts = [];
      for (var i = 0; i < parts.length; i++) {
        var ref = document.getElementById(parts[i]);
        if (ref) texts.push(ref.textContent.trim());
      }
      var joined = texts.join(" ").trim();
      if (joined) return joined;
    }

    // 2. aria-label
    var ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    // 3. <label for="id">
    if (el.id) {
      var label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label) {
        var text = label.textContent.trim();
        if (text) return text;
      }
    }

    // 4. Wrapping <label>
    var parent = el.closest("label");
    if (parent) {
      // Get label text excluding the input's own text
      var clone = parent.cloneNode(true);
      var inputs = clone.querySelectorAll("input, textarea, select");
      for (var j = 0; j < inputs.length; j++) inputs[j].remove();
      var labelText = clone.textContent.trim();
      if (labelText) return labelText;
    }

    // 5. placeholder
    var placeholder = el.getAttribute("placeholder");
    if (placeholder && placeholder.trim()) return placeholder.trim();

    // 6. name or id as last resort (but cleaned up)
    var name = el.name || el.id;
    if (name) return name.replace(/[_\-\[\].]+/g, " ").trim();

    return null;
  }

  // ---- Track input values via events ----

  function trackField(el) {
    var val = el.value;
    if (!val || val.trim().length < MIN_LENGTH) return;

    var label = getAriaLabel(el);
    if (!label) return;

    var trimmed = val.trim();
    var key = trimmed.toLowerCase();

    // Prune old entries if over limit
    if (Object.keys(trackedValues).length > MAX_ENTRIES) {
      var now = Date.now();
      for (var k in trackedValues) {
        if (now - trackedValues[k].ts > VALUE_TTL) delete trackedValues[k];
      }
    }

    trackedValues[key] = { label: label, raw: trimmed, ts: Date.now() };
  }

  // Listen to input events — works with React, Vue, Angular, vanilla
  document.addEventListener("input", function (e) {
    var el = e.target;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      trackField(el);
    }
  }, true);

  // Also capture change events for selects and autofill
  document.addEventListener("change", function (e) {
    var el = e.target;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      trackField(el);
    }
  }, true);

  // ---- Network interception ----

  var pageOrigin = location.origin;

  function isCrossOrigin(url) {
    try { return new URL(url, location.href).origin !== pageOrigin; }
    catch (e) { return false; }
  }

  function getHostname(url) {
    try { return new URL(url, location.href).hostname; }
    catch (e) { return url; }
  }

  function checkForLeaks(url, body) {
    var now = Date.now();
    var destination = getHostname(url);
    var haystack = (url + " " + (body || "")).toLowerCase();

    for (var key in trackedValues) {
      var entry = trackedValues[key];
      if (now - entry.ts > VALUE_TTL) continue;

      var encoded = encodeURIComponent(entry.raw).toLowerCase();
      if (haystack.indexOf(key) === -1 && haystack.indexOf(encoded) === -1) continue;

      var dedup = entry.label + "\t" + destination;
      if (leaksSent[dedup]) continue;
      leaksSent[dedup] = true;

      window.postMessage({
        type: "wearesilent-leak",
        label: entry.label,
        value: entry.raw.length > 20 ? entry.raw.slice(0, 8) + "..." + entry.raw.slice(-4) : entry.raw,
        destination: destination,
        url: url.length > 120 ? url.slice(0, 120) + "..." : url,
        ts: now
      }, "*");
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
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._ws_url = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this._ws_url && isCrossOrigin(this._ws_url)) {
      checkForLeaks(this._ws_url, body ? String(body) : "");
    }
    return origSend.apply(this, arguments);
  };

  // Wrap sendBeacon
  var origBeacon = navigator.sendBeacon;
  if (origBeacon) {
    navigator.sendBeacon = function (url, data) {
      if (isCrossOrigin(url)) {
        checkForLeaks(url, data ? String(data) : "");
      }
      return origBeacon.apply(this, arguments);
    };
  }

  // Wrap Image.src (tracking pixels)
  var imgDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  if (imgDesc && imgDesc.set) {
    var origImgSet = imgDesc.set;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      get: imgDesc.get,
      set: function (val) {
        if (val && isCrossOrigin(val)) checkForLeaks(val, "");
        return origImgSet.call(this, val);
      },
      configurable: true,
      enumerable: true
    });
  }

})();
