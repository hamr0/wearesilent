"use strict";

// Firefox MV3 uses event pages (not service workers) — no keepalive needed,
// but accept ports from content.js for Chrome-compat content script code.
browser.runtime.onConnect.addListener(function (port) {});

browser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === "getLeaks") {
    browser.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs.length) { sendResponse(null); return; }
      browser.storage.session.get("tab:" + tabs[0].id, function (result) {
        sendResponse(result["tab:" + tabs[0].id] || null);
      });
    });
    return true;
  }

  if (message.type === "leak" && sender.tab) {
    // Same-site filter: skip if destination is on the page's own domain
    var host = message.domain.replace(/^www\./, "");
    var parts = host.split(".");
    var base = parts.length > 2 ? parts.slice(-2).join(".") : host;
    var dest = message.destination;
    if (dest === base || dest.endsWith("." + base)) return;

    var tabId = sender.tab.id;
    var key = "tab:" + tabId;

    browser.storage.session.get(key, function (result) {
      var data = result[key] || { domain: message.domain, leaks: [] };

      // Dedup by label + destination
      for (var i = 0; i < data.leaks.length; i++) {
        if (data.leaks[i].label === message.label && data.leaks[i].destination === message.destination) return;
      }

      data.leaks.push({
        label: message.label,
        value: message.value,
        destination: message.destination,
        url: message.url,
        ts: message.ts
      });
      data.domain = message.domain;

      var obj = {};
      obj[key] = data;
      browser.storage.session.set(obj);

      browser.action.setBadgeText({ text: "!", tabId: tabId });
      browser.action.setBadgeBackgroundColor({ color: "#e74c3c", tabId: tabId });
    });
  }
});

browser.tabs.onRemoved.addListener(function (tabId) {
  browser.storage.session.remove("tab:" + tabId);
});

browser.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === "loading" && changeInfo.url) {
    browser.storage.session.remove("tab:" + tabId);
    browser.action.setBadgeText({ text: "", tabId: tabId });
  }
});
