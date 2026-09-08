# Going live on a Google Cloud VM

One small virtual machine runs everything: the API (with ffmpeg and the ClickHouse MCP), the web app, and Caddy for automatic HTTPS. ClickHouse Cloud stays where it is. Photos, pictures, clips, accounts and profiles live on the VM's disk in a Docker volume, so they survive restarts.

## 1. Create the VM (Google Cloud Console)

Compute Engine → VM instances → **Create instance**

- Name `previewpal`, region `us-central1`, machine type **e2-medium**
- Boot disk: **Ubuntu 24.04 LTS**, 30 GB
- Firewall: tick **Allow HTTP traffic** and **Allow HTTPS traffic**

Copy the **External IP** once it is running.

## 2. Give it a hostname

HTTPS needs a hostname. Free and quick: <https://www.duckdns.org> → sign in → add a subdomain, e.g. `previewpal` → paste the VM's IP. Your address is then `https://previewpal.duckdns.org`.
(Alternative without any sign-up: `https://previewpal.<IP with dashes>.nip.io`, but its shared certificate limits can fail; DuckDNS is safer.)

## 3. On the VM

Click **SSH** next to the VM in the console — the prompt must read `…@previewpal`, not `…@cloudshell`; Cloud Shell is a different, throwaway machine — and paste, one block at a time:

```bash
# Docker
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
. /etc/os-release   # $ID and $VERSION_CODENAME: works on Ubuntu and Debian alike
curl -fsSL https://download.docker.com/linux/$ID/gpg | sudo gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
```

```bash
# 2 GB of swap: the Next.js build needs more memory than an e2-medium has.
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

```bash
# The app (the repository must be public, or the clone will ask for credentials)
git clone https://github.com/ParishruthiGanesh/Agentic_Cinema.git
cd Agentic_Cinema
git checkout claude/cinemory-hackathon-build-hp9mep   # or main once merged
cp .env.example .env
nano .env
```

In `.env` set these lines (leave the rest):

```
GEMINI_API_KEY=<your key>
GEMINI_TEXT_MODEL=gemini-3.6-flash,gemini-3.7-flash,gemini-3.8-flash,gemini-3.5-flash,gemini-3-flash-preview
CLICKHOUSE_URL=https://<your service>.clickhouse.cloud:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=<your password>
CLICKHOUSE_DATABASE=cinememory
PUBLIC_URL=https://previewpal.duckdns.org
PUBLIC_HOST=previewpal.duckdns.org
# optional
GOOGLE_OAUTH_CLIENT_ID=<client id>   # add PUBLIC_URL to its authorised origins in Google Cloud Console
```

Save (Ctrl+O, Enter, Ctrl+X), then:

```bash
docker compose --env-file .env -f deploy/compose.yml up -d --build
```

`--env-file .env` matters: without it Compose looks for an `.env` next to `compose.yml` and the web
app would be built with an empty API address.

The first build takes 5–10 minutes. Then open your address. Caddy fetches the certificate on the first request (give it up to a minute).

## 4. Check

```bash
curl -s https://previewpal.duckdns.org/api/health
docker compose --env-file .env -f deploy/compose.yml logs -f api   # Ctrl+C to stop following
```

## Updating

```bash
cd ~/Agentic_Cinema && git pull && docker compose --env-file .env -f deploy/compose.yml up -d --build
```

## Notes

- Data lives in the Docker volume `data` (SQLite + media). `docker compose down` keeps it; `docker compose down -v` deletes it.
- The studio is reachable at `/studio` on the same address; it is not linked from the family app.
- Turn **idle scaling off** on the ClickHouse Cloud service while you demo: the API refuses to start while the service is asleep.
- Delete the VM after the hackathon to stop the charge (about $25/month for e2-medium).
