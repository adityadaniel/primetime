# PRIMETIME Deployment

This project is designed to run from a Mac server on port `4321`. Use the local-IP mode for same-network sessions, or Cloudflare Tunnel when participants need to join through the public `live.theprimetime.id` domain.

## 1. Using the local IP address of the Mac server

Use this when the host Mac and all quiz participants are on the same Wi-Fi/LAN, or when everyone can reach the Mac through Tailscale.

### Start the app

```bash
cd ~/Developer/primetime
npm install
npm run db:up
cp .env.example .env.local   # first time only; set DATABASE_URL + AUTH_SECRET
npm run db:migrate
npm run dev
```

The app listens on port `4321`. The server log prints `http://localhost:4321`, but other devices need the Mac's network address.

### Find the Mac address participants can reach

Wi-Fi/LAN:

```bash
ipconfig getifaddr en0
```

Tailscale, if used:

```bash
tailscale ip -4
```

If the Mac IP is `192.168.1.25`, use:

- Host / builder: `http://192.168.1.25:4321/host`
- Player join page: `http://192.168.1.25:4321/join`
- Projection display: `http://192.168.1.25:4321/host/[PIN]/display`

For the cleanest session, open the host and projection screens through the Mac IP address, not `localhost`. The projection QR code is generated from the browser's current origin; if the display is opened at `localhost`, the QR code will also point at `localhost`, which participants cannot reach from their phones.

If host sign-in or redirects are involved, set the public origin in `.env.local` and restart the app:

```bash
NEXTAUTH_URL=http://192.168.1.25:4321
NEXT_PUBLIC_SITE_URL=http://192.168.1.25:4321
AUTH_TRUST_HOST=true
```

### Run checklist

1. Keep the Mac awake while the session is live:

   ```bash
   caffeinate -dimsu npm run dev
   ```

2. Open the host flow on the Mac, create a game, and show the projection display.
3. Ask participants to open `http://<MAC-IP>:4321/join` and enter the PIN.
4. If a phone cannot connect:
   - Confirm it is on the same network, not isolated guest Wi-Fi.
   - Check macOS Firewall / security prompts for Node.js.
   - Verify from another device with `http://<MAC-IP>:4321/` before debugging the app.

Local-IP mode is the simplest option, but it is not public internet deployment. It depends on local network reachability and the Mac staying awake.

## 2. Using Cloudflare Tunnel for `live.theprimetime.id`

Use this for workshops or events where participants should join from:

```text
https://live.theprimetime.id/join
```

Cloudflare Tunnel exposes the Mac's local `http://localhost:4321` server through Cloudflare without router port-forwarding. WebSockets / Socket.IO work through the tunnel.

### One-time prerequisites

- `theprimetime.id` must be managed in Cloudflare DNS.
- `cloudflared` must be installed:

  ```bash
  brew install cloudflared
  ```

- Authenticate Cloudflare on the Mac once:

  ```bash
  cloudflared tunnel login
  ```

  This opens a browser. Choose the `theprimetime.id` zone and authorize. It writes `~/.cloudflared/cert.pem`.

### Configure the app for the public domain

In `.env.local`, use the tunnel profile:

```bash
NEXTAUTH_URL=https://live.theprimetime.id
NEXT_PUBLIC_SITE_URL=https://live.theprimetime.id
AUTH_TRUST_HOST=true
```

Keep the normal local database/auth settings too:

```bash
DATABASE_URL=postgresql://primetime:***@localhost:5432/primetime_dev
AUTH_SECRET=<random-secret>
```

### Create and route the tunnel

You can use the setup script:

```bash
cd ~/Developer/primetime
bash scripts/setup.sh
```

When prompted for Cloudflare Tunnel, choose yes and use:

```text
Public hostname: live.theprimetime.id
```

The setup script writes the tunnel service as `http://localhost:4321` automatically when it creates `~/.cloudflared/config.yml`.

Manual equivalent:

```bash
cloudflared tunnel create primetime-live
cloudflared tunnel route dns primetime-live live.theprimetime.id
```

Then create or update `~/.cloudflared/config.yml`:

```yaml
tunnel: primetime-live
credentials-file: /Users/adityadaniel/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: live.theprimetime.id
    service: http://localhost:4321
  - service: http_status:404
```

Use the actual credentials JSON path created by `cloudflared tunnel create`.

### Start the live session

Start Postgres and the app first:

```bash
cd ~/Developer/primetime
npm run db:up
npm run db:migrate
caffeinate -dimsu npm run dev
```

In another terminal, start the tunnel:

```bash
cloudflared tunnel run primetime-live
```

For a production-style local run, use this instead of `npm run dev`:

```bash
npm run build
caffeinate -dimsu npm start
```

### Verify before sharing with participants

```bash
curl -I https://live.theprimetime.id/
curl -I 'https://live.theprimetime.id/socket.io/?EIO=4&transport=polling'
```

Then test from a phone on cellular data, not just the same Wi-Fi:

- Host / builder: `https://live.theprimetime.id/host`
- Player join page: `https://live.theprimetime.id/join`
- Projection display: `https://live.theprimetime.id/host/[PIN]/display`

### Operational notes

- Start order matters: database → app → tunnel.
- If the Mac sleeps, the tunnel goes offline and participants lose the live URL.
- Do not run two PRIMETIME servers on port `4321`; the tunnel forwards to whatever owns that port.
- If auth redirects to `localhost`, re-check `NEXTAUTH_URL`, `NEXT_PUBLIC_SITE_URL`, and `AUTH_TRUST_HOST=true` in `.env.local`, then restart the app.
