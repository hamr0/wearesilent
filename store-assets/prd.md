# wearesilent — Product Reference

## Overview
Your form data is being sent before you click submit. This extension shows you where it goes.

A browser extension that detects and displays real-time form input exfiltration — showing exactly which fields are leaked to which third parties before you submit the form.

You haven't clicked submit yet. You're still typing your email into a login form. But a script already read the field, URL-encoded your half-typed address, and fired it to an analytics server in a cross-origin request. This happens on thousands of sites. A [USENIX 2022 study](https://www.usenix.org/conference/usenixsecurity22/presentation/senol) found 2,950 of the top 100,000 websites leak form data before submission — email, passwords, search queries, credit card fields — exfiltrated to third parties while you're still typing.

## How it works

wearesilent uses a dual detection approach:

### Approach B — Confirmed leaks ("Sent without your permission")

1. **Content script listens to `input` and `change` events** — captures form values as you type. Works with all frameworks (React, Vue, Angular, vanilla) because they all fire real DOM events
2. **Resolves field identity via ARIA** — walks the accessibility tree: `aria-labelledby` → `aria-label` → `<label for>` → wrapping `<label>` → `placeholder` → cleaned `name`/`id`
3. **Background uses `webRequest.onBeforeRequest`** to intercept all network requests, extracting URL + request body as a haystack
4. **Bidirectional correlation**: forward matching (request fires → check against known values) + retroactive matching (new value arrives → check against buffered recent requests)
5. **Match found → leak stored** in `storage.session`, badge turns red with count

### Approach A — Tracker awareness ("Active trackers on this page")

1. **Background collects all third-party domains** from `webRequest` into per-tab tracker sets
2. **Content script scans the DOM** for visible form fields (`input`, `textarea`, `select`), reports their ARIA labels to background
3. **Popup resolves hostnames** to known company names using the `KNOWN_COMPANIES` map and filters out unknown/raw hostnames
4. When trackers + form fields are both present but no confirmed leaks yet → amber "!" badge

All processing is local. Same-origin requests are filtered out — only cross-origin exfiltration is flagged.

## Architecture

```
                        APPROACH B (Confirmed Leaks)

User types into <input>          ARIA label resolved           webRequest fires
       │                              │                              │
       ▼                              ▼                              ▼
  input/change event           getAriaLabel() walks:          onBeforeRequest extracts
  fires on document            aria-labelledby →              URL + requestBody as haystack
       │                       aria-label →                          │
       ▼                       <label for> →                         ▼
  content.js sends             wrapping <label> →             Bidirectional matching:
  { value, label }             placeholder →                  Forward: request → check values
  to background.js             name/id fallback               Retroactive: value → check buffered
                                                                     │
                                                                     ▼
                                                              Match? → storeLeak()
                                                              storage.session + red badge


                        APPROACH A (Tracker Awareness)

  webRequest collects                content.js scans              Popup resolves
  all third-party domains            form fields on page           hostnames → company names
       │                                   │                              │
       ▼                                   ▼                              ▼
  tabTrackers[tabId]               reportFields { labels }       KNOWN_COMPANIES map
  per-tab hostname set             sent to background.js          filter unknown → show chips
       │                                   │                              │
       └───────────┬───────────────────────┘                              │
                   ▼                                                      │
       Both present + no leaks?                                           │
       → amber "!" badge                                                  │
```

## Known companies

The popup resolves raw hostnames to recognizable names. Currently tracked:

Google Analytics, Google Ads, Google Tag Manager, Meta, Microsoft Clarity, Hotjar, FullStory, Mouseflow, LogRocket, Crazy Egg, Klaviyo, HubSpot, Mailchimp, Braze, The Trade Desk, Criteo, Taboola, Outbrain, Mixpanel, Amplitude, Segment, Heap, Shopify Analytics, TikTok, ByteDance, Snapchat, Pinterest, LinkedIn, X (Twitter), RudderStack, mParticle, Salesforce, Loqate, Sierra AI, New Relic, DataDome, Forter

Unknown hostnames are silently filtered from the popup — users only see recognized company names.

## Tested on

| Site | Fields detected | Destinations |
|---|---|---|
| Nike.com | First Name, Email, Address | TikTok, Loqate |
| Gap.com | Email | Sierra AI |
| Shein.com | Email Address | Salesforce |
| Test page (localhost) | Email, Password, Search, Name, Phone, Address | Google Analytics, Meta, Hotjar, Klaviyo, TikTok, Shopify |

## Project structure

```
chrome-extension/
  manifest.json        MV3 manifest (service_worker background)
  background.js        webRequest listener, value correlation, tracker tracking, storage.session
  content.js           ISOLATED world: input/change listeners, ARIA labels, field scanning
  popup.html/js/css    Dark-themed popup: two-section layout, company resolution, tracker chips

firefox-extension/
  manifest.json        MV3 manifest (background scripts, gecko settings, min Firefox 115)
  background.js        Same as Chrome but storage.session for ALL popup data (survives suspension)
  content.js           Same as Chrome but browser.* APIs + injected.js script injection
  injected.js          MAIN world: wraps fetch/XHR/sendBeacon to capture request bodies
  popup.html/js/css    Identical to Chrome but browser.* Promise-style APIs

test-page/             Local test page simulating 6 tracker types
```

## Chrome vs Firefox differences

| Aspect | Chrome | Firefox |
|---|---|---|
| Background | Service worker (stays alive via webRequest) | Event page (suspends after idle) |
| Request body access | `webRequest.onBeforeRequest` provides `requestBody` natively | `requestBody` unreliable for sendBeacon/some fetch — supplemented by `injected.js` |
| Data persistence | `tabTrackers`/`tabFields` in-memory, leaks in `storage.session` | ALL popup data in `storage.session` (survives background suspension) |
| Body capture | Not needed | `injected.js` wraps `fetch`/`XHR`/`sendBeacon` in page context, dispatches `CustomEvent` |
| APIs | `chrome.*` callback-style | `browser.*` Promise-style |
| Manifest | `"service_worker": "background.js"` | `"scripts": ["background.js"]` + `web_accessible_resources` + gecko ID |
| Tracker blocking | None | Firefox ETP may block some trackers → different results (expected) |

## Key design decisions

| Decision | Why |
|---|---|
| `webRequest` API instead of prototype wrapping | Wrapping `fetch`/`XHR` in MAIN world breaks pages (Promise return values can't cross Xray boundary in Firefox). `webRequest` is reliable and non-invasive. |
| `input` events instead of `.value` getter wrapping | React, Vue, Angular maintain internal state and don't always trigger prototype getters. DOM `input` events fire reliably across all frameworks. |
| ARIA labels instead of `el.name \|\| el.id` | Real sites have auto-generated IDs (`input_3`, `field-abc123`). ARIA labels give human-readable names ("Email Address", "Phone Number") because sites need them for accessibility. |
| Bidirectional matching | Forward matching misses values typed before the request. Retroactive matching (buffered requests checked when new values arrive) catches these cases. |
| Known companies only in popup | Raw hostnames like `otlp-http-production.shopifysvc.com` mean nothing to users. Mapping to "Shopify Analytics" makes leaks understandable. Unknown hostnames are filtered out. |
| Two independent sections | Confirmed leaks (red) and tracker awareness (amber) serve different purposes. Showing both gives users the full picture without conflating detection with confirmation. |
| Same-site filter in background.js | Requests to the site's own domain aren't leaks. Filtering in background keeps badge and popup accurate. |
| `storage.session` for leak data | Survives service worker suspension (Chrome) and background page suspension (Firefox). Automatically cleared when browser closes. |
| Firefox `injected.js` supplement | Firefox `webRequest` doesn't reliably provide `requestBody.raw` for `sendBeacon`/some `fetch`. Injected script captures bodies in page context and relays via `CustomEvent`. |

## Permissions

| Permission | Why |
|---|---|
| `storage` | `storage.session` stores per-tab leak data, tracker lists, and field labels for badge and popup |
| `webRequest` | Intercepts all network requests to extract URLs and request bodies for value correlation and tracker tracking |
| `host_permissions: <all_urls>` | Content scripts must inject into every page; webRequest must monitor all origins |
| `web_accessible_resources` (Firefox only) | `injected.js` must be loadable from page context to capture request bodies |

## Research

- [Leaky Forms: A Study of Email and Password Exfiltration Before Form Submission (USENIX Security 2022)](https://www.usenix.org/conference/usenixsecurity22/presentation/senol)
- [LeakInspector — KU Leuven proof-of-concept (MV2, discontinued)](https://github.com/leaky-forms/leak-inspector)
- [No Boundaries: Exfiltration of Personal Data by Session Replay Scripts (Princeton 2017)](https://privacyinternational.org/examples/1918/no-boundaries-exfiltration-personal-data-session-replay-scripts)
