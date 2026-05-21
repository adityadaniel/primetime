# M3 Setup Checklist

External accounts and config you need to provision before/while M3 ships. Check off as you go.

## Tier shape (locked)

- **Free**: 50 players, 5 saved quizzes, full CSV export, BROADCAST watermark, sessions auto-delete after 7d
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

### Vercel Blob (file storage)
- [ ] Project → Storage → Create → Blob
- [ ] Connect to project
- [ ] Auto-injects: `BLOB_READ_WRITE_TOKEN`
- [ ] Used by `MID-72` (image upload) and `MID-79` (Blob production setup)

### Vercel KV (Redis for socket sync)
- [ ] Project → Storage → Create → KV
- [ ] Connect to project
- [ ] Auto-injects: `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`
- [ ] Used by `MID-78` (Redis pub/sub)

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
  - Update `EMAIL_FROM=BROADCAST <hello@yourdomain.com>`

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
