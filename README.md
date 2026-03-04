# wearesilent

> Your form data is being sent before you click submit. This extension shows you where it goes.

**One-liner:** A browser extension that detects and displays real-time form input exfiltration — showing exactly which fields are leaked to which third parties before you submit the form.

---

**You haven't clicked submit yet.** You're still typing your email into a login form. But a script already read the field, URL-encoded your half-typed address, and fired it to an analytics server in a cross-origin request. This happens on thousands of sites. A [USENIX 2022 study](https://www.usenix.org/conference/usenixsecurity22/presentation/senol) found 2,950 of the top 100,000 websites leak form data before submission — email, passwords, search queries, credit card fields — exfiltrated to third parties while you're still typing.

wearesilent makes this visible. It uses ARIA accessibility labels to identify form fields by their human-readable names, listens for input events (compatible with React, Vue, Angular, and vanilla JS), intercepts cross-origin network requests, and correlates your typed values with outgoing data in real-time. When a match is found, you see exactly what was sent, and to whom — displayed as clean, readable labels like "Your Email" or "Your Phone Number" instead of cryptic field IDs.

No cloud. No AI. No data leaves your browser. Everything runs locally in your browser as a lightweight extension.

Part of the **weare____** privacy tool series.

## What it looks like

When a leak is detected, the extension badge lights up red with a count. Click it to see:

- **Which fields** were sent (using ARIA labels: "Email", "First Name", "Phone", not `input_3`)
- **What value** was captured (truncated for privacy)
- **Which company** received it (resolved from domain: `google-analytics.com` → "Google Analytics")

Example from Nike.com checkout:
```
Your First Name    → TikTok
Your Email         → Loqate
Your Address       → Loqate
```

## How it works

1. **Injects a page-level script** (`document_start`, MAIN world, before any site code runs)
2. **Listens to `input` and `change` events** — captures form values as you type. Works with all frameworks (React, Vue, Angular, vanilla) because they all fire real DOM events
3. **Resolves field identity via ARIA** — walks the accessibility tree: `aria-labelledby` → `aria-label` → `<label for>` → wrapping `<label>` → `placeholder` → cleaned `name`/`id`
4. **Intercepts cross-origin requests** — wraps `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, and `HTMLImageElement.src`
5. **Correlates**: when a cross-origin request fires, checks if the URL or body contains any recently-typed value (raw + URL-encoded matching)
6. **Reports**: matched leaks surface as a red badge count and a popup showing which fields were sent to which companies, grouped by field label

All processing is local. Same-origin requests are ignored — only cross-origin exfiltration is flagged.

## What it catches

| Vector | Example |
|---|---|
| Address autocomplete services | Loqate/Addressy reading keystrokes in address fields |
| Session replay tools | FullStory, Hotjar, Mouseflow reading input fields and sending to their servers |
| Marketing pixels | Meta Pixel, TikTok Pixel capturing email/name fields on form interaction |
| CRM/chat widgets | Sierra AI, Salesforce reading email fields for identity resolution |
| Analytics scripts | Google Analytics, Amplitude exfiltrating search queries, login attempts |
| Abandoned cart tracking | Klaviyo, Shopify capturing partially-typed email for retargeting |
| Beacon/pixel exfiltration | `sendBeacon` or 1x1 image requests with form values embedded in URLs |

## Tested on

| Site | Fields detected | Destinations |
|---|---|---|
| Nike.com | First Name, Email, Address | TikTok, Loqate |
| Gap.com | Email | Sierra AI |
| Shein.com | Email Address | Salesforce |
| Test page (localhost) | Email, Password, Search, Name, Phone, Address | Google Analytics, Meta, Hotjar, Klaviyo, TikTok, Shopify |

## Install

### Chrome
1. Clone or download this repo
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `chrome-extension/` folder

### Firefox
1. Clone or download this repo
2. Open `about:debugging`
3. Click **This Firefox** → **Load Temporary Add-on**
4. Select any file inside the `firefox-extension/` folder

Visit any site with forms — start typing and watch the badge.

## Project structure

```
chrome-extension/          # Chrome MV3
firefox-extension/         # Firefox MV3
  manifest.json            # MV3 manifest (Chrome: service_worker, Firefox: scripts)
  injected.js              # MAIN world: input event tracking + ARIA label resolution + network interception
  content.js               # ISOLATED world: bridges leak events to background, keepalive port for SW
  background.js            # Per-tab leak storage (storage.session), same-site filter, badge, cleanup
  popup.html/js/css        # Dark-themed popup: field labels, values, company names
test-page/                 # Local test page simulating 6 tracker types
```

## Architecture

```
User types into <input>          ARIA label resolved           Cross-origin request fires
       │                              │                              │
       ▼                              ▼                              ▼
  input/change event           getAriaLabel() walks:          Wrapped fetch/XHR/beacon/img
  fires on document            aria-labelledby →              checks URL + body against
       │                       aria-label →                   tracked values
       ▼                       <label for> →                         │
  trackField() stores          wrapping <label> →                    ▼
  { value, label, ts }         placeholder →                  Match found? → LEAK
  in trackedValues map         name/id fallback               postMessage to content.js
                                                                     │
                                                                     ▼
                                                              content.js → background.js
                                                              storage.session + badge + popup
```

## Key design decisions

| Decision | Why |
|---|---|
| `input` events instead of `.value` getter wrapping | React, Vue, Angular maintain internal state and don't always trigger prototype getters. DOM `input` events fire reliably across all frameworks. |
| ARIA labels instead of `el.name \|\| el.id` | Real sites have auto-generated IDs (`input_3`, `field-abc123`) or missing names. ARIA labels give human-readable names ("Email Address", "Phone Number") because sites need them for accessibility. |
| Same-site filter in background.js | Keeps badge count and popup in sync. Requests to the site's own domain aren't leaks. |
| Keepalive port (Chrome) | MV3 service workers die after ~30s of inactivity. A long-lived port from content.js prevents silent message failures. |
| No filtering in injected.js | Prototype wrapping in MAIN world is fragile. All filtering happens in background.js (storage) and popup.js (display). |
| Company name resolution | Raw hostnames like `otlp-http-production.shopifysvc.com` mean nothing to users. Mapping to "Shopify Analytics" makes leaks understandable. |

## Permissions

| Permission | Why |
|---|---|
| `storage` | `storage.session` stores per-tab leak data for badge and popup display |
| `host_permissions: <all_urls>` | Content scripts must inject into every page at `document_start` to intercept network APIs before site scripts run |

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
