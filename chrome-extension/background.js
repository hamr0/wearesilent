"use strict";

// Per-tab tracked values: { tabId: { "valueKey": { label, value, ts } } }
var tabValues = {};

// Per-tab buffered requests: { tabId: [ { url, haystack, destHostname, ts } ] }
var tabRequests = {};

// Per-tab detected third-party tracker domains: { tabId: { hostname: true } }
var tabTrackers = {};

// Per-tab form field labels from content script: { tabId: [label, ...] }
var tabFields = {};

// Map domains to parent entity for same-party filtering
// Domains owned by the same company are not third-party leaks
var DOMAIN_ENTITY = {
  "google.com": "google", "google-analytics.com": "google", "googletagmanager.com": "google",
  "doubleclick.net": "google", "googleadservices.com": "google", "googlesyndication.com": "google",
  "gstatic.com": "google", "googleapis.com": "google", "youtube.com": "google",
  "googleusercontent.com": "google", "googlevideo.com": "google", "1e100.net": "google",
  "gvt1.com": "google", "gvt2.com": "google", "ggpht.com": "google", "recaptcha.net": "google",
  "withgoogle.com": "google", "chromium.org": "google", "android.com": "google",
  "google.co.uk": "google", "google.ca": "google", "google.de": "google",
  "google.fr": "google", "google.co.jp": "google", "google.com.au": "google",
  "google.co.in": "google", "google.com.br": "google", "google.it": "google",
  "google.es": "google", "google.nl": "google", "google.pl": "google",
  "facebook.com": "meta", "facebook.net": "meta", "instagram.com": "meta", "fbcdn.net": "meta",
  "microsoft.com": "microsoft", "bing.com": "microsoft", "clarity.ms": "microsoft",
  "linkedin.com": "microsoft", "live.com": "microsoft", "msn.com": "microsoft",
  "tiktok.com": "bytedance", "bytedance.com": "bytedance",
  "twitter.com": "x", "x.com": "x", "twimg.com": "x",
  "shopify.com": "shopify", "shopifysvc.com": "shopify", "myshopify.com": "shopify",
  "yahoo.com": "yahoo", "aol.com": "yahoo",
  "amazon.com": "amazon", "amazonaws.com": "amazon", "cloudfront.net": "amazon"
};

function getEntity(hostname) {
  var h = hostname.replace(/^www\./, "");
  if (DOMAIN_ENTITY[h]) return DOMAIN_ENTITY[h];
  var parts = h.split(".");
  while (parts.length > 2) {
    parts.shift();
    if (DOMAIN_ENTITY[parts.join(".")]) return DOMAIN_ENTITY[parts.join(".")];
  }
  // Google country TLDs (google.co.xx, google.xx, google.com.xx)
  var base = parts.length >= 2 ? parts.join(".") : h;
  if (/^google\.\w{2,3}$/.test(base) || /^google\.co\.\w{2,3}$/.test(base) || /^google\.com\.\w{2,3}$/.test(base)) return "google";
  // Fallback: treat base domain as its own entity
  return base;
}

function isSameParty(hostA, hostB) {
  return getEntity(hostA) === getEntity(hostB);
}

// Known tracker domains — only these trigger the detect "!" badge
// Must stay in sync with KNOWN_COMPANIES in popup.js
var KNOWN_TRACKER_DOMAINS = [
  "google-analytics.com", "googleads.g.doubleclick.net", "googletagmanager.com",
  "doubleclick.net", "googleadservices.com", "googlesyndication.com",
  "facebook.com", "facebook.net", "connect.facebook.net",
  "clarity.ms", "bing.com", "hotjar.com", "fullstory.com", "mouseflow.com",
  "logrocket.com", "crazyegg.com", "klaviyo.com", "hubspot.com", "mailchimp.com",
  "braze.com", "adsrvr.org", "criteo.com", "criteo.net", "taboola.com", "outbrain.com",
  "mixpanel.com", "amplitude.com", "segment.io", "segment.com", "heap.io",
  "shopifysvc.com", "shopify.com", "tiktok.com", "bytedance.com",
  "snap.com", "snapchat.com", "pinterest.com", "linkedin.com",
  "twitter.com", "x.com", "rudderlabs.com", "mparticle.com",
  "srmdata-eur.com", "srmdata.com", "addressy.com", "loqate.com",
  "sierra.chat", "nr-data.net", "newrelic.com", "datadome.co", "forter.com"
];

