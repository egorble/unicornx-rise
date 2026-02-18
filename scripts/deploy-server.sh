#!/bin/bash
###############################################################################
# FantasyYC — Production Deployment Script (RISE Chain)
# Domain: rise.unicornx.fun
#
# First deploy:
#   1. Create .env:  sudo mkdir -p /opt/fantasyyc && sudo nano /opt/fantasyyc/.env
#   2. Run:          sudo bash scripts/deploy-server.sh
#
# Update from GitHub:
#   sudo bash /opt/fantasyyc/scripts/update.sh
###############################################################################

set -euo pipefail

# ─── Configuration ───
DOMAIN="rise.unicornx.fun"
APP_DIR="/opt/fantasyyc"
APP_USER="fantasyyc"
ENV_FILE="${APP_DIR}/.env"
CERTBOT_WEBROOT="/var/www/certbot"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

if [ "$(id -u)" -ne 0 ]; then
    err "This script must be run as root (sudo)"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ ! -f "${PROJECT_DIR}/server/index.js" ]; then
    err "Cannot find project at ${PROJECT_DIR}. Run this script from the project directory."
fi

log "Project directory: ${PROJECT_DIR}"
log "Target directory: ${APP_DIR}"
log "Domain: ${DOMAIN}"

###############################################################################
# STEP 1: Install system dependencies
###############################################################################
step "1/10 — Installing system dependencies"

apt-get update -qq
apt-get install -y -qq curl gnupg2 ca-certificates lsb-release software-properties-common rsync

if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* && "$(node -v)" != v22* ]]; then
    log "Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
else
    log "Node.js $(node -v) already installed"
fi

if ! command -v nginx &>/dev/null; then
    log "Installing nginx..."
    apt-get install -y -qq nginx
else
    log "nginx already installed"
fi

if ! command -v certbot &>/dev/null; then
    log "Installing certbot..."
    apt-get install -y -qq certbot python3-certbot-nginx
else
    log "certbot already installed"
fi

log "Node: $(node -v) | npm: $(npm -v) | nginx: $(nginx -v 2>&1 | cut -d/ -f2)"

###############################################################################
# STEP 2: Create app user
###############################################################################
step "2/10 — Setting up app user"

if id "$APP_USER" &>/dev/null; then
    log "User '$APP_USER' already exists"
else
    useradd --system --shell /bin/false --home-dir "$APP_DIR" --create-home "$APP_USER"
    log "Created system user '$APP_USER'"
fi

###############################################################################
# STEP 3: Create directory structure
###############################################################################
step "3/10 — Creating directory structure"

mkdir -p "${APP_DIR}"/{server,backend,front,backups,logs,deploy}
mkdir -p "${APP_DIR}/server/db"
mkdir -p "${APP_DIR}/server/logs"
mkdir -p "$CERTBOT_WEBROOT"

log "Directories created at ${APP_DIR}"

###############################################################################
# STEP 4: Clone/pull from GitHub
###############################################################################
step "4/10 — Fetching code from GitHub"

REPO="https://github.com/egorble/fantasyyc-rise.git"

apt-get install -y -qq git
git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true

if [ -d "${APP_DIR}/.git" ]; then
    log "Repo exists — pulling latest..."
    cd "${APP_DIR}"
    git stash --include-untracked 2>/dev/null || true
    git pull origin main
    git stash pop 2>/dev/null || true
else
    log "Cloning repo into ${APP_DIR}..."
    TEMP_DIR=$(mktemp -d)
    [ -f "${APP_DIR}/.env" ] && cp "${APP_DIR}/.env" "${TEMP_DIR}/.env"
    [ -f "${APP_DIR}/server/db/fantasyyc-rise.db" ] && cp "${APP_DIR}/server/db/fantasyyc-rise.db" "${TEMP_DIR}/fantasyyc-rise.db"

    git clone "$REPO" "${APP_DIR}_tmp"
    cp -a "${APP_DIR}_tmp/." "${APP_DIR}/"
    rm -rf "${APP_DIR}_tmp"

    [ -f "${TEMP_DIR}/.env" ] && cp "${TEMP_DIR}/.env" "${APP_DIR}/.env"
    [ -f "${TEMP_DIR}/fantasyyc-rise.db" ] && mkdir -p "${APP_DIR}/server/db" && cp "${TEMP_DIR}/fantasyyc-rise.db" "${APP_DIR}/server/db/fantasyyc-rise.db"
    rm -rf "$TEMP_DIR"
