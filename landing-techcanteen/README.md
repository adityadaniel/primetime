# Tech Canteen landing — `techcanteen.inputoutput.id`

Static page + AASA file for the Tech Canteen iOS App Clip. Pure HTML + CSS, no build step, served from Cloudflare Pages.

## What lives here

| File | Purpose |
|------|---------|
| `index.html` | Landing page for `https://techcanteen.inputoutput.id` |
| `checkin.html` | Fallback page shown when a `/checkin?...` link is opened on a non-iOS device or a device without the App Clip yet |
| `styles.css` | Mirrors the INPUT/OUTPUT design tokens (vermilion, bone, ink, Big Shoulders Display, Newsreader) — kept identical to `../landing/styles.css` plus a `.stations` block |
| `.well-known/apple-app-site-association` | Apple App Site Association file. **No file extension.** Cloudflare Pages serves this with `Content-Type: application/json` thanks to `_headers` |
| `_headers` | Cloudflare Pages directive — sets `application/json` on the AASA file and short cache TTLs |

## Cloudflare Pages config

This is a **separate Pages project** from the `inputoutput.id` apex landing.

- Build command: *(none — leave empty)*
- Build output directory: `landing-techcanteen`
- Production branch: `main`
- Custom domain: `techcanteen.inputoutput.id`

The `inputoutput.id` apex Pages project keeps using the existing `landing/` folder — Tech Canteen does not affect it.

### DNS

Add a CNAME on the `inputoutput.id` zone:
```
techcanteen   CNAME   <pages-project>.pages.dev
```

Cloudflare will auto-provision a TLS cert. No proxy toggle needed beyond the default Pages flow.

## App Clip association

The AASA file authorizes the Tech Canteen App Clip + parent app (Team ID `9H8AZ8D28D`, bundle prefix `id.inputoutput.techcanteen`) to handle universal links matching:

```
https://techcanteen.inputoutput.id/checkin?station=<id>
```

The App Clip is in the [`ant-canteen`](https://github.com/adityadaniel/ant-canteen) repo. Its `TechCanteenClip.entitlements` declares:

```
appclips:techcanteen.inputoutput.id
applinks:techcanteen.inputoutput.id
```

NFC tags carry the universal-link URL above; iOS intercepts the tap, fetches `.well-known/apple-app-site-association`, verifies the Team ID + bundle ID match, then launches the App Clip. The fallback `checkin.html` only renders for non-iOS visitors or before the App Clip is registered.

## Local preview

```bash
cd landing-techcanteen && python3 -m http.server 8000
# http://localhost:8000              → landing
# http://localhost:8000/checkin.html → fallback page
# http://localhost:8000/.well-known/apple-app-site-association → AASA JSON
```

## Validating AASA after deploy

Once `https://techcanteen.inputoutput.id` is live:

```bash
# 1. Inspect what Apple's CDN sees
swcutil dl -d techcanteen.inputoutput.id

# 2. Or use Branch's web validator
# https://branch.io/resources/aasa-validator/

# 3. Manual check
curl -sI https://techcanteen.inputoutput.id/.well-known/apple-app-site-association
# Expect: HTTP/2 200, Content-Type: application/json, no redirects
```

If `Content-Type` comes back as `application/octet-stream`, the `_headers` file isn't being honored — confirm Pages is reading `landing-techcanteen/_headers` (must be at the root of the build output dir).

## Updating

When the AASA needs to change (new bundle ID, new path component), edit `.well-known/apple-app-site-association`, push to `main`, Pages auto-deploys, then re-run `swcutil dl -d techcanteen.inputoutput.id` to confirm Apple's CDN refreshed (it caches AASA aggressively — can take up to 24 h).
