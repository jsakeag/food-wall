#!/usr/bin/env bash
# Build the web app, copy everything to the Droplet and restart. Run from your Mac:
#   ./deploy/deploy.sh <droplet-ip>
# The first time, it stops after copying and tells you to run setup.sh.
set -euo pipefail

HOST="root@${1:?usage: deploy.sh <droplet-ip>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building web app"
# The web app talks to /api on its own domain and never has the key built in (it asks for the passcode).
(cd "$ROOT/app" && EXPO_PUBLIC_API_URL=/api EXPO_PUBLIC_API_KEY= npx expo export --platform web --output-dir dist --clear)

echo "==> Copying"
ssh "$HOST" mkdir -p /opt/mock-beli/web
rsync -az --delete \
	--exclude node_modules --exclude .env --exclude uploads \
	"$ROOT/server" "$ROOT/deploy" "$HOST:/opt/mock-beli/"
rsync -az --delete "$ROOT/app/dist/" "$HOST:/opt/mock-beli/web/"

if ssh "$HOST" test -f /etc/systemd/system/mock-beli.service; then
	ssh "$HOST" 'set -e
		cd /opt/mock-beli/server && npm ci --omit=dev && systemctl restart mock-beli
		sed "s/{\$DOMAIN}/$(cat /etc/mock-beli-domain)/" /opt/mock-beli/deploy/Caddyfile > /etc/caddy/Caddyfile
		systemctl reload caddy
		systemctl is-active mock-beli'
else
	echo "Copied. First-time setup — run:"
	echo "  ssh $HOST 'bash /opt/mock-beli/deploy/setup.sh \"Keagan,Michelle\"'"
fi
