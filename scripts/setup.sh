#!/usr/bin/env bash
#
# scripts/setup.sh — PRIMETIME internal-tool installer
#
# Single-command bootstrap from a fresh `git clone` to a working install on a
# Mac. Idempotent: re-runs preserve existing Postgres data, never overwrite
# .env.local, and skip already-completed work.
#
# macOS only. The Mac mini is the documented target — this script intentionally
# does not support Linux. If the operator restarts the Mac, they re-run this
# script (or just `npm run start`).
#
# Steps:
#   1. Prereq checks (macOS, Homebrew, Node 22+, Docker, cloudflared)
#   2. npm ci
#   3. Generate .env.local if missing (never overwrite an existing one)
#   4. docker compose up -d postgres + wait for healthcheck
#   5. prisma migrate deploy + prisma generate
#   6. Optional Cloudflare Tunnel walkthrough (preserves ~/.cloudflared/config.yml)
#   7. Optional sample quiz seed
#   8. Print summary
#
# Run: bash scripts/setup.sh    (or)    npm run setup

set -euo pipefail

# ---- formatting helpers (no colors required, just consistent prefixes) ----

step() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    [warn] %s\n' "$*" >&2; }
fail() {
  printf '\n[error] %s\n' "$*" >&2
  exit 1
}

# Resolve repo root from this script's location so it's safe to invoke from
# anywhere (e.g. `bash scripts/setup.sh` or `npm run setup`).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# ---- 0. banner ----

cat <<'EOF'
PRIMETIME setup — internal tool installer
-----------------------------------------
Idempotent. Safe to re-run. Preserves your existing .env.local and
Postgres volume. macOS only.

EOF

# ---- 1a. macOS check ----

step "Checking platform"
if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "This installer only supports macOS. Detected: $(uname -s)."
fi
info "macOS detected ($(sw_vers -productVersion 2>/dev/null || echo 'unknown version'))."

# ---- 1b. Homebrew ----

step "Checking Homebrew"
if command -v brew >/dev/null 2>&1; then
  info "brew found at $(command -v brew)."
  HAS_BREW=1
else
  HAS_BREW=0
  warn "Homebrew not found."
  cat <<'EOF'

    Install Homebrew manually (it asks for a sudo password, which this script
    intentionally does not request on your behalf):

      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    Then re-run: bash scripts/setup.sh
EOF
  fail "Homebrew is required to install Node and cloudflared automatically."
fi

# ---- 1c. Node 22+ ----

step "Checking Node.js (>= 22)"
need_node_install=0
if command -v node >/dev/null 2>&1; then
  node_version_raw="$(node --version)"            # e.g. v22.5.1
  node_major="${node_version_raw#v}"              # 22.5.1
  node_major="${node_major%%.*}"                  # 22
  if [[ "${node_major}" =~ ^[0-9]+$ ]] && (( node_major >= 22 )); then
    info "node ${node_version_raw} OK."
  else
    warn "node ${node_version_raw} is too old; need >= 22."
    need_node_install=1
  fi
else
  warn "node not found."
  need_node_install=1
fi

if (( need_node_install == 1 )); then
  if (( HAS_BREW == 1 )); then
    info "Installing node@22 via Homebrew (this can take a minute)..."
    brew install node@22
    # node@22 is keg-only on Apple Silicon; expose it to the current shell.
    if [[ -d "/opt/homebrew/opt/node@22/bin" ]]; then
      export PATH="/opt/homebrew/opt/node@22/bin:${PATH}"
    elif [[ -d "/usr/local/opt/node@22/bin" ]]; then
      export PATH="/usr/local/opt/node@22/bin:${PATH}"
    fi
    if ! command -v node >/dev/null 2>&1; then
      fail "node still not on PATH after install. Try: brew link --force --overwrite node@22"
    fi
    info "node $(node --version) installed."
  else
    fail "Install Node 22+ manually from https://nodejs.org/ and re-run."
  fi
fi

# ---- 1d. Docker (no auto-install — license/legal footgun) ----

step "Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  cat <<'EOF'

    Docker is required to run the local Postgres container.

      Install OrbStack (recommended, lightweight) — https://orbstack.dev
      or Docker Desktop                            — https://www.docker.com/products/docker-desktop

    Then start the app, wait for it to finish booting, and re-run:
      bash scripts/setup.sh
EOF
  fail "Docker is not installed."
fi

if ! docker info >/dev/null 2>&1; then
  fail "Docker is installed but not running. Start OrbStack/Docker Desktop and re-run."
fi
info "docker reachable ($(docker --version))."

# ---- 1e. cloudflared (safe to brew install) ----

step "Checking cloudflared"
if command -v cloudflared >/dev/null 2>&1; then
  info "cloudflared OK ($(cloudflared --version 2>&1 | head -n1))."
