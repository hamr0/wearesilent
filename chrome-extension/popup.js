"use strict";

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

  // Summary card
  var summary = el("div", "summary");
  var domainEl = el("div", "summary-domain");
  domainEl.textContent = domain;
  summary.appendChild(domainEl);

  var countEl = el("div", "summary-count");
  countEl.textContent = data.leaks.length;
  summary.appendChild(countEl);

  var labelEl = el("div", "summary-label");
  labelEl.textContent = data.leaks.length === 1 ? "leak detected" : "leaks detected";
  summary.appendChild(labelEl);

  leaksEl.appendChild(summary);

  // Leak list
  var heading = el("div", "leak-heading");
  heading.textContent = "Exfiltrated fields";
  leaksEl.appendChild(heading);

  for (var i = 0; i < data.leaks.length; i++) {
    var leak = data.leaks[i];
    var row = el("div", "leak-row");

    var fieldEl = el("span", "leak-field");
    fieldEl.textContent = leak.field;
    row.appendChild(fieldEl);

    var arrow = el("span", "leak-arrow");
    arrow.textContent = " → ";
    row.appendChild(arrow);

    var destEl = el("span", "leak-dest");
    destEl.textContent = leak.destination;
    row.appendChild(destEl);

    if (leak.value) {
      var valEl = el("span", "leak-value");
      valEl.textContent = leak.value;
      row.appendChild(valEl);
    }

    leaksEl.appendChild(row);
  }
}

function el(tag, className) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