fi

log "Code synced from GitHub"

###############################################################################
# STEP 5: Environment variables
###############################################################################
step "5/10 — Configuring environment"

if [ -f "$ENV_FILE" ]; then
    log "Environment file found at ${ENV_FILE}"
else
    err "Environment file not found at ${ENV_FILE}
Create it manually before running this script:

  sudo mkdir -p ${APP_DIR}
  sudo nano ${ENV_FILE}

Required variables:
  NODE_ENV=production
  PORT=3007
  PRIVATE_KEY=<your_blockchain_signing_key>
  ADMIN_API_KEY=<your_admin_api_key>
  SCORE_HMAC_SECRET=<your_hmac_secret>
  SERVER_URL=https://${DOMAIN}/metadata
  NFT_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000
  RPC_URL=https://testnet.riselabs.xyz"
fi

chmod 600 "$ENV_FILE"
chown "$APP_USER":"$APP_USER" "$ENV_FILE"

###############################################################################
# STEP 6: Install dependencies & build
###############################################################################
step "6/10 — Installing dependencies & building frontend"

log "Installing server dependencies..."
cd "${APP_DIR}/server"
npm ci --production --silent 2>&1 | tail -1 || npm install --production --silent 2>&1 | tail -1
log "Server deps installed"

log "Installing metadata server dependencies..."
cd "${APP_DIR}/backend"
npm ci --production --silent 2>&1 | tail -1 || npm install --production --silent 2>&1 | tail -1
log "Metadata deps installed"

log "Building frontend..."
cd "${APP_DIR}/front"
npm ci --silent 2>&1 | tail -1 || npm install --silent 2>&1 | tail -1
npm run build
log "Frontend built at ${APP_DIR}/front/dist"

chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

###############################################################################
# STEP 7: Configure nginx
###############################################################################
step "7/10 — Configuring nginx"

NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"

if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    log "No SSL cert yet — installing temporary HTTP config for certbot..."
    cat > "$NGINX_CONF" << TMPNGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
        allow all;
    }

    location / {
        return 200 'FantasyYC RISE setup in progress...';
        add_header Content-Type text/plain;
    }
}
TMPNGINX
else
    log "SSL cert exists — installing full nginx config..."
    cp "${APP_DIR}/deploy/nginx.conf" "$NGINX_CONF"
fi

ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx
log "nginx configured and reloaded"

###############################################################################
# STEP 8: SSL Certificate (Let's Encrypt)
###############################################################################
step "8/10 — SSL Certificate"

if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    log "SSL certificate already exists for ${DOMAIN}"
    EXPIRY=$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" | cut -d= -f2)
    log "Certificate expires: ${EXPIRY}"
    certbot renew --quiet --no-self-upgrade 2>/dev/null || true
else
    log "Requesting SSL certificate for ${DOMAIN}..."
    certbot certonly \
        --webroot \
        --webroot-path="$CERTBOT_WEBROOT" \
        --domain "$DOMAIN" \
        --non-interactive \
        --agree-tos \
        --email "admin@unicornx.fun" \
        --no-eff-email

    if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
        log "SSL certificate obtained!"
        cp "${APP_DIR}/deploy/nginx.conf" "$NGINX_CONF"
        nginx -t
        systemctl reload nginx
        log "nginx updated with SSL config"
    else
        err "Failed to obtain SSL certificate. Check DNS: dig ${DOMAIN} should point to this server's IP."
    fi
fi

systemctl enable --now certbot.timer 2>/dev/null || true

