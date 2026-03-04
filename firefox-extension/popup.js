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
  "sierra.chat": "Sierra AI"
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
  chrome.runtime.sendMessage({ type: "getLeaks" }, function (data) {
    render(data);
  });
});

function render(data) {
  var leaksEl = document.getElementById("leaks");
  var cleanEl = document.getElementById("clean");
  var loadingEl = document.getElementById("loading");

  loadingEl.classList.add("hidden");

  if (!data || !data.leaks || data.leaks.length === 0) {
    cleanEl.classList.remove("hidden");
    return;
  }

  leaksEl.classList.remove("hidden");

  var domain = data.domain.replace(/^www\./, "");

  // Group by cleaned label
  var grouped = {};
  var order = [];
  for (var i = 0; i < data.leaks.length; i++) {
    var leak = data.leaks[i];
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

  // Summary card (centered)
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

  // Heading
  var heading = el("div", "leak-heading");
  heading.textContent = "Sent without your permission";
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
    destEl.textContent = "\u2192 " + group.destinations.join(", ");
    row.appendChild(destEl);

    leaksEl.appendChild(row);
  }
}

function el(tag, className) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
