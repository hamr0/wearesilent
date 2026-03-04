"use strict";

// Per-tab tracked values: { tabId: { "valueKey": { label, value, ts } } }
var tabValues = {};

// Per-tab buffered requests: { tabId: [ { url, haystack, destHostname, ts } ] }
var tabRequests = {};

var VALUE_TTL = 120000; // 2 minutes
var REQUEST_BUFFER_TTL = 30000; // 30s — keep recent requests for retroactive matching
var MAX_VALUES_PER_TAB = 50;
var MAX_REQUESTS_PER_TAB = 100;

// --- Build haystack from request details ---

function buildHaystack(details) {
  var haystack = details.url.toLowerCase();
  if (details.requestBody) {
    if (details.requestBody.raw) {
      for (var i = 0; i < details.requestBody.raw.length; i++) {
        var bytes = details.requestBody.raw[i].bytes;
        if (bytes) {
          try { haystack += " " + new TextDecoder().decode(bytes).toLowerCase(); }
          catch (e) {}
        }
      }
    }
    if (details.requestBody.formData) {
      for (var field in details.requestBody.formData) {
        haystack += " " + field.toLowerCase() + "=" + details.requestBody.formData[field].join(",").toLowerCase();
      }
    }
  }
  return haystack;
}

// --- Check a value against a haystack ---

function matchValue(key, value, haystack) {
  var encoded = encodeURIComponent(value).toLowerCase();
  return haystack.indexOf(key) !== -1 || haystack.indexOf(encoded) !== -1;
}

// --- Receive tracked values from content scripts ---

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === "trackValue" && sender.tab) {
    var tabId = sender.tab.id;
    if (!tabValues[tabId]) tabValues[tabId] = {};

    var values = tabValues[tabId];

    // Prune old entries
    if (Object.keys(values).length > MAX_VALUES_PER_TAB) {
      var now = Date.now();
      for (var k in values) {
        if (now - values[k].ts > VALUE_TTL) delete values[k];
      }
    }

    var key = message.value.toLowerCase();
    values[key] = {
      label: message.label,
      value: message.value,
      ts: Date.now()
    };

    // Retroactive check: match this new value against buffered requests
    var buffered = tabRequests[tabId];
    if (buffered) {
      var now2 = Date.now();
      for (var r = 0; r < buffered.length; r++) {
        var req = buffered[r];
        if (now2 - req.ts > REQUEST_BUFFER_TTL) continue;
        if (matchValue(key, message.value, req.haystack)) {
          storeLeak(tabId, {
            label: message.label,
            value: message.value.length > 20 ? message.value.slice(0, 8) + "..." + message.value.slice(-4) : message.value,
            destination: req.destHostname,
            url: req.url.length > 120 ? req.url.slice(0, 120) + "..." : req.url,
            ts: now2
          });
        }
      }
    }

    return;
  }

  if (message.type === "getLeaks") {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs.length) { sendResponse(null); return; }
      chrome.storage.session.get("tab:" + tabs[0].id, function (result) {
        sendResponse(result["tab:" + tabs[0].id] || null);
      });
    });
    return true;
  }
});

// --- Monitor ALL cross-origin requests via webRequest ---

chrome.webRequest.onBeforeRequest.addListener(
  function (details) {
    if (details.tabId < 0) return;

    var destHostname;
    try { destHostname = new URL(details.url).hostname; }
    catch (e) { return; }

    var haystack = buildHaystack(details);

    // Buffer this request for retroactive matching
    if (!tabRequests[details.tabId]) tabRequests[details.tabId] = [];
    var buf = tabRequests[details.tabId];
    buf.push({ url: details.url, haystack: haystack, destHostname: destHostname, ts: Date.now() });
    // Prune old buffered requests
    if (buf.length > MAX_REQUESTS_PER_TAB) {
      var cutoff = Date.now() - REQUEST_BUFFER_TTL;
      tabRequests[details.tabId] = buf.filter(function (r) { return r.ts > cutoff; });
    }

    // Forward check: match request against known values
    var values = tabValues[details.tabId];
    if (!values) return;

    var now = Date.now();
    for (var key in values) {
      var entry = values[key];
      if (now - entry.ts > VALUE_TTL) continue;
      if (!matchValue(key, entry.value, haystack)) continue;

      storeLeak(details.tabId, {
        label: entry.label,
        value: entry.value.length > 20 ? entry.value.slice(0, 8) + "..." + entry.value.slice(-4) : entry.value,
        destination: destHostname,
        url: details.url.length > 120 ? details.url.slice(0, 120) + "..." : details.url,
        ts: now
      });
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

// --- Store leak + update badge ---

function storeLeak(tabId, leak) {
  var key = "tab:" + tabId;

  chrome.storage.session.get(key, function (result) {
    chrome.tabs.get(tabId, function (tab) {
      if (chrome.runtime.lastError || !tab || !tab.url) return;

      var pageHost;
      try { pageHost = new URL(tab.url).hostname.replace(/^www\./, ""); }
      catch (e) { return; }

      var parts = pageHost.split(".");
      var base = parts.length > 2 ? parts.slice(-2).join(".") : pageHost;

      // Same-site filter
      if (leak.destination === base || leak.destination.endsWith("." + base)) return;

      var data = result[key] || { domain: pageHost, leaks: [] };

      // Dedup by label + destination
      for (var i = 0; i < data.leaks.length; i++) {
        if (data.leaks[i].label === leak.label && data.leaks[i].destination === leak.destination) return;
      }

      data.leaks.push(leak);
      data.domain = pageHost;

      var obj = {};
      obj[key] = data;
      chrome.storage.session.set(obj);

      // Count unique labels for badge
      var seen = {};
      for (var j = 0; j < data.leaks.length; j++) seen[data.leaks[j].label] = true;
      chrome.action.setBadgeText({ text: String(Object.keys(seen).length), tabId: tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#e74c3c", tabId: tabId });
    });
  });
}

// --- Cleanup ---

chrome.tabs.onRemoved.addListener(function (tabId) {
  delete tabValues[tabId];
  delete tabRequests[tabId];
  chrome.storage.session.remove("tab:" + tabId);
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === "loading" && changeInfo.url) {
    delete tabValues[tabId];
    delete tabRequests[tabId];
    chrome.storage.session.remove("tab:" + tabId);
    chrome.action.setBadgeText({ text: "", tabId: tabId });
  }
});
