"use strict";

// Track form field values and send them to background for correlation.
// No MAIN world script needed — webRequest handles network monitoring.

var MIN_LENGTH = 3;
var tracked = {}; // value → { label, ts }

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
  if (!chrome.runtime.id) return; // extension was reloaded/invalidated
  chrome.runtime.sendMessage({
    type: "trackValue",
    value: trimmed,
    label: label
  }).catch(function () {});
}

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
