#!/bin/bash
###############################################################################
# FantasyYC — Quick Update from GitHub (RISE Chain)
#
# Usage: sudo bash /opt/fantasyyc/scripts/update.sh
#
# What it does:
#   1. git pull from GitHub
#   2. npm ci for server & backend (if package.json changed)
#   3. npm run build for frontend (if front/ changed)
#   4. Sync contract addresses from deployment file into .env
#   5. Restart services
#   6. Verify metadata server uses correct contract
#
# Safe to run anytime. Does NOT touch: database, SSL, nginx.
###############################################################################

set -euo pipefail

APP_DIR="/opt/fantasyyc"
REPO="https://github.com/egorble/fantasyyc-rise.git"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[UPDATE]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
    err "Run as root: sudo bash $0"
fi

git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true

# ─── Ensure remote is set correctly ───
if [ -d "${APP_DIR}/.git" ]; then
    cd "${APP_DIR}"
    CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
    if [ "$CURRENT_REMOTE" != "$REPO" ]; then
        git remote remove origin 2>/dev/null || true
        git remote add origin "$REPO"
        log "Fixed remote origin → $REPO"
    fi
fi

# ─── Check if repo exists, clone or pull ───
if [ ! -d "${APP_DIR}/.git" ]; then
    log "First time setup — cloning repo..."
    TEMP_DIR=$(mktemp -d)
    [ -f "${APP_DIR}/.env" ] && cp "${APP_DIR}/.env" "${TEMP_DIR}/.env"
    [ -f "${APP_DIR}/server/db/fantasyyc-rise.db" ] && cp "${APP_DIR}/server/db/fantasyyc-rise.db" "${TEMP_DIR}/fantasyyc-rise.db"

    rm -rf "${APP_DIR:?}/.git"
    cd "${APP_DIR}"
    git init
    git remote add origin "$REPO"
    git fetch origin main
    git checkout -f main

    [ -f "${TEMP_DIR}/.env" ] && cp "${TEMP_DIR}/.env" "${APP_DIR}/.env"
    [ -f "${TEMP_DIR}/fantasyyc-rise.db" ] && mkdir -p "${APP_DIR}/server/db" && cp "${TEMP_DIR}/fantasyyc-rise.db" "${APP_DIR}/server/db/fantasyyc-rise.db"
    rm -rf "$TEMP_DIR"

    log "Repo cloned"
else
    log "Pulling latest changes..."
    cd "${APP_DIR}"
    git fetch origin main
    git reset --hard origin/main
    log "Pull complete"
fi

echo ""
log "Recent commits:"
git log --oneline -5
echo ""

# ─── Install server deps ───
log "Installing server dependencies..."
cd "${APP_DIR}/server"
npm ci --production --silent 2>&1 | tail -3 || npm install --production --silent 2>&1 | tail -3

# ─── Install backend deps ───
log "Installing metadata server dependencies..."
cd "${APP_DIR}/backend"
npm ci --production --silent 2>&1 | tail -3 || npm install --production --silent 2>&1 | tail -3

# ─── Build frontend ───
log "Building frontend..."
cd "${APP_DIR}/front"
npm ci --silent 2>&1 | tail -3 || npm install --silent 2>&1 | tail -3
npm run build
log "Frontend built"

# ─── Sync contract addresses from deployment file into .env ───
DEPLOY_FILE="${APP_DIR}/deployment-rise.json"
ENV_FILE="${APP_DIR}/.env"
BACKEND_ENV="${APP_DIR}/backend/.env"

if [ ! -f "$ENV_FILE" ] && [ -f "$BACKEND_ENV" ]; then
    cp "$BACKEND_ENV" "$ENV_FILE"
    log "Created ${ENV_FILE} from backend/.env"
fi

NEW_NFT_ADDR=""
if [ -f "$DEPLOY_FILE" ]; then
    NEW_NFT_ADDR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${DEPLOY_FILE}','utf8')).proxies.UnicornX_NFT || '')" 2>/dev/null || echo "")
fi
if [ -z "$NEW_NFT_ADDR" ] && [ -f "$BACKEND_ENV" ]; then
    NEW_NFT_ADDR=$(grep -oP '(?<=NFT_CONTRACT_ADDRESS=).*' "$BACKEND_ENV" 2>/dev/null || echo "")
    [ -n "$NEW_NFT_ADDR" ] && log "Using NFT address from backend/.env (deployment file not found)"
fi

