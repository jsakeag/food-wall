#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 DigitalOcean Droplet. Run as root ON THE DROPLET:
#   bash /opt/mock-beli/deploy/setup.sh "Alex,Sam"
# (deploy.sh copies this repo to /opt/mock-beli first.) Safe to re-run.
set -euo pipefail

PEOPLE="${1:?usage: setup.sh \"Name1,Name2\"}"
APP_DIR=/opt/mock-beli
DATA_DIR=/var/lib/mock-beli
IP=$(curl -fsS http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address)
DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"   # free hostname that resolves to this IP, so Caddy can get HTTPS

echo "==> Waiting for first-boot updates to finish"
cloud-init status --wait >/dev/null 2>&1 || true
# (unattended-upgrade-shutdown idles forever, so only wait on real apt runs; the dpkg lock timeouts below cover the rest)
while pgrep -x apt-get >/dev/null || pgrep -x apt >/dev/null; do
	sleep 5
done

echo "==> Swap (safety net for small Droplets)"
if ! swapon --show | grep -q .; then
	fallocate -l 1G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Packages"
apt-get -o DPkg::Lock::Timeout=300 update
apt-get -o DPkg::Lock::Timeout=300 install -y ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https ufw postgresql
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
	curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
	apt-get -o DPkg::Lock::Timeout=300 install -y nodejs
fi
if ! command -v caddy >/dev/null; then
	curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
	apt-get -o DPkg::Lock::Timeout=300 update
	apt-get -o DPkg::Lock::Timeout=300 install -y caddy
fi

echo "==> App user, database, folders"
id mockbeli >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin mockbeli
mkdir -p "$DATA_DIR/uploads" /var/backups/mock-beli
chown -R mockbeli:mockbeli "$DATA_DIR"
# Peer auth: the "mockbeli" Linux user connects as the "mockbeli" Postgres role, no password.
sudo -u postgres psql -tc "select 1 from pg_roles where rolname = 'mockbeli'" | grep -q 1 \
	|| sudo -u postgres createuser mockbeli
sudo -u postgres psql -tc "select 1 from pg_database where datname = 'mock_beli'" | grep -q 1 \
	|| sudo -u postgres createdb -O mockbeli mock_beli

echo "==> Server config"
ENV_FILE="$APP_DIR/server/.env"
if [ ! -f "$ENV_FILE" ]; then
	cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgres:///mock_beli?host=/var/run/postgresql
API_KEY=$(openssl rand -hex 6)
PEOPLE=$PEOPLE
PORT=3000
UPLOAD_DIR=$DATA_DIR/uploads
EOF
fi
chown mockbeli:mockbeli "$ENV_FILE"
chmod 600 "$ENV_FILE"
(cd "$APP_DIR/server" && npm ci --omit=dev)

echo "==> Service"
cp "$APP_DIR/deploy/mock-beli.service" /etc/systemd/system/mock-beli.service
systemctl daemon-reload
systemctl enable --now mock-beli
systemctl restart mock-beli

echo "==> HTTPS (Caddy) and firewall"
echo "$DOMAIN" > /etc/mock-beli-domain
mkdir -p "$APP_DIR/web"
sed "s/{\$DOMAIN}/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

echo "==> Nightly database backup (keeps 14 days)"
cat > /etc/cron.d/mock-beli-backup <<'EOF'
30 3 * * * postgres pg_dump -Fc mock_beli > /var/backups/mock-beli/mock_beli-$(date +\%F).dump && find /var/backups/mock-beli -name '*.dump' -mtime +14 -delete
EOF
chown postgres:postgres /var/backups/mock-beli

PASSCODE=$(grep '^API_KEY=' "$ENV_FILE" | cut -d= -f2)
echo
echo "Done. On each iPhone: open https://$DOMAIN in Safari -> Share -> Add to Home Screen."
echo "  Passcode: $PASSCODE"
echo
echo "For the Expo Go app instead, put these in app/.env on your Mac:"
echo "  EXPO_PUBLIC_API_URL=https://$DOMAIN/api"
echo "  EXPO_PUBLIC_API_KEY=$PASSCODE"
