# wearesilent

> Form input leak detector — see what leaves your keyboard before you click submit.

**You haven't clicked submit yet.** You're still typing your email into a login form. But a script already read the field, URL-encoded your half-typed address, and fired it to an analytics server in a cross-origin request. This happens on thousands of sites. A [USENIX 2022 study](https://www.usenix.org/conference/usenixsecurity22/presentation/senol) found 2,950 of the top 100,000 websites leak form data before submission — email, passwords, search queries, credit card fields — exfiltrated to third parties while you're still typing.

wearesilent makes this visible. It wraps input field accessors and outgoing request APIs at the page level, correlates recently-typed values with cross-origin requests in real-time, and shows you exactly which fields leaked to which destinations. No cloud, no AI — prototype interception running in your browser.

Part of the **weare____** privacy tool series.

## How it works

1. **Injects a page-level script** (`document_start`, before any site code runs) that wraps `HTMLInputElement.prototype.value` and `HTMLTextAreaElement.prototype.value` getters
2. **Records recently-typed values** into a ring buffer (last 30 values, 4+ chars, 30s TTL)
3. **Wraps outgoing request APIs** — `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, and `HTMLImageElement.src` setter
4. **Correlates**: when a cross-origin request fires, checks if the URL or body contains any recently-typed value (raw string match + URL-encoded match)
5. **Reports**: matched leaks surface as a red badge count and a popup showing each exfiltrated field, its destination, and the truncated value

All processing is local. No data leaves your browser. Same-origin requests are ignored — only cross-origin exfiltration is flagged.

## What it catches

| Vector | Example |
|---|---|
| Session replay tools | FullStory, Hotjar, Mouseflow reading input fields and sending to their servers |
| Marketing pixels | Meta Pixel, TikTok Pixel capturing email fields on form interaction |
| Analytics scripts | Custom analytics exfiltrating search queries, login attempts |
| Abandoned cart tracking | E-commerce sites sending partially-typed form data to retargeting services |
| Beacon/pixel exfiltration | `sendBeacon` or 1x1 image requests with form values embedded in URLs |

## Install

### Chrome
1. Clone or download this repo
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `chrome-extension/` folder

Visit any site with forms — start typing and watch the badge.

## Project structure

```
chrome-extension/
  manifest.json       # MV3 — storage, <all_urls>, web_accessible_resources
  injected.js         # Page-level script: prototype wrapping + request interception
  content.js          # Injects page script, relays leak events to background
  background.js       # Per-tab leak storage (storage.session), badge, cleanup
  popup.html/js/css   # Leak count + exfiltrated fields list
```

## How detection works

```
User types into <input>     Site script reads .value     Script sends cross-origin request
       │                            │                              │
       ▼                            ▼                              ▼
  (normal typing)         Wrapped getter records          Wrapped fetch/XHR/beacon
                          value + field name               checks request URL + body
                          into ring buffer                 against ring buffer
                                                                   │
                                                                   ▼
                                                          Match found? → LEAK
                                                          Badge count + popup entry
```

**Tracked input types:** text, email, tel, search, password, url, textarea

**Intercepted APIs:** `fetch`, `XMLHttpRequest.open/send`, `navigator.sendBeacon`, `HTMLImageElement.src`

**Deduplication:** each field + destination pair is reported once per page load.

## Permissions

| Permission | Why |
|---|---|
| `storage` | `storage.session` stores per-tab leak data for badge and popup display |
| `host_permissions: <all_urls>` | Content script must inject into every page at `document_start` to wrap prototypes before site scripts run. `injected.js` must be web-accessible for page-level injection. |

## Research

- [Leaky Forms: A Study of Email and Password Exfiltration Before Form Submission (USENIX Security 2022)](https://www.usenix.org/conference/usenixsecurity22/presentation/senol)
- [LeakInspector — KU Leuven proof-of-concept (MV2, discontinued)](https://github.com/leaky-forms/leak-inspector)
- [No Boundaries: Exfiltration of Personal Data by Session Replay Scripts (Princeton 2017)](https://privacyinternational.org/examples/1918/no-boundaries-exfiltration-personal-data-session-replay-scripts)
