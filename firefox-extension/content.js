"use strict";

// Track form field values and send them to background for correlation.
// Injects a page-level script to capture request bodies that Firefox
// webRequest may not expose (sendBeacon, some fetch calls).

var MIN_LENGTH = 3;
var tracked = {}; // value → { label, ts }

// --- Inject page-level body capture script ---
(function () {
  try {
    var s = document.createElement("script");
    s.src = browser.runtime.getURL("injected.js");
    s.onload = function () { s.remove(); };
    s.onerror = function () { s.remove(); }; // CSP may block — fail silently
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
})();

// Listen for captured request bodies from injected.js
window.addEventListener("__wearesilent_request__", function (e) {
  if (!e.detail || !e.detail.url || !e.detail.body) return;
  browser.runtime.sendMessage({
    type: "capturedRequest",
    url: e.detail.url,
    body: e.detail.body
  }).catch(function () {});
}, true);

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
    var clone = parent.cloneNode(true);
    var inputs = clone.querySelectorAll("input, textarea, select");
    for (var j = 0; j < inputs.length; j++) inputs[j].remove();
    var labelText = clone.textContent.trim();
    if (labelText) return labelText;
  }

  // 5. placeholder
  var placeholder = el.getAttribute("placeholder");
  if (placeholder && placeholder.trim()) return placeholder.trim();

  // 6. name or id fallback
  var name = el.name || el.id;
  if (name) return name.replace(/[_\-\[\].]+/g, " ").trim();

  return null;
}

function trackField(el) {
  var val = el.value;
  if (!val || val.trim().length < MIN_LENGTH) return;

  var label = getAriaLabel(el);
  if (!label) return;

  var trimmed = val.trim();
  tracked[trimmed] = { label: label, ts: Date.now() };

  // Send to background for correlation
  browser.runtime.sendMessage({
    type: "trackValue",
    value: trimmed,
    label: label
  }).catch(function () {});
}

// --- Scan and report form fields to background (Approach A) ---
function scanFields() {
  var fields = [];
  var seen = {};
  var els = document.querySelectorAll("input, textarea, select");
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    // Skip hidden/submit/button types
    var type = (el.type || "").toLowerCase();
    if (type === "hidden" || type === "submit" || type === "button" || type === "reset") continue;
    if (el.offsetParent === null && type !== "password") continue; // not visible

    var label = getAriaLabel(el);
    if (!label || seen[label]) continue;
    seen[label] = true;
    fields.push(label);
  }
  if (fields.length > 0) {
    browser.runtime.sendMessage({ type: "reportFields", fields: fields }).catch(function () {});
  }
}

// Scan on load and after dynamic content settles
scanFields();
setTimeout(scanFields, 2000);

// input events — works with React, Vue, Angular, vanilla
document.addEventListener("input", function (e) {
  var el = e.target;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    trackField(el);
  }
}, true);

document.addEventListener("change", function (e) {
  var el = e.target;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
    trackField(el);
  }
}, true);
