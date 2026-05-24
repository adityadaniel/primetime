# M3 Setup Checklist

External accounts and config you need to provision before/while M3 ships. Check off as you go.

## Tier shape (locked)

- **Free**: 50 players, 5 saved quizzes, full CSV export, INPUT/OUTPUT watermark, sessions auto-delete after 7d
- **Pro $9/mo or $90/yr**: 200 players, unlimited quizzes, image upload, custom logo, no watermark, full history retention

These tiers drive `MID-73` (mock billing), `MID-74` (pricing page), `MID-75` (cap enforcement). Don't drift.

---

## 1. Production domain — DEFERRED

**Now:** ship on `broadcast-<hash>.vercel.app`.

**When you're ready to swap to a real domain** (whether for Apple Sign-In, Resend email, or just because):
1. Buy domain (Namecheap, Cloudflare Registrar, Porkbun)
2. Add to Vercel project → Domains → Add
3. Update `NEXTAUTH_URL` env var to new domain
4. Update Google OAuth authorized redirect URIs in Google Cloud Console
5. Update Apple Services ID return URL in Apple Developer
6. Add Resend DNS records (SPF/DKIM/DMARC) at registrar
7. Apple Sign-In button + Resend email both turn on automatically

Block budget: 30 min once domain is bought.

---

## 2. Vercel project (~10 min, do first)

