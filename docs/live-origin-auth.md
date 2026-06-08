# Live origin + projection auth notes

Durable finding from the localhost → Cloudflare Tunnel workflow.

## Symptom

Reproduction:

1. Host signs in at `http://localhost:4321`.
2. Host opens `/host`, clicks `EDIT` on a saved quiz, then clicks `GO LIVE`.
3. The control room opens locally, but the projection tab opens on `https://live.theprimetime.id` and redirects to sign-in with a callback URL for `/host/:pin/display`.

## Root cause

Two different browser origins are involved:

- Host session cookie exists on `localhost` because the host signed in at `http://localhost:4321`.
- Projection opens on `live.theprimetime.id` because public QR/projection URLs prefer `NEXT_PUBLIC_SITE_URL`.

Cookies are scoped by host, so `live.theprimetime.id` does not receive the `localhost` session cookie. If Auth.js middleware protects every `/host/*` route, the public projection page is treated like a private host page and redirects to sign-in.

The deeper route-model bug: `/host/:pin/display` is physically under `/host`, but product-wise it is a room display surface, not a host control surface.

## Route model

Protected host-only surfaces:

- `/host`
- `/host/quiz/new`
- `/host/:pin/control`
- `/host/wordcloud/new`
- `/host/wordcloud/:pin/control`

Public-by-PIN room surfaces:

- `/host/:pin/display`
- `/host/wordcloud/:pin/display`
- `/join`
- `/play/:pin`
- `/play/:pin/wordcloud`

## Implementation rule

Public URLs that leave the current browser context must use the reachable public origin when configured:

- QR join links
- projection links
- `GO LIVE` projection windows
- any future invite/share links

Use `publicUrl(path, window.location.origin)` from `lib/public-origin.ts` for those cases.

Auth middleware must still protect builders and control rooms, but must allow display pages unauthenticated. Regression-test both sides: display paths pass unauthenticated; control/builder paths do not.

## Verification checklist

Before marking live-origin work done:

1. Set `NEXT_PUBLIC_SITE_URL=https://live.theprimetime.id` for tunnel mode.
2. Restart `npm run dev` so client env changes are bundled.
3. Sign in on `http://localhost:4321`.
4. Dashboard → `EDIT` saved quiz → `GO LIVE`.
5. Confirm control room remains local: `http://localhost:4321/host/:pin/control`.
6. Confirm projection opens public and does not redirect: `https://live.theprimetime.id/host/:pin/display` returns `200`.
7. Confirm QR/join URL uses `https://live.theprimetime.id/join?pin=...`.
8. Confirm protected routes still redirect when unauthenticated, especially `/host/:pin/control`.

Useful probes:

```bash
curl -sI https://live.theprimetime.id/host/$PIN/display | sed -n '1,8p'
curl -sI http://localhost:4321/host/$PIN/control | sed -n '1,8p'
```
