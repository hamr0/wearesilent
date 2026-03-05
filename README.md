# wearesilent

> Your form data is being sent before you click submit. This extension shows you where it goes.

**One-liner:** A browser extension that detects and displays real-time form input exfiltration — showing exactly which fields are leaked to which third parties before you submit the form.

---

**You haven't clicked submit yet.** You're still typing your email into a login form. But a script already read the field, URL-encoded your half-typed address, and fired it to an analytics server in a cross-origin request. This happens on thousands of sites. A [USENIX 2022 study](https://www.usenix.org/conference/usenixsecurity22/presentation/senol) found 2,950 of the top 100,000 websites leak form data before submission — email, passwords, search queries, credit card fields — exfiltrated to third parties while you're still typing.

wearesilent makes this visible. No cloud. No AI. No data leaves your browser. Everything runs locally as a lightweight extension.

Part of the **weare____** privacy tool series.

## What it looks like

The popup has two independent sections:

**Sent without your permission** (red) — confirmed leaks where your typed values were found inside cross-origin network requests:

```
nike.com
         1
field sent before you submit

SENT WITHOUT YOUR PERMISSION                    1
┌──────────────────────────────────────────────┐
│ Your Start typing address                    │
│ "hwrhh"                                      │
│ → [Loqate]                                   │
└──────────────────────────────────────────────┘

ACTIVE TRACKERS ON THIS PAGE                    3
[Forter]  [Loqate]  [New Relic]
Active while you enter data
```

**Active trackers on this page** (amber) — known third-party tracker companies detected making requests while form fields are present on the page.

Badge priority:
- Has confirmed leaks → red badge with count (e.g., "2")
- Trackers + form fields but no confirmed leaks → amber "!" badge
- Nothing → no badge

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

## Known companies

The popup resolves raw hostnames to recognizable names. Currently tracked:

Google Analytics, Google Ads, Google Tag Manager, Meta, Microsoft Clarity, Hotjar, FullStory, Mouseflow, LogRocket, Crazy Egg, Klaviyo, HubSpot, Mailchimp, Braze, The Trade Desk, Criteo, Taboola, Outbrain, Mixpanel, Amplitude, Segment, Heap, Shopify Analytics, TikTok, ByteDance, Snapchat, Pinterest, LinkedIn, X (Twitter), RudderStack, mParticle, Salesforce, Loqate, Sierra AI, New Relic, DataDome, Forter

Unknown hostnames are silently filtered from the popup — users only see recognized company names.

## What it catches

| Vector | Example |
|---|---|
| Address autocomplete services | Loqate/Addressy reading keystrokes in address fields |
| Fraud detection | Forter collecting field data for risk scoring |
| Session replay tools | FullStory, Hotjar, Mouseflow reading input fields and sending to their servers |
| Marketing pixels | Meta Pixel, TikTok Pixel capturing email/name fields on form interaction |
| CRM/chat widgets | Sierra AI, Salesforce reading email fields for identity resolution |
| Analytics scripts | Google Analytics, Amplitude exfiltrating search queries, login attempts |
| Abandoned cart tracking | Klaviyo, Shopify capturing partially-typed email for retargeting |
| APM/monitoring | New Relic collecting page interaction data including form fields |
| Beacon/pixel exfiltration | `sendBeacon` or 1x1 image requests with form values embedded in URLs |

## Tested on

| Site | Fields detected | Destinations |
|---|---|---|
| Nike.com | First Name, Email, Address | TikTok, Loqate |
| Gap.com | Email | Sierra AI |
| Shein.com | Email Address | Salesforce |
| Test page (localhost) | Email, Password, Search, Name, Phone, Address | Google Analytics, Meta, Hotjar, Klaviyo, TikTok, Shopify |

## Try It Now

Store approval pending — install locally in under a minute:

### Chrome
1. Download this repo (Code → Download ZIP) and unzip
2. Go to `chrome://extensions` and turn on **Developer mode** (top right)
3. Click **Load unpacked** → select the `chrome-extension` folder
4. That's it — browse any site and click the extension icon

### Firefox
1. Download this repo (Code → Download ZIP) and unzip
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** → pick any file in the `firefox-extension` folder
4. That's it — browse any site and click the extension icon

> Firefox temporary add-ons reset when you close the browser — just re-load next session.

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

---

## The weare____ Suite

Privacy tools that show what's happening — no cloud, no accounts, nothing leaves your browser.

| Extension | What it exposes |
|-----------|----------------|
| [wearecooked](https://github.com/hamr0/wearecooked) | Cookies, tracking pixels, and beacons |
| [wearebaked](https://github.com/hamr0/wearebaked) | Network requests, third-party scripts, and data brokers |
| [weareleaking](https://github.com/hamr0/weareleaking) | localStorage and sessionStorage tracking data |
| [wearelinked](https://github.com/hamr0/wearelinked) | Redirect chains and tracking parameters in links |
| [wearewatched](https://github.com/hamr0/wearewatched) | Browser fingerprinting and silent permission access |
| [weareplayed](https://github.com/hamr0/weareplayed) | Dark patterns: fake urgency, confirm-shaming, pre-checked boxes |
| [wearetosed](https://github.com/hamr0/wearetosed) | Toxic clauses in privacy policies and terms of service |
| **wearesilent** | Form input exfiltration before you click submit |

All extensions run entirely on your device and work on Chrome and Firefox.