###############################################################################
# STEP 9: Install systemd services
###############################################################################
step "9/10 — Installing systemd services"

cp "${APP_DIR}/deploy/fantasyyc-api.service" /etc/systemd/system/
cp "${APP_DIR}/deploy/fantasyyc-metadata.service" /etc/systemd/system/

systemctl daemon-reload

systemctl enable fantasyyc-api
systemctl enable fantasyyc-metadata

systemctl stop fantasyyc-api 2>/dev/null || true
systemctl stop fantasyyc-metadata 2>/dev/null || true
sleep 2
fuser -k 3007/tcp 2>/dev/null || true
fuser -k 3006/tcp 2>/dev/null || true
sleep 1

systemctl start fantasyyc-api
systemctl start fantasyyc-metadata

log "Services installed and started"

sleep 3

for svc in fantasyyc-api fantasyyc-metadata; do
    if systemctl is-active --quiet "$svc"; then
        log "${svc}: RUNNING"
    else
        warn "${svc}: NOT RUNNING — check: journalctl -u ${svc} -n 50"
    fi
done

###############################################################################
# STEP 10: Cron jobs & log rotation
###############################################################################
step "10/10 — Cron jobs & log rotation"

chmod +x "${APP_DIR}/deploy/backup-db.sh"
chmod +x "${APP_DIR}/deploy/healthcheck.sh"

CRON_TAG="# fantasyyc-managed"
(crontab -l 2>/dev/null | grep -v "$CRON_TAG") | {
    cat
    echo "0 3 * * * ${APP_DIR}/deploy/backup-db.sh ${CRON_TAG}"
    echo "*/5 * * * * ${APP_DIR}/deploy/healthcheck.sh ${CRON_TAG}"
} | crontab -

log "Cron installed: DB backup (03:00 daily), health check (every 5min)"

cp "${APP_DIR}/deploy/logrotate.conf" /etc/logrotate.d/fantasyyc
log "Log rotation configured"

###############################################################################
# Verification
###############################################################################
step "Deployment Complete!"

echo ""
log "Domain: https://${DOMAIN}"
log "API:    https://${DOMAIN}/api/tournaments/active"
log "Meta:   https://${DOMAIN}/metadata/1"
echo ""

API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:3007/health" 2>/dev/null || echo "000")
META_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:3006/metadata/1" 2>/dev/null || echo "000")

echo -e "  ${CYAN}RISE Chain:${NC}"
echo -e "  API health:           ${API_STATUS} $([ "$API_STATUS" = "200" ] && echo "${GREEN}OK${NC}" || echo "${RED}FAIL${NC}")"
echo -e "  Metadata health:      ${META_STATUS} $([ "$META_STATUS" = "200" ] && echo "${GREEN}OK${NC}" || echo "${RED}FAIL${NC}")"
echo ""

echo -e "${CYAN}Useful commands:${NC}"
echo "  sudo bash /opt/fantasyyc/scripts/update.sh  # Update from GitHub"
echo "  systemctl status fantasyyc-api         # API status"
echo "  systemctl status fantasyyc-metadata    # Metadata status"
echo "  journalctl -u fantasyyc-api -f         # API logs (live)"
echo "  journalctl -u fantasyyc-metadata -f    # Metadata logs (live)"
echo "  systemctl restart fantasyyc-api        # Restart API"
echo "  systemctl restart fantasyyc-metadata   # Restart metadata"
echo "  nginx -t && systemctl reload nginx     # Reload nginx"
echo "  certbot renew --dry-run                # Test cert renewal"
echo "  ls /opt/fantasyyc/backups/             # DB backups"
echo "  cat /opt/fantasyyc/logs/healthcheck.log # Health check log"
echo ""
echo -e "${YELLOW}If services fail, check:${NC}"
echo "  - Secrets in ${ENV_FILE}"
echo "  - DNS: dig ${DOMAIN} → should return this server's IP"
echo "  - Firewall: ports 80, 443 open"
echo ""
