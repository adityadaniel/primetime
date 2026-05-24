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