else
  info "cloudflared not found — installing via Homebrew..."
  brew install cloudflared
  info "cloudflared installed ($(cloudflared --version 2>&1 | head -n1))."
fi

# ---- 2. install dependencies ----

step "Installing npm dependencies (npm ci)"
if [[ ! -f package-lock.json ]]; then
  warn "package-lock.json missing — falling back to npm install."
  npm install
else
  npm ci
fi

# ---- 3. .env.local (generate only if missing) ----

step "Generating .env.local (if missing)"
if [[ -f .env.local ]]; then
  info "Existing .env.local detected, leaving it alone."
else
  if [[ ! -f .env.example ]]; then
    fail ".env.example is missing — cannot generate .env.local."
  fi

  # Generate a fresh AUTH_SECRET once, never echoed.
  generated_secret="$(openssl rand -base64 32)"

  # Write the file by copying .env.example then replacing/setting the values
  # we want for the LOCAL DEV profile. Operator can switch to the WORKSHOP /
  # TUNNEL profile later (the script offers to do this in step 6).
  tmp_env="$(mktemp)"
  trap 'rm -f "${tmp_env}"' EXIT

  # Read the example, but rewrite a small set of fields. We deliberately do
  # NOT overwrite Google/Apple OAuth credentials or BETA_INVITE_CODES — those
  # stay as the example placeholders for the operator to fill if needed.
  awk -v secret="${generated_secret}" '
    BEGIN { OFS = "" }
    # AUTH_SECRET= → AUTH_SECRET=<generated>
    /^AUTH_SECRET=/ { print "AUTH_SECRET=", secret; next }
    # Force REQUIRE_INVITE_CODE=false for internal-tool scope.
    /^REQUIRE_INVITE_CODE=/ { print "REQUIRE_INVITE_CODE=false"; next }
    # Force ENABLE_APPLE_SIGNIN=false.
    /^ENABLE_APPLE_SIGNIN=/ { print "ENABLE_APPLE_SIGNIN=false"; next }
    # Default to the LOCAL DEV profile values that ship in the example.
    { print }
  ' .env.example > "${tmp_env}"

  mv "${tmp_env}" .env.local
  trap - EXIT
  chmod 600 .env.local

  info ".env.local written (LOCAL DEV profile, AUTH_SECRET generated)."
  info "Operator action: edit .env.local to fill GOOGLE_CLIENT_ID/SECRET if you want OAuth sign-in."
fi

# ---- 4. start Postgres ----

step "Starting Postgres (docker compose up -d postgres)"
postgres_container="primetime-postgres"
postgres_healthcheck=(docker compose exec -T postgres pg_isready -U primetime -d primetime_dev)
postgres_logs_hint="docker compose logs postgres"

if ! docker compose up -d postgres; then
  if docker inspect "${postgres_container}" >/dev/null 2>&1; then
    warn "docker compose could not create ${postgres_container} because a container with that name already exists. Reusing the existing container."
    if [[ "$(docker inspect -f '{{.State.Running}}' "${postgres_container}")" != "true" ]]; then
      docker start "${postgres_container}" >/dev/null
    fi
    postgres_healthcheck=(docker exec "${postgres_container}" pg_isready -U primetime -d primetime_dev)
    postgres_logs_hint="docker logs ${postgres_container}"
  else
    fail "docker compose could not start Postgres. Check: docker compose logs postgres"
  fi
fi

info "Waiting up to 30s for Postgres to become healthy..."
ready=0
for _ in $(seq 1 30); do
  if "${postgres_healthcheck[@]}" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if (( ready == 0 )); then
  fail "Postgres did not become healthy in 30s. Check: ${postgres_logs_hint}"
fi
info "Postgres healthy."

# ---- 5. apply migrations ----

step "Applying Prisma migrations (safe with existing data)"
npx prisma migrate deploy
npx prisma generate

# ---- 6. optional Cloudflare Tunnel walkthrough ----

step "Cloudflare Tunnel (optional)"
read -r -p "    Set up Cloudflare Tunnel for live.<your-domain>? [y/N] " tunnel_reply || tunnel_reply=""
case "${tunnel_reply}" in
  y|Y|yes|YES)
    if [[ ! -f "${HOME}/.cloudflared/cert.pem" ]]; then
      cat <<'EOF'

    No ~/.cloudflared/cert.pem found. You need to authenticate first:

      cloudflared tunnel login

    That opens a browser to authorize a zone. Once it writes the cert, re-run:
      bash scripts/setup.sh