function isKnownTracker(hostname) {
  var h = hostname.replace(/^www\./, "").toLowerCase();
  for (var i = 0; i < KNOWN_TRACKER_DOMAINS.length; i++) {
    if (h === KNOWN_TRACKER_DOMAINS[i] || h.endsWith("." + KNOWN_TRACKER_DOMAINS[i])) return true;
  }
  return false;
}

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

  // Store form field labels reported by content script
  if (message.type === "reportFields" && sender.tab) {
    var tabId = sender.tab.id;
    tabFields[tabId] = message.fields;
    // Show detect badge if third-party trackers present but no leaks yet
    if (message.fields.length > 0 && tabTrackers[tabId] && sender.tab.url) {
      var pageHost;
      try { pageHost = new URL(sender.tab.url).hostname; } catch (e) { return; }
      var hasKnownThirdParty = Object.keys(tabTrackers[tabId]).some(function (h) {
        return isKnownTracker(h) && !isSameParty(h, pageHost);
      });
      if (hasKnownThirdParty) {
        chrome.storage.session.get("tab:" + tabId, function (result) {
          if (!result["tab:" + tabId]) {
            updateDetectBadge(tabId);
          }
        });
      }
    }
    return;
  }

  if (message.type === "getPageData") {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs.length) { sendResponse(null); return; }
      var tid = tabs[0].id;
      var trackerHosts = tabTrackers[tid] ? Object.keys(tabTrackers[tid]) : [];
      var fields = tabFields[tid] || [];

      // Filter trackers: remove same-party (same entity)
      var pageHost = "";
      if (tabs[0].url) {
        try { pageHost = new URL(tabs[0].url).hostname.replace(/^www\./, ""); }
        catch (e) {}
      }

      var thirdParty = trackerHosts.filter(function (h) {
        return !isSameParty(h, pageHost);
      });

      chrome.storage.session.get("tab:" + tid, function (result) {
        sendResponse({
          leaks: result["tab:" + tid] || null,
          trackers: thirdParty,
          fields: fields,
          domain: pageHost
        });
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

    // Track third-party domains for Approach A (tracker awareness)
    if (!tabTrackers[details.tabId]) tabTrackers[details.tabId] = {};
    if (!tabTrackers[details.tabId][destHostname]) {
      tabTrackers[details.tabId][destHostname] = true;
      // Show detect badge only for known trackers that are third-party
      if (isKnownTracker(destHostname) && tabFields[details.tabId] && tabFields[details.tabId].length > 0) {
        var tid = details.tabId;
        chrome.tabs.get(tid, function (tab) {
          if (chrome.runtime.lastError || !tab || !tab.url) return;
          var pageHost;
          try { pageHost = new URL(tab.url).hostname; } catch (e) { return; }
          if (isSameParty(destHostname, pageHost)) return;
          chrome.storage.session.get("tab:" + tid, function (result) {
            if (!result["tab:" + tid]) {
              updateDetectBadge(tid);
            }
          });
        });
      }
    }

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

// --- Detect badge (Approach A: trackers + fields, no confirmed leaks) ---

function updateDetectBadge(tabId) {
  chrome.action.setBadgeText({ text: "!", tabId: tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#f0a030", tabId: tabId });
}

// --- Store leak + update badge ---

function storeLeak(tabId, leak) {
  var key = "tab:" + tabId;

  chrome.storage.session.get(key, function (result) {
    chrome.tabs.get(tabId, function (tab) {
      if (chrome.runtime.lastError || !tab || !tab.url) return;

      var pageHost;
      try { pageHost = new URL(tab.url).hostname.replace(/^www\./, ""); }
      catch (e) { return; }

      // Same-party filter (same entity = not a leak)
      if (isSameParty(leak.destination, pageHost)) return;

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
  delete tabTrackers[tabId];
  delete tabFields[tabId];
  chrome.storage.session.remove("tab:" + tabId);
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === "loading" && changeInfo.url) {
    delete tabValues[tabId];
    delete tabRequests[tabId];
    delete tabTrackers[tabId];
    delete tabFields[tabId];
    chrome.storage.session.remove("tab:" + tabId);
    chrome.action.setBadgeText({ text: "", tabId: tabId });
  }
});
