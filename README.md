# mock-beli

Beli, but for recipes you've cooked. Two people share one list; each recipe's score is the average of both people's ratings.

```
app/      Expo (React Native) app — one screen: shared list (recent / top), + to log.
          Ships as a home-screen web app (Safari → Add to Home Screen); also runs in Expo Go.
server/   Node + Express + Postgres API, photos saved to disk
deploy/   DigitalOcean Droplet setup (Postgres, Caddy HTTPS, systemd, nightly backups)
```

How ranking works: each person rates a recipe by picking Loved / Fine / Didn't like, then answering
"Which was better?" against their own ratings in that bucket (binary search, ~log₂ n taps). A person's
score = position within the bucket's range (Loved 7–10, Fine 4–7, Didn't like 0–4); the recipe's score
is the average of both people's scores. Logging a recipe rates it for you; the other person taps "rate it".

## Run locally

Needs Node 24+ and Postgres.

```bash
# server
createdb mock_beli
cd server && cp .env.example .env   # set API_KEY and PEOPLE
npm install && npm run dev

# app (in another terminal)
cd app && cp .env.example .env      # API URL = your Mac's Wi-Fi IP, e.g. http://192.168.1.20:3000
npm install && npx expo start
```

Scan the QR code with the iPhone Camera app to open it in **Expo Go** (phone and Mac on the same Wi-Fi),
or press `w` and open `http://<your Mac's IP>:8081` in Safari to try the web version (its passcode is
`API_KEY` from `server/.env`). Find your Mac's IP with `ipconfig getifaddr en0`.

## Deploy (DigitalOcean)

1. Create a $6 Ubuntu 24.04 Droplet and add your SSH key.
2. From your Mac:
   ```bash
   ./deploy/deploy.sh <droplet-ip>
   ssh root@<droplet-ip> 'bash /opt/mock-beli/deploy/setup.sh "Keagan,Michelle"'
   ```
   It prints the site's address (an HTTPS `*.sslip.io` URL) and the passcode.
3. On each iPhone: open the address in **Safari** → Share → **Add to Home Screen**, then enter the
   passcode and pick your name. It opens full screen with the nailong icon.
4. Later updates: `./deploy/deploy.sh <droplet-ip>` (rebuilds the web app, updates the server).

The Droplet serves the web app at `/` and the API at `/api` (see `deploy/Caddyfile`).

Backups land in `/var/backups/mock-beli` on the Droplet nightly. Turn on DigitalOcean's Droplet
backups too if you want copies off the machine (photos live in `/var/lib/mock-beli/uploads`).

## Using the app

- First launch asks for the passcode (web only) and "Who are you?". Tap your initial in the header to switch.
- **+** logs a recipe; **rate it** adds your rating to one the other person logged.
- **•••** on a recipe (or long-press it) to edit details, redo your rating, or delete it.

## Old food-gallery data

The Supabase backup lives in `data/supabase-backup/` (gitignored). Posts become unrated recipes with
their original photo and date; re-running skips ones already imported.

Locally, from `server/`:
```bash
node --env-file=.env scripts/import-supabase.ts \
  ../data/supabase-backup/db_cluster-22-10-2025@09-10-40.backup \
  ../data/supabase-backup/vlerrqzskxttyldnqfbe/images \
  "jsakeag=Keagan,mmli1=Michelle"
```

On the Droplet (after setup), from your Mac:
```bash
rsync -az --exclude '*.zip' --exclude '*.gz' data/supabase-backup root@<droplet-ip>:/opt/mock-beli/data/
ssh root@<droplet-ip> "sudo -u mockbeli bash -c 'cd /opt/mock-beli/server && node --env-file=.env scripts/import-supabase.ts \
  ../data/supabase-backup/db_cluster-22-10-2025@09-10-40.backup ../data/supabase-backup/vlerrqzskxttyldnqfbe/images \
  \"jsakeag=Keagan,mmli1=Michelle\"'"
```