- [ ] Sign in to vercel.com (use GitHub account)
- [ ] Import `adityadaniel/broadcast` repo
- [ ] Framework preset: Next.js (auto-detected)
- [ ] Build command: leave default
- [ ] Root directory: leave default
- [ ] Deploy (it'll fail on env vars, that's fine — we'll add them next)
- [ ] Note the deploy URL: `broadcast-XXXX.vercel.app`

### Vercel Postgres
- [ ] Project → Storage → Create Database → Postgres
- [ ] Connect to project → all envs (Production, Preview, Development)
- [ ] Vercel auto-injects: `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`
- [ ] In Prisma schema, the existing `DATABASE_URL` env will need to map to `POSTGRES_PRISMA_URL` for serverless connection pooling. The MID-66 ticket handles that wiring.

### Cloudflare R2 (object storage — replaces Vercel Blob)

Decision: see `DECISIONS.md` 2026-05-21 entry. R2 has zero egress fees and 10 GB free vs Vercel Blob's 0.5 GB free + paid egress.

- [ ] Sign in to https://dash.cloudflare.com
- [ ] R2 Object Storage → enable (no card needed for free tier)
- [ ] Create bucket: `inputoutput-uploads`
- [ ] Settings → CORS policy → allow `GET, PUT, POST, HEAD` from your domains (localhost:4321 + production URL when known)
- [ ] R2 → Manage R2 API Tokens → Create API token
  - Token name: `INPUT/OUTPUT production`
  - Permissions: Object Read & Write
  - Specify bucket: `inputoutput-uploads`
  - TTL: forever
- [ ] Copy Access Key ID, Secret Access Key, and S3 endpoint URL (looks like `https://<account-id>.r2.cloudflarestorage.com`)
- [ ] Add to Vercel env (and `.env.local`):
  - `R2_ACCESS_KEY_ID=<key>`
  - `R2_SECRET_ACCESS_KEY=<secret>`
  - `R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`
  - `R2_BUCKET=inputoutput-uploads`
  - `R2_PUBLIC_URL=https://<bucket>.<account-id>.r2.dev` (turn on the dev URL toggle in R2 settings, or put a CDN URL here later)
- [ ] Used by `MID-72` (image upload) and `MID-79` (R2 prod setup with presigned URLs)

### Upstash Redis (pub/sub for multi-instance socket sync)

- [ ] Sign in to https://upstash.com (Google sign-in is fine)
- [ ] Create Database → Redis
  - Name: `inputoutput-pubsub`
  - Type: Regional
  - Region: closest to your Vercel deploy region (`us-east-1` is the Vercel default)
  - TLS: enabled
- [ ] After create: Details tab shows `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Note the `redis://...` connection string for ioredis if you want it — we'll likely use the REST client.
- [ ] Add to Vercel env:
  - `UPSTASH_REDIS_REST_URL=https://....upstash.io`
  - `UPSTASH_REDIS_REST_TOKEN=<token>`
- [ ] Used by `MID-78` (Redis pub/sub for multi-instance Socket.IO)

### Cost projection (rough monthly)

For BROADCAST at typical usage tiers:

**Idle / dev** (you and 1-2 testers, no real load)
- Vercel Postgres free tier: $0
- R2: under 10 GB free: $0
- Upstash: under 10K commands/day free: $0
- Vercel Hobby tier: $0
- **Total: $0/mo**

**Academy session day** (110 players, 4 sessions, ~40 quizzes saved)
- Everything still on free tiers
- **Total: $0/mo**

**Public soft launch** (~200 active users/mo, 10K player-sessions, 1 GB images)
- Vercel Postgres Pro: $20/mo (1 GB included)
- R2: 1 GB stored = $0.015 + ops under free tier: ~$0.02/mo
- Upstash: ~500K commands/mo: ~$1/mo
- Vercel hosting: $0 free OR $20/mo Pro if compute hours cross threshold
- Resend: 3000 emails/mo free tier
- Stripe: 2.9% + $0.30 per charge = ~$0.56/Pro subscriber, taken from revenue
- **Total infra: ~$20-40/mo**

**Modest scale** (~5K active users/mo, 100K player-sessions, 50 GB images)
- Vercel Postgres Pro: $20-50/mo
- R2: 50 GB stored = $0.75/mo, **zero egress** (vs Vercel Blob ~$15/mo on egress alone — this is where R2 pays off)
- Upstash: ~10M commands/mo = ~$20/mo
- Vercel Pro: $20/mo per seat
- Resend: $20/mo for 50K emails (only if needed)
- **Total infra: ~$80-120/mo**

**Stripe fees independent of infra** — at 2.9% + $0.30 per $9 charge, Stripe takes ~6% ($0.56). 50 Pro subscribers = $450 MRR, $28/mo to Stripe = $422 net. Modest-scale infra leaves ~$300-340/mo positive after fees. Unit economics work starting around 30-50 paying users.

**Where costs blow up if you're not careful:**
- DB connection pool exhaustion on Vercel functions → use Prisma's pgbouncer-friendly URL
- Upstash commands if you accidentally poll instead of subscribe → verify pub/sub patterns in MID-78
- Resend if password-reset abuse spam isn't rate-limited
- R2 ops if uploads aren't deduped / cached at the CDN

None of these matter at academy scale. They start mattering at ~1000+ active users.

---

## 3. Auth.js secrets (~2 min)

- [ ] Generate: `openssl rand -base64 32`
- [ ] Add to Vercel env (all envs): `AUTH_SECRET=<generated>`
- [ ] Add: `NEXTAUTH_URL=https://broadcast-XXXX.vercel.app`
- [ ] When local dev: `.env.local` gets the same `AUTH_SECRET` and `NEXTAUTH_URL=http://localhost:4321`

---

## 4. Google OAuth (~15 min)

- [ ] Go to https://console.cloud.google.com
- [ ] Create new project: "BROADCAST"
- [ ] APIs & Services → OAuth consent screen
  - User type: External
  - App name: BROADCAST
  - Support email: yours
  - Authorized domains: `vercel.app` (when on subdomain), then your real domain later
  - Scopes: `email`, `profile`, `openid`
  - Test users: add your own email + a few academy testers
- [ ] APIs & Services → Credentials → Create Credentials → OAuth client ID
  - Application type: Web application
  - Name: BROADCAST web
  - Authorized JavaScript origins:
    - `http://localhost:4321`
    - `https://broadcast-XXXX.vercel.app`
  - Authorized redirect URIs:
    - `http://localhost:4321/api/auth/callback/google`
    - `https://broadcast-XXXX.vercel.app/api/auth/callback/google`
- [ ] Copy the client ID and client secret
- [ ] Add to Vercel env (and `.env.local`):
  - `GOOGLE_CLIENT_ID=<id>`
  - `GOOGLE_CLIENT_SECRET=<secret>`

---

## 5. Apple Sign-In (~30 min, BLOCKED on real domain)

⚠️ Apple requires DNS verification on the return URL domain. `.vercel.app` won't work. Wire up architecturally now, activate after domain.

When you have the real domain:
- [ ] Sign in to https://developer.apple.com
- [ ] Certificates, Identifiers & Profiles → Identifiers → +
  - Type: App IDs → App
  - Description: BROADCAST
  - Bundle ID: explicit, e.g. `com.adityadaniel.broadcast`
  - Capabilities: Sign In with Apple
- [ ] Identifiers → + → Services IDs
  - Description: BROADCAST Web Auth
  - Identifier: `com.adityadaniel.broadcast.web`
  - Configure Sign In with Apple:
    - Primary App ID: select the one above
    - Domains: your real domain
    - Return URLs: `https://yourdomain.com/api/auth/callback/apple`
  - Save (Apple emails a verification step or asks for a domain TXT record)
- [ ] Keys → + → Sign in with Apple
  - Configure: select the App ID above
  - Download the `.p8` file (you can only download once — store carefully)
  - Note the Key ID
- [ ] Note your Team ID (top right of developer.apple.com)
- [ ] Add to Vercel env:
  - `APPLE_ID=<services-id>` (e.g. `com.adityadaniel.broadcast.web`)
  - `APPLE_TEAM_ID=<team-id>`
  - `APPLE_KEY_ID=<key-id>`
  - `APPLE_PRIVATE_KEY=<contents-of-.p8-file-with-newlines-as-\n>`
- [ ] Auth.js Apple provider builds the JWT client secret on the fly from these four

---

## 6. Stripe (~10 min)

Test mode for all of M3. Switch to live mode when launching publicly.

- [ ] Sign in to https://dashboard.stripe.com (sign up if needed)
- [ ] Confirm you're in **Test mode** (top-right toggle)
- [ ] Developers → API keys
  - Copy `Publishable key` (starts `pk_test_`)
  - Reveal + copy `Secret key` (starts `sk_test_`)
- [ ] Create Pro product:
  - Products → Add product
  - Name: BROADCAST Pro
  - Pricing: Recurring, $9.00 USD / month
  - Save
  - Add another price: Recurring, $90.00 USD / year
  - Note both Price IDs (start `price_`)
- [ ] Webhook endpoint:
  - Developers → Webhooks → Add endpoint
  - URL: `https://broadcast-XXXX.vercel.app/api/stripe/webhook`
  - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
  - Save → reveal Signing secret (starts `whsec_`)
- [ ] Add to Vercel env:
  - `STRIPE_PUBLISHABLE_KEY=pk_test_...`
  - `STRIPE_SECRET_KEY=sk_test_...`
  - `STRIPE_WEBHOOK_SECRET=whsec_...`
  - `STRIPE_PRO_MONTHLY_PRICE_ID=price_...`
  - `STRIPE_PRO_ANNUAL_PRICE_ID=price_...`

For local webhook testing:
- [ ] Install Stripe CLI: `brew install stripe/stripe-cli/stripe`
- [ ] `stripe login`
- [ ] `stripe listen --forward-to localhost:4321/api/stripe/webhook` (gives you a `whsec_` for local)

---

## 7. Resend email (~10 min, partially BLOCKED on real domain)

Free tier: 3000 emails/mo, 100/day.

- [ ] Sign in to https://resend.com
- [ ] API Keys → Create API Key
  - Name: BROADCAST production
  - Permission: Full access
  - Copy (starts `re_`)
- [ ] Add to Vercel env:
  - `RESEND_API_KEY=re_...`
  - `EMAIL_FROM=BROADCAST <onboarding@resend.dev>` (uses Resend's shared sender for now)
- [ ] Until you have your real domain, emails come from `onboarding@resend.dev` — fine for academy use, ugly for production
- [ ] When real domain is live:
  - Domains → Add Domain → enter `yourdomain.com`
  - Add the SPF/DKIM/DMARC TXT records to your domain registrar
  - Wait for verification (usually <10 min)
  - Update `EMAIL_FROM=INPUT/OUTPUT <hello@yourdomain.com>`

---

## 8. Local development env

- [ ] Create `.env.local` in repo root with everything above (use development values for redirects, test mode for Stripe)
- [ ] Add `.env.local` to `.gitignore` (already there from M2.5)
- [ ] Sample template will land as part of MID-67 → `.env.example`

---

## What blocks what

| Ticket | Needs |
|---|---|
| MID-67 (Auth.js scaffolding) | Nothing — pure code, in-progress |
| MID-68 (sign-up/in/reset UI) | MID-67 |
| MID-67 Google branch | Google OAuth client ID + secret |
| MID-67 Apple branch | Apple keys + real domain (architecture only until domain) |
| MID-66 (DB migration) | Vercel Postgres provisioned |
| MID-71 (saved quizzes) | MID-66 + MID-67 |
| MID-70 (library dashboard) | MID-71 |
| MID-72 (image upload) | Vercel Blob token |
| MID-79 (file upload prod) | Vercel Blob token |
| MID-78 (Redis pub/sub) | Vercel KV |
| MID-73 (mock billing endpoints) | MID-67 (user.tier field) |
| MID-74 (pricing page + checkout) | Stripe keys + price IDs |
| MID-75 (tier-aware caps) | MID-73 |
| MID-76, 77 (history) | MID-66 |
| MID-69 (real email reset) | Resend API key (works on `onboarding@resend.dev` until domain) |

---

## Recommended setup order while I work

You can knock these out in one sitting (~45 min total), in parallel with my work:

1. Vercel project + Postgres + Blob + KV → ~15 min, unblocks DB and uploads
2. Google OAuth → ~15 min, unblocks Google sign-in
3. Stripe → ~10 min, unblocks billing
4. Resend → ~5 min, unblocks reset emails (sender from `onboarding@resend.dev` is fine)
5. Apple → ~30 min later, after you have a real domain
6. Real domain → whenever convenient, unlocks Apple + clean email sender + branded URL

Drop the keys into Vercel env as you generate them. I'll consume them as MID tickets need them.