if [ -n "$NEW_NFT_ADDR" ] && [ -f "$ENV_FILE" ]; then
    OLD_NFT_ADDR=$(grep -oP '(?<=NFT_CONTRACT_ADDRESS=).*' "$ENV_FILE" 2>/dev/null || echo "")

    if [ "$OLD_NFT_ADDR" != "$NEW_NFT_ADDR" ]; then
        if grep -q "^NFT_CONTRACT_ADDRESS=" "$ENV_FILE"; then
            sed -i "s|^NFT_CONTRACT_ADDRESS=.*|NFT_CONTRACT_ADDRESS=${NEW_NFT_ADDR}|" "$ENV_FILE"
        else
            echo "NFT_CONTRACT_ADDRESS=${NEW_NFT_ADDR}" >> "$ENV_FILE"
        fi
        log "Updated NFT_CONTRACT_ADDRESS: ${OLD_NFT_ADDR:-<unset>} → ${NEW_NFT_ADDR}"
    else
        log "NFT_CONTRACT_ADDRESS already correct: ${NEW_NFT_ADDR}"
    fi
elif [ -z "$NEW_NFT_ADDR" ]; then
    warn "Could not determine NFT_CONTRACT_ADDRESS from deployment file or backend/.env"
elif [ ! -f "$ENV_FILE" ]; then
    warn ".env not found at ${ENV_FILE} — creating with NFT address"
    echo "NFT_CONTRACT_ADDRESS=${NEW_NFT_ADDR}" > "$ENV_FILE"
fi

# ─── Fix ownership ───
chown -R fantasyyc:fantasyyc "${APP_DIR}"

# ─── Stop services, kill stale processes, then start clean ───
log "Stopping services..."
systemctl stop fantasyyc-api 2>/dev/null || true
systemctl stop fantasyyc-metadata 2>/dev/null || true
sleep 2

# Kill any leftover node processes on our ports
fuser -k 3007/tcp 2>/dev/null || true
fuser -k 3006/tcp 2>/dev/null || true
sleep 1

log "Starting services..."
systemctl start fantasyyc-api
systemctl start fantasyyc-metadata

# ─── Reload nginx config ───
if [ -f "${APP_DIR}/deploy/nginx.conf" ]; then
    log "Updating nginx config..."
    cp "${APP_DIR}/deploy/nginx.conf" /etc/nginx/sites-available/fantasyyc
    if nginx -t 2>/dev/null; then
        systemctl reload nginx
        log "Nginx reloaded"
    else
        warn "Nginx config test failed — skipping reload"
    fi
fi

sleep 3

# ─── Verify ───
API_OK=$(systemctl is-active fantasyyc-api)
META_OK=$(systemctl is-active fantasyyc-metadata)
NGINX_OK=$(systemctl is-active nginx)

echo ""
echo -e "  ${CYAN}RISE Chain:${NC}"
echo -e "  fantasyyc-api:              ${API_OK} $([ "$API_OK" = "active" ] && echo "${GREEN}OK${NC}" || echo "${RED}FAIL${NC}")"
echo -e "  fantasyyc-metadata:         ${META_OK} $([ "$META_OK" = "active" ] && echo "${GREEN}OK${NC}" || echo "${RED}FAIL${NC}")"
echo -e "  ${CYAN}Infra:${NC}"
echo -e "  nginx:                      ${NGINX_OK} $([ "$NGINX_OK" = "active" ] && echo "${GREEN}OK${NC}" || echo "${RED}FAIL${NC}")"

# ─── Verify metadata server uses correct contract ───
if [ -f "$DEPLOY_FILE" ]; then
    EXPECTED_ADDR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${DEPLOY_FILE}','utf8')).proxies.UnicornX_NFT || '')" 2>/dev/null || echo "")
    ACTUAL_ADDR=$(curl -s --max-time 5 "http://127.0.0.1:3006/" 2>/dev/null | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).contract)}catch{console.log('?')}})" 2>/dev/null || echo "?")

    if [ "$ACTUAL_ADDR" = "$EXPECTED_ADDR" ]; then
        echo -e "  metadata contract:  ${GREEN}OK${NC} (${ACTUAL_ADDR})"
    else
        echo -e "  metadata contract:  ${RED}MISMATCH${NC}"
        echo -e "    expected: ${EXPECTED_ADDR}"
        echo -e "    actual:   ${ACTUAL_ADDR}"
        warn "Metadata server may be using wrong contract! Check /opt/fantasyyc/.env"
    fi
fi

echo ""
log "Update complete!"
