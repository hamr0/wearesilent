"use strict";

var KNOWN_COMPANIES = {
  "google-analytics.com": "Google Analytics",
  "googleads.g.doubleclick.net": "Google Ads",
  "googletagmanager.com": "Google Tag Manager",
  "google.com": "Google",
  "doubleclick.net": "Google Ads",
  "facebook.com": "Meta",
  "facebook.net": "Meta",
  "connect.facebook.net": "Meta",
  "clarity.ms": "Microsoft Clarity",
  "bing.com": "Microsoft",
  "hotjar.com": "Hotjar",
  "fullstory.com": "FullStory",
  "mouseflow.com": "Mouseflow",
  "logrocket.com": "LogRocket",
  "crazyegg.com": "Crazy Egg",
  "klaviyo.com": "Klaviyo",
  "hubspot.com": "HubSpot",
  "mailchimp.com": "Mailchimp",
  "braze.com": "Braze",
  "adsrvr.org": "The Trade Desk",
  "criteo.com": "Criteo",
  "criteo.net": "Criteo",
  "taboola.com": "Taboola",
  "outbrain.com": "Outbrain",
  "mixpanel.com": "Mixpanel",
  "amplitude.com": "Amplitude",
  "segment.io": "Segment",
  "segment.com": "Segment",
  "heap.io": "Heap",
  "shopifysvc.com": "Shopify Analytics",
  "shopify.com": "Shopify",
  "tiktok.com": "TikTok",
  "bytedance.com": "ByteDance",
  "snap.com": "Snapchat",
  "snapchat.com": "Snapchat",
  "pinterest.com": "Pinterest",
  "linkedin.com": "LinkedIn",
  "twitter.com": "X (Twitter)",
  "x.com": "X (Twitter)",
  "rudderlabs.com": "RudderStack",
  "mparticle.com": "mParticle",
  "googleadservices.com": "Google Ads",
  "googlesyndication.com": "Google Ads",
  "srmdata-eur.com": "Salesforce",
  "srmdata.com": "Salesforce",
  "addressy.com": "Loqate",
  "loqate.com": "Loqate",
  "sierra.chat": "Sierra AI",
  "nr-data.net": "New Relic",
  "newrelic.com": "New Relic",
  "datadome.co": "DataDome",
  "forter.com": "Forter",
  "cdn4.forter.com": "Forter"
};

function resolveCompany(hostname) {
  if (KNOWN_COMPANIES[hostname]) return KNOWN_COMPANIES[hostname];
  var parts = hostname.split(".");
  while (parts.length > 2) {
    parts.shift();
    if (KNOWN_COMPANIES[parts.join(".")]) return KNOWN_COMPANIES[parts.join(".")];
  }
  if (/^google\.(com?\.)?\w{2,3}$/.test(hostname.replace(/^www\./, ""))) return "Google";
  return hostname;
}

// Strip trailing punctuation and whitespace from ARIA labels
function cleanLabel(raw) {
  return raw.replace(/[\s*:]+$/g, "").replace(/^\s+/, "");
}

document.addEventListener("DOMContentLoaded", function () {
  browser.runtime.sendMessage({ type: "getPageData" }).then(function (data) {
    render(data);
  }).catch(function () {
    render(null);
  });
});