EOF
      info "Skipping tunnel setup for now."
    else
      default_tunnel_name="$(hostname -s 2>/dev/null || echo 'primetime')-live"
      read -r -p "    Tunnel name [${default_tunnel_name}]: " tunnel_name
      tunnel_name="${tunnel_name:-${default_tunnel_name}}"
      read -r -p "    Public hostname (e.g. live.theprimetime.id): " tunnel_host
      if [[ -z "${tunnel_host}" ]]; then
        warn "No hostname entered — skipping tunnel setup."
      else
        # Skip create if a tunnel by this name already exists.
        if cloudflared tunnel list 2>/dev/null | awk 'NR>1 {print $2}' | grep -Fxq "${tunnel_name}"; then
          info "Tunnel '${tunnel_name}' already exists — reusing."
        else
          info "Creating tunnel '${tunnel_name}'..."
          cloudflared tunnel create "${tunnel_name}"
        fi

        # Generate ~/.cloudflared/config.yml ONLY if it doesn't exist —
        # never blow away an operator's existing config.
        cf_dir="${HOME}/.cloudflared"
        cf_config="${cf_dir}/config.yml"
        mkdir -p "${cf_dir}"
        if [[ -f "${cf_config}" ]]; then
          info "${cf_config} already exists, leaving it alone."
        else
          # Find the credentials file written by `tunnel create`. cloudflared
          # writes <UUID>.json into ~/.cloudflared/. Pick the newest match.
          cred_file="$(find "${cf_dir}" -maxdepth 1 -name '*.json' -type f -print0 2>/dev/null \
            | xargs -0 ls -t 2>/dev/null | head -n1 || true)"
          if [[ -z "${cred_file}" ]]; then
            warn "Could not locate a credentials JSON in ${cf_dir}. Skipping config.yml write."
          else
            cat > "${cf_config}" <<EOF
# Generated by scripts/setup.sh on $(date -u +'%Y-%m-%dT%H:%M:%SZ').
# Edit to taste. Re-running setup will not overwrite this file.
tunnel: ${tunnel_name}
credentials-file: ${cred_file}

ingress:
  - hostname: ${tunnel_host}
    service: http://localhost:4321
  - service: http_status:404
EOF
            chmod 600 "${cf_config}"
            info "Wrote ${cf_config}."
          fi
        fi

        info "Routing DNS ${tunnel_host} -> ${tunnel_name}..."
        if ! cloudflared tunnel route dns "${tunnel_name}" "${tunnel_host}"; then
          warn "DNS route failed (may already exist) — continuing."
        fi

        # Switch .env.local to the WORKSHOP / TUNNEL profile.
        if [[ -f .env.local ]]; then
          tmp_switch="$(mktemp)"
          trap 'rm -f "${tmp_switch}"' EXIT
          awk -v host="${tunnel_host}" '
            BEGIN { wrote_trust = 0 }
            /^NEXTAUTH_URL=/        { print "NEXTAUTH_URL=https://" host; next }
            /^NEXT_PUBLIC_SITE_URL=/{ print "NEXT_PUBLIC_SITE_URL=https://" host; next }
            /^#?[[:space:]]*AUTH_TRUST_HOST=/ { print "AUTH_TRUST_HOST=true"; wrote_trust = 1; next }
            { print }
            END { if (!wrote_trust) print "AUTH_TRUST_HOST=true" }
          ' .env.local > "${tmp_switch}"
          mv "${tmp_switch}" .env.local
          trap - EXIT
          chmod 600 .env.local
          info ".env.local switched to WORKSHOP / TUNNEL profile (https://${tunnel_host})."
        fi

        TUNNEL_NAME_FOR_SUMMARY="${tunnel_name}"
        TUNNEL_HOST_FOR_SUMMARY="${tunnel_host}"
      fi
    fi
    ;;
  *)
    info "Skipping tunnel setup. Re-run this script later to configure one."
    ;;
esac

# ---- 7. optional starter quiz seed ----

step "Sample quiz seed (optional)"
read -r -p "    Seed a sample quiz to get started? [Y/n] " seed_reply || seed_reply=""
case "${seed_reply}" in
  n|N|no|NO)
    info "Skipping seed."
    ;;
  *)
    info "Running prisma db seed..."
    if npx prisma db seed; then
      info "Seed complete."
    else
      warn "Seed failed — continuing. You can re-run later: npx prisma db seed"
    fi
    ;;
esac

# ---- 8. summary ----

cat <<'EOF'

==> Setup complete.

    Start the app:
      npm run start
      # then open http://localhost:4321
EOF

if [[ -n "${TUNNEL_NAME_FOR_SUMMARY:-}" ]]; then
  cat <<EOF

    Start the tunnel (in a separate terminal):
      cloudflared tunnel run ${TUNNEL_NAME_FOR_SUMMARY}
      # then open https://${TUNNEL_HOST_FOR_SUMMARY:-<your-host>}
EOF
fi

cat <<'EOF'

    Re-running this script is safe — it preserves .env.local, Postgres data,
    and any existing Cloudflare Tunnel config.
EOF
