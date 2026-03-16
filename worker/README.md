# Asset Tracker — Plaid Proxy Worker

A lightweight Cloudflare Worker that proxies Plaid API calls so the static frontend never exposes Plaid credentials.

## Prerequisites

1. [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
2. [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/): `npm install -g wrangler`
3. [Plaid developer account](https://dashboard.plaid.com/signup) + an Application with **Investments** product enabled

## Setup

### 1. Create KV namespace

```bash
cd worker
wrangler login
wrangler kv:namespace create PLAID_ITEMS
```

Copy the `id` from the output and paste it into `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "PLAID_ITEMS"
id = "paste-id-here"
```

### 2. Set secrets

```bash
wrangler secret put PLAID_CLIENT_ID    # from Plaid dashboard
wrangler secret put PLAID_SECRET       # from Plaid dashboard (Development or Production)
wrangler secret put WORKER_API_KEY     # any random string you choose, e.g. openssl rand -hex 32
```

By default the Worker uses Plaid **Sandbox** (simulated data). To use real accounts, also set:
```bash
wrangler secret put PLAID_ENV          # value: "production"
```

### 3. Deploy

```bash
wrangler deploy
```

The Worker URL will be printed, e.g. `https://asset-tracker-plaid.<your-subdomain>.workers.dev`

## Configure the App

In the app's **Settings → 账户同步** section:
- **Worker URL**: the URL from step 3
- **API Key**: the value you set for `WORKER_API_KEY`

Then click **添加账户** to link your first institution via Plaid Link.

## Plaid Sandbox Test Credentials

For testing (Sandbox mode):
- Username: `user_good`
- Password: `pass_good`

## API Endpoints

All endpoints require `X-Api-Key: <WORKER_API_KEY>` header.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/link-token` | Create a Plaid link_token to initialize Plaid Link |
| POST | `/exchange` | Exchange public_token for access_token (stored in KV) |
| GET | `/accounts` | Fetch real-time balances for all linked accounts |
| GET | `/items` | List connected institutions (no sensitive data) |
| DELETE | `/item/:itemId` | Remove a linked institution |