function render(data) {
  var leaksEl = document.getElementById("leaks");
  var detectEl = document.getElementById("detected");
  var cleanEl = document.getElementById("clean");
  var loadingEl = document.getElementById("loading");

  loadingEl.classList.add("hidden");

  if (!data) {
    cleanEl.classList.remove("hidden");
    return;
  }

  var domain = (data.domain || "").replace(/^www\./, "");
  var hasLeaks = data.leaks && data.leaks.leaks && data.leaks.leaks.length > 0;

  // Resolve tracker hostnames to known company names only, dedup
  var trackerNames = {};
  var trackers = data.trackers || [];
  for (var t = 0; t < trackers.length; t++) {
    var name = resolveCompany(trackers[t]);
    if (name !== trackers[t]) trackerNames[name] = true; // skip unknown hostnames
  }
  var uniqueTrackers = Object.keys(trackerNames).sort();
  var hasTrackers = uniqueTrackers.length > 0;
  var hasFields = data.fields && data.fields.length > 0;

  if (!hasLeaks && !hasTrackers) {
    cleanEl.classList.remove("hidden");
    return;
  }

  // --- Section 1: Sent (Approach B) ---
  if (hasLeaks) {
    leaksEl.classList.remove("hidden");

    var leakData = data.leaks;

    // Group by cleaned label
    var grouped = {};
    var order = [];
    for (var i = 0; i < leakData.leaks.length; i++) {
      var leak = leakData.leaks[i];
      var label = cleanLabel(leak.label);
      if (!grouped[label]) {
        grouped[label] = { value: leak.value, destinations: [] };
        order.push(label);
      }
      var company = resolveCompany(leak.destination);
      if (grouped[label].destinations.indexOf(company) === -1) {
        grouped[label].destinations.push(company);
      }
    }

    // Summary card
    var summary = el("div", "summary");

    var domainEl = el("div", "summary-domain");
    domainEl.textContent = domain;
    summary.appendChild(domainEl);

    var countEl = el("div", "summary-count");
    countEl.textContent = order.length;
    summary.appendChild(countEl);

    var labelEl = el("div", "summary-label");
    labelEl.textContent = order.length === 1
      ? "field sent before you submit"
      : "fields sent before you submit";
    summary.appendChild(labelEl);

    leaksEl.appendChild(summary);

    // Heading with count
    var heading = el("div", "leak-heading");
    var headingText = el("span", "");
    headingText.textContent = "Sent without your permission";
    var headingCount = el("span", "heading-count");
    headingCount.textContent = order.length;
    heading.appendChild(headingText);
    heading.appendChild(headingCount);
    leaksEl.appendChild(heading);

    // Rows
    for (var g = 0; g < order.length; g++) {
      var key = order[g];
      var group = grouped[key];
      var row = el("div", "leak-row");

      var fieldEl = el("div", "leak-label");
      fieldEl.textContent = "Your " + key;
      row.appendChild(fieldEl);

      if (group.value) {
        var valEl = el("div", "leak-value");
        valEl.textContent = '"' + group.value + '"';
        row.appendChild(valEl);
      }

      var destEl = el("div", "leak-dest");
      var arrow = document.createTextNode("\u2192 ");
      destEl.appendChild(arrow);
      for (var d = 0; d < group.destinations.length; d++) {
        var destChip = el("span", "tracker-chip");
        destChip.textContent = group.destinations[d];
        destEl.appendChild(destChip);
      }
      row.appendChild(destEl);

      leaksEl.appendChild(row);
    }
  }

  // --- Section 2: Detected (Approach A) ---
  if (hasTrackers && hasFields) {
    detectEl.classList.remove("hidden");

    var detectHeading = el("div", "detect-heading");
    var detectText = el("span", "");
    detectText.textContent = "Active trackers on this page";
    var detectCount = el("span", "heading-count");
    detectCount.textContent = uniqueTrackers.length;
    detectHeading.appendChild(detectText);
    detectHeading.appendChild(detectCount);
    detectEl.appendChild(detectHeading);

    // Tracker list
    var trackerList = el("div", "tracker-list");
    for (var j = 0; j < uniqueTrackers.length; j++) {
      var chip = el("span", "tracker-chip");
      chip.textContent = uniqueTrackers[j];
      trackerList.appendChild(chip);
    }
    detectEl.appendChild(trackerList);

    var warnEl = el("div", "detect-warn");
    warnEl.textContent = "Active while you enter data";
    detectEl.appendChild(warnEl);
  }

  // If only trackers but no leaks and no fields, show tracker count
  if (hasTrackers && !hasFields && !hasLeaks) {
    detectEl.classList.remove("hidden");
    var onlyTrackers = el("div", "detect-heading");
    onlyTrackers.textContent = uniqueTrackers.length + " trackers detected";
    detectEl.appendChild(onlyTrackers);

    var tList = el("div", "tracker-list");
    for (var k = 0; k < uniqueTrackers.length; k++) {
      var c = el("span", "tracker-chip");
      c.textContent = uniqueTrackers[k];
      tList.appendChild(c);
    }
    detectEl.appendChild(tList);
  }
}

function el(tag, className) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
