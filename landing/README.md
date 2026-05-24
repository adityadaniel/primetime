# INPUT/OUTPUT landing page

Static landing page for `inputoutput.id`. Pure HTML + CSS, no build step. Cloudflare Pages serves these files directly.

## Cloudflare Pages config

- Build command: *(none — leave empty)*
- Build output directory: `landing`
- Production branch: `main`
- Custom domain: `inputoutput.id` (apex)

`www.inputoutput.id` redirects to apex automatically (Cloudflare Pages handles).

## Local preview

```bash
cd landing && python3 -m http.server 8000
# open http://localhost:8000
```

## Files

| File | Purpose |
|------|---------|
| `index.html` | Single-page landing |
| `styles.css` | Mirrors design tokens from `app/globals.css` (vermilion, bone, ink, fonts) |
| `og.html` | Source for the 1200×630 OG share image (HTML+CSS, then screenshotted) |
| `og.png` | Generated 1200×630 PNG; referenced from `index.html` meta tags |

## Regenerating `og.png`

`og.png` is a screenshot of `og.html` rendered at exactly 1200×630 in headless Chrome. To regenerate after editing `og.html`:

```bash
cd ~/Developer/broadcast/landing
python3 -m http.server 8765 &
SERVER_PID=$!
sleep 1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1200,630 \
  --screenshot="$(pwd)/og.png" \
  --virtual-time-budget=4000 \
  "http://localhost:8765/og.html"
kill $SERVER_PID
```

The HTTP server is needed so Chrome can fetch Google Fonts referenced from `og.html`. `file://` URLs block external requests in headless mode.

## Design tokens (kept in sync with the app)

| Token | Value |
|-------|-------|
| `--bone` | `#f2ebdc` (paper background) |
| `--ink` | `#0f0f0f` (text) |
| `--vermilion` | `#e5341f` (accent) |
| Display font | Big Shoulders Display 900 (Google Fonts) |
| Body font | Newsreader (Google Fonts) |
| Mono font | JetBrains Mono (Google Fonts) |

When tokens change in `app/globals.css`, mirror them here. Tradeoff worth taking for the no-build-step simplicity.

## Status

This is the v0 placeholder. The full landing page lands in MID-136 (screenshots, copy refinement, OG image).
