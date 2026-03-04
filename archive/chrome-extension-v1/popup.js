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
  "srmdata.com": "Salesforce"
};

var KNOWN_FIELDS = {
  "ss": "search",
  "q": "search",
  "query": "search",
  "search": "search",
  "search_query": "search",
  "s": "search",
  "email": "email",
  "mail": "email",
  "user_email": "email",
  "login_email": "email",
  "signup_email": "email",
  "username": "username",
  "user": "username",
  "login": "username",
  "userid": "username",
  "passwd": "password",
  "pass": "password",
  "password": "password",
  "pwd": "password",
  "phone": "phone number",
  "tel": "phone number",
  "mobile": "phone number",
  "phone_number": "phone number",
  "fname": "first name",
  "first_name": "first name",
  "firstname": "first name",
  "lname": "last name",
  "last_name": "last name",
  "lastname": "last name",
  "name": "name",
  "fullname": "name",
  "full_name": "name",
  "addr": "address",
  "address": "address",
  "street": "address",
  "zip": "zip code",
  "zipcode": "zip code",
  "postal": "postal code",
  "city": "city",
  "cc": "credit card",
  "cardnumber": "card number",
  "card_number": "card number",
  "cvv": "CVV",
  "cvc": "CVC"
};

function isKnownField(raw) {
  var lower = raw.toLowerCase();
  if (KNOWN_FIELDS[lower]) return true;
  // Handle bracket notation: contact[email], customer[email]
  var bracket = lower.match(/\[(\w+)\]/);
  if (bracket && KNOWN_FIELDS[bracket[1]]) return true;
  // Handle dot notation: address.email, user.name
  var dot = lower.match(/\.(\w+)$/);
  if (dot && KNOWN_FIELDS[dot[1]]) return true;
  return false;
}

function humanizeField(raw) {
  var lower = raw.toLowerCase();
  if (KNOWN_FIELDS[lower]) return KNOWN_FIELDS[lower];
  // Handle bracket notation like contact[email], customer[email]
  var bracket = lower.match(/\[(\w+)\]/);
  if (bracket && KNOWN_FIELDS[bracket[1]]) return KNOWN_FIELDS[bracket[1]];
  // Handle dot notation like address.email, user.name
  var dot = lower.match(/\.(\w+)$/);
  if (dot && KNOWN_FIELDS[dot[1]]) return KNOWN_FIELDS[dot[1]];
  // Check input type fallbacks (from getFieldName: name || id || type || "input")
  if (lower === "text") return "text input";
  if (lower === "tel") return "phone number";
  if (lower === "url") return "URL";
  if (lower === "input") return "input";
  // Clean up underscores/dashes for display
  return raw.replace(/[_-]/g, " ");
}

function resolveCompany(hostname) {
  if (KNOWN_COMPANIES[hostname]) return KNOWN_COMPANIES[hostname];
  // Strip subdomains and check again (e.g. otlp-http-production.shopifysvc.com → shopifysvc.com)
  var parts = hostname.split(".");
  while (parts.length > 2) {
    parts.shift();
    var shorter = parts.join(".");
    if (KNOWN_COMPANIES[shorter]) return KNOWN_COMPANIES[shorter];
  }
  // Google country domains (google.nl, google.co.uk, etc.)
  var bare = hostname.replace(/^www\./, "");
  if (/^google\.(com?\.)?\w{2,3}$/.test(bare)) return "Google";
  return hostname;
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

  if (!data || data.leaks.length === 0) {
    cleanEl.classList.remove("hidden");
    return;
  }

  var domain = data.domain.replace(/^www\./, "");

  // Skip unnamed fields (fallback names from getFieldName mean no real field identity)
  var leaks = [];
  for (var f = 0; f < data.leaks.length; f++) {
    var lk = data.leaks[f];
    var fn = lk.field.toLowerCase();
    if (fn === "textarea" || fn === "input" || fn === "text") continue;
    leaks.push(lk);
  }

  if (leaks.length === 0) {
    cleanEl.classList.remove("hidden");
    return;
  }

  // Summary card
  var summary = el("div", "summary");
  var domainEl = el("div", "summary-domain");
  domainEl.textContent = domain;
  summary.appendChild(domainEl);

  var countEl = el("div", "summary-count");
  countEl.textContent = leaks.length;
  summary.appendChild(countEl);

  var labelEl = el("div", "summary-label");
  labelEl.textContent = leaks.length === 1
    ? "field sent before you submit"
    : "fields sent before you submit";
  summary.appendChild(labelEl);

  leaksEl.appendChild(summary);

  // Leak list
  var heading = el("div", "leak-heading");
  heading.textContent = "Sent without your permission";
  leaksEl.appendChild(heading);

  // Group leaks by field name
  var grouped = {};
  var groupOrder = [];
  for (var i = 0; i < leaks.length; i++) {
    var leak = leaks[i];
    var fieldKey = humanizeField(leak.field);
    if (!grouped[fieldKey]) {
      grouped[fieldKey] = { value: leak.value, destinations: [] };
      groupOrder.push(fieldKey);
    }
    var company = resolveCompany(leak.destination);
    if (grouped[fieldKey].destinations.indexOf(company) === -1) {
      grouped[fieldKey].destinations.push(company);
    }
  }

  for (var g = 0; g < groupOrder.length; g++) {
    var key = groupOrder[g];
    var group = grouped[key];
    var row = el("div", "leak-row");

    var fieldEl = el("div", "leak-field");
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
