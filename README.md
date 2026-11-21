# Redora — hospital inventory management

Track medicines, consumables, surgical supplies, PPE and equipment: stock levels by batch and expiry, low-stock and expiry alerts, suppliers, department issues, and a permanent history of every movement.

**Stack:** Node.js 22.5+ · Express · SQLite (built into Node, no native modules) · plain HTML/CSS/JS frontend. One small dependency (`express`).

> Redora stores **inventory only** — no patient data. Keep it that way unless you add proper privacy and security controls.

## Features

- **Items** with category, unit, reorder level, storage location, default supplier
- **Batch & expiry tracking** — every delivery is a batch; stock is issued **first-expiry-first-out**, and expired stock can never be issued
- **Alerts** on the dashboard: low stock, out of stock, expiring within 90 days, expired stock still on shelves
- **Receive stock** (with invoice/PO number, cost, supplier) and **Issue stock** to departments (with requisition number)
- **Write-offs** (expired/damaged) and admin **count corrections**, all logged
- **History** with filters + **CSV export** (stock list and movements)
- **Suppliers**, **departments**, **users** with two roles: *Staff* and *Administrator*
- Secure sign-in (scrypt password hashing, HttpOnly session cookies, login rate limiting)

## Run locally

```bash
npm install
npm run demo     # loads sample hospital data, then starts the server
# open http://localhost:3000   →  admin / Redora@123   (or staff / Redora@123)
```

For a clean, empty system use `npm start` instead. On the first start Redora creates an `admin` account and prints a random password in the console **once** — copy it, sign in, and change it under Settings. (Or set `ADMIN_USERNAME` / `ADMIN_PASSWORD` before the first start.)

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on (hosts usually set this) |
| `DATA_DIR` | `./data` | Folder for the database — **must be on persistent storage** |
| `ADMIN_USERNAME` | `admin` | First admin's username (only used when no users exist) |
| `ADMIN_PASSWORD` | random | First admin's password (only used when no users exist) |
| `EXPIRY_WARN_DAYS` | `90` | How far ahead "expiring soon" looks |
| `NODE_ENV` | — | Set to `production` online (makes cookies HTTPS-only) |

## Deploy

Redora keeps its data in a SQLite file, so the host **must give you a persistent disk/volume** — otherwise data is lost on every redeploy. Any of these work:

- **Railway** — New Project → Deploy from GitHub → add a *Volume* mounted at `/data` → set `DATA_DIR=/data`, `NODE_ENV=production`, `ADMIN_PASSWORD=…`
- **Fly.io** — `fly launch` (uses the included `Dockerfile`), `fly volumes create data`, mount it at `/data`
- **Render** — Web Service with a paid *Disk* mounted at `/data` (free tier has no disk), same env vars
- **Your own server / VPS** — `npm install && NODE_ENV=production DATA_DIR=/var/lib/redora node server.js` behind nginx or Caddy with HTTPS, kept alive with systemd or pm2
- **Docker anywhere** — `docker build -t redora . && docker run -p 3000:3000 -v redora-data:/data -e ADMIN_PASSWORD=… redora`

Health check URL: `/api/health`. Always serve over **HTTPS** in production (all the hosts above do this for you).

**Back up** the `DATA_DIR` folder regularly (copy `redora.db`, or schedule your host's volume snapshots).

## Good practice for a real hospital rollout

- Create one account per person; disable accounts when staff leave
- Use a strong admin password and give most people the *Staff* role
- Do a stock count first and enter opening balances via *Receive stock* with a reference like `OPENING`
- Run the demo (`npm run demo`) **only** on a throwaway database

## Project layout

```
server.js      API + auth + business rules (FEFO issuing, validation)
db.js          SQLite schema and password hashing
seed-demo.js   optional sample data
public/        the web app (index.html, style.css, app.js)
```
