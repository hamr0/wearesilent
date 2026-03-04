"use strict";

// Per-tab leak data: { tabId: { domain, leaks: [{field, value, destination, url, ts}] } }

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === "getLeaks") {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs.length === 0) { sendResponse(null); return; }
      var tid = tabs[0].id;
      chrome.storage.session.get("tab:" + tid, function (result) {
        sendResponse(result["tab:" + tid] || null);
      });
    });
    return true;
  }

  if (message.type === "leak" && sender.tab) {
    var tabId = sender.tab.id;
    var key = "tab:" + tabId;

    chrome.storage.session.get(key, function (result) {
      var data = result[key] || { domain: message.domain, leaks: [] };

      // Dedup
      for (var i = 0; i < data.leaks.length; i++) {
        if (data.leaks[i].field === message.field && data.leaks[i].destination === message.destination) {
          return; // Already recorded
        }
      }

      data.leaks.push({
        field: message.field,
        value: message.value,
        destination: message.destination,
        url: message.url,
        ts: message.ts
      });
      data.domain = message.domain;

      var obj = {};
      obj[key] = data;
      chrome.storage.session.set(obj);

      // Update badge
      var count = data.leaks.length;
      chrome.action.setBadgeText({ text: String(count), tabId: tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#e74c3c", tabId: tabId });
    });
  }
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  chrome.storage.session.remove("tab:" + tabId);
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === "loading") {
    chrome.storage.session.remove("tab:" + tabId);
    chrome.action.setBadgeText({ text: "", tabId: tabId });
  }
});
