"use strict";

// Per-tab tracked values (in-memory, hot path only): { tabId: { "valueKey": { label, value, ts } } }
var tabValues = {};

// Per-tab buffered requests (in-memory, hot path only): { tabId: [ { url, haystack, destHostname, ts } ] }
var tabRequests = {};

// Map domains to parent entity for same-party filtering
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

// --- storage.session helpers for persistent popup data ---

function getTabData(tabId, cb) {
  browser.storage.session.get("tab:" + tabId).then(function (result) {
    cb(result["tab:" + tabId] || null);
  }).catch(function () { cb(null); });
}

function setTabData(tabId, data) {
  var obj = {};
  obj["tab:" + tabId] = data;
  browser.storage.session.set(obj);
}

function removeTabData(tabId) {
  browser.storage.session.remove("tab:" + tabId);
}

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

browser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
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

  // Handle captured request bodies from injected.js (supplementary to webRequest)
  if (message.type === "capturedRequest" && sender.tab) {
    var tabId = sender.tab.id;
    var values = tabValues[tabId];
    if (!values) return;

    var destHostname;
    try { destHostname = new URL(message.url).hostname; }
    catch (e) { return; }

    var haystack = (message.url + " " + message.body).toLowerCase();
    var now = Date.now();

    // Buffer for retroactive matching (same as webRequest buffer)
    if (!tabRequests[tabId]) tabRequests[tabId] = [];
    tabRequests[tabId].push({ url: message.url, haystack: haystack, destHostname: destHostname, ts: now });

    for (var vk in values) {
      var ve = values[vk];
      if (now - ve.ts > VALUE_TTL) continue;
      if (!matchValue(vk, ve.value, haystack)) continue;

      storeLeak(tabId, {
        label: ve.label,
        value: ve.value.length > 20 ? ve.value.slice(0, 8) + "..." + ve.value.slice(-4) : ve.value,
        destination: destHostname,
        url: message.url.length > 120 ? message.url.slice(0, 120) + "..." : message.url,
        ts: now
      });
    }
    return;
  }

  // Store form field labels reported by content script
  if (message.type === "reportFields" && sender.tab) {
    var tabId = sender.tab.id;
    var pageHost;
    try { pageHost = sender.tab.url ? new URL(sender.tab.url).hostname : ""; } catch (e) { pageHost = ""; }
    getTabData(tabId, function (data) {
      if (!data) data = { domain: "", leaks: [], trackers: [], fields: [] };
      data.fields = message.fields;
      setTabData(tabId, data);
      // Show detect badge if third-party trackers present but no leaks yet
      if (message.fields.length > 0 && data.trackers && data.trackers.length > 0 && (!data.leaks || data.leaks.length === 0)) {
        var hasKnownThirdParty = data.trackers.some(function (h) {
          return isKnownTracker(h) && !isSameParty(h, pageHost);
        });
        if (hasKnownThirdParty) updateDetectBadge(tabId);
      }
    });
    return;
  }

  if (message.type === "getPageData") {
    return browser.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      if (!tabs.length) return null;
      var tid = tabs[0].id;

      var pageHost = "";
      if (tabs[0].url) {
        try { pageHost = new URL(tabs[0].url).hostname.replace(/^www\./, ""); }
        catch (e) {}
      }

      return browser.storage.session.get("tab:" + tid).then(function (result) {
        var tabData = result["tab:" + tid];
        if (!tabData) return { leaks: null, trackers: [], fields: [], domain: pageHost };

        // Filter trackers: remove same-party (same entity)
        var thirdParty = (tabData.trackers || []).filter(function (h) {
          return !isSameParty(h, pageHost);
        });

        var leakData = (tabData.leaks && tabData.leaks.length > 0)
          ? { domain: tabData.domain || pageHost, leaks: tabData.leaks }
          : null;

        return {
          leaks: leakData,
          trackers: thirdParty,
          fields: tabData.fields || [],
          domain: pageHost
        };
      });
    });
  }
});

// --- Monitor ALL cross-origin requests via webRequest ---

browser.webRequest.onBeforeRequest.addListener(
  function (details) {
    if (details.tabId < 0) return;

    var destHostname;
    try { destHostname = new URL(details.url).hostname; }
    catch (e) { return; }

    // Track third-party domains for Approach A (tracker awareness) — persist to storage.session
    var tid = details.tabId;
    getTabData(tid, function (data) {
      if (!data) data = { domain: "", leaks: [], trackers: [], fields: [] };
      if (!data.trackers) data.trackers = [];
      if (data.trackers.indexOf(destHostname) === -1) {
        data.trackers.push(destHostname);
        setTabData(tid, data);
        // Show detect badge only for known trackers that are third-party
        if (isKnownTracker(destHostname) && data.fields && data.fields.length > 0 && (!data.leaks || data.leaks.length === 0)) {
          browser.tabs.get(tid).then(function (tab) {
            if (!tab || !tab.url) return;
            var pageHost;
            try { pageHost = new URL(tab.url).hostname; } catch (e) { return; }
            if (!isSameParty(destHostname, pageHost)) {
              updateDetectBadge(tid);
            }
          }).catch(function () {});
        }
      }
    });

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
  browser.action.setBadgeText({ text: "!", tabId: tabId });
  browser.action.setBadgeBackgroundColor({ color: "#f0a030", tabId: tabId });
}

// --- Store leak + update badge ---

function storeLeak(tabId, leak) {
  browser.tabs.get(tabId).then(function (tab) {
    if (!tab || !tab.url) return;

    var pageHost;
    try { pageHost = new URL(tab.url).hostname.replace(/^www\./, ""); }
    catch (e) { return; }

    // Same-party filter (same entity = not a leak)
    if (isSameParty(leak.destination, pageHost)) return;

    getTabData(tabId, function (data) {
      if (!data) data = { domain: pageHost, leaks: [], trackers: [], fields: [] };
      if (!data.leaks) data.leaks = [];

      // Dedup by label + destination
      for (var i = 0; i < data.leaks.length; i++) {
        if (data.leaks[i].label === leak.label && data.leaks[i].destination === leak.destination) return;
      }

      data.leaks.push(leak);
      data.domain = pageHost;
      setTabData(tabId, data);

      // Count unique labels for badge
      var seen = {};
      for (var j = 0; j < data.leaks.length; j++) seen[data.leaks[j].label] = true;
      browser.action.setBadgeText({ text: String(Object.keys(seen).length), tabId: tabId });
      browser.action.setBadgeBackgroundColor({ color: "#e74c3c", tabId: tabId });
    });
  }).catch(function () {});
}

// --- Cleanup ---

browser.tabs.onRemoved.addListener(function (tabId) {
  delete tabValues[tabId];
  delete tabRequests[tabId];
  removeTabData(tabId);
});

browser.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === "loading" && changeInfo.url) {
    delete tabValues[tabId];
    delete tabRequests[tabId];
    removeTabData(tabId);
    browser.action.setBadgeText({ text: "", tabId: tabId });
  }
});
