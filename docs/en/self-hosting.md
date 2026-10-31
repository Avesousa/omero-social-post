# Self-hosting: from zero to a connected X channel

> **Status:** stage 1 (`mvp/core-publishing`) is in progress. This guide describes the planned flow. Steps marked _(to confirm)_ will be checked in the owner's end-to-end dry run (T040). Versión en español: [self-hosting.md](../es/self-hosting.md).

Follow the steps in order to go from an empty VPS to a connected X channel.

## 1. Prerequisites

- A VPS running **Ubuntu 24.04** (target: 1 vCPU / 4 GB) with SSH access using your public key. If your VPS is a Hostinger template with Traefik, first follow section 0 of [infra/README.md](../../infra/README.md).
- A **Tailscale** account and at least one device to open the app from.
- An app on the **X Developer Portal** ([developer.x.com](https://developer.x.com)) with credits loaded. The X API is pay-per-use.
- A **LinkedIn** account with a **Company Page** associated with the app. Create a minimal one if you do not have one.
- Optional: a Telegram account for notifications.

You do not need Docker or Node on the VPS. `bootstrap.sh` installs Docker and Tailscale, and the images are pulled from GHCR. The VPS never builds anything.

## 2. VPS and bootstrap

Follow [infra/README.md](../../infra/README.md) up to section 2: `bootstrap.sh` and the files in `/opt/omero`. We do not repeat those steps here. You fill in `.env` in step 7.

## 3. Tailscale

1. In the [Tailscale DNS page](https://login.tailscale.com/admin/dns), enable **MagicDNS** and **HTTPS Certificates**.
2. Join the server to your tailnet with `bootstrap.sh` and `TS_AUTHKEY`, or with `sudo tailscale up --ssh --hostname=omero`. Disable _key expiry_ for that server.
3. Your URL will be `https://omero.<tailnet>.ts.net`. The `<tailnet>` part is on the same DNS page. Confirm it at the end with `tailscale serve status`.

Nothing is public: do not use Funnel. OAuth redirects happen in your browser, which is on the tailnet. Details in [infra/tailscale/README.md](../../infra/tailscale/README.md).

## 4. X app

1. On the [X Developer Portal](https://developer.x.com), create an app.
2. Enable **OAuth 2.0** with type **Web App / Confidential client** and **Read and Write** permissions.
3. Under _User authentication settings_, register the callback URI:
   `https://omero.<tailnet>.ts.net/api/v1/channels/x/callback`
4. Load credits. Approximate prices: $0.015 per post, $0.20 per post containing a link, $0.005 per read. The composer warns you when an X post has a link, because it costs more.
5. Copy the Client ID and Client Secret into `X_CLIENT_ID` and `X_CLIENT_SECRET`.

The app requests these scopes: `tweet.read tweet.write users.read media.write offline.access`.

## 5. LinkedIn app

1. Associate the app with a Company Page. Create a minimal one if needed.
2. On [LinkedIn Developers](https://www.linkedin.com/developers), create the app.
3. Under _Products_, add **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**.
4. Under _Auth_ → _Authorized redirect URLs_, register: `https://omero.<tailnet>.ts.net/api/v1/channels/linkedin/callback`
5. Copy the Client ID and Client Secret into `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.

The app requests `openid profile w_member_social`. LinkedIn access tokens last about 60 days, and self-serve apps get no refresh token, so you reconnect roughly every 60 days (see [troubleshooting](#9-troubleshooting)).

## 6. Telegram bot (optional)

1. Create a bot with @BotFather. Save the token in `TELEGRAM_BOT_TOKEN`.
2. Send a message to your bot.
3. Get your chat id from @userinfobot, or by opening `https://api.telegram.org/bot<token>/getUpdates` in a browser. Save it in `TELEGRAM_CHAT_ID`. That URL contains the token, so do not share it.

Without these two variables, notifications stay in the app.

## 7. Fill in `.env`

Edit `/opt/omero/.env`, which you copied in section 2:

```sh
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -hex 24      # POSTGRES_PASSWORD, and the same value in DATABASE_URL
```

- `ENCRYPTION_KEY` encrypts OAuth tokens. Keep a copy off the server (in a password manager). If it is lost, every channel must be reconnected.
- `PUBLIC_BASE_URL=https://omero.<tailnet>.ts.net`, with no trailing slash, identical to the URL in your browser.
- `X_CLIENT_ID` and `X_CLIENT_SECRET`, or `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`. Set each pair completely. If one half of a pair is missing, the API will not start.
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, optional and also set as a pair.
- `chmod 600 /opt/omero/.env`.

Each variable is described in [configuration.md](configuration.md).

## 8. First start, owner and channels

1. From `/opt/omero`, run `docker compose pull && docker compose up -d`. If the GHCR images are still private, log in first (see step 3 of [infra/README.md](../../infra/README.md)).
2. Wait until all four services show `healthy` in `docker compose ps`. The API applies migrations on startup.
3. Publish the app on your tailnet with `sudo tailscale serve --bg --https=443 http://127.0.0.1:3000`. Confirm the URL with `tailscale serve status`; it must match `PUBLIC_BASE_URL`. If you changed it, run `docker compose up -d` again.
4. From a device on your tailnet, open `https://omero.<tailnet>.ts.net`. The app redirects to `/setup`, where you create the owner account. It is the only user.
5. Go to **Settings → Channels** and connect X. If the button is disabled, the screen tells you which variable is missing.
6. If you configured LinkedIn, connect it the same way. _(to confirm: how the connected channel is verified in the app)_

### Upgrades and backups

[infra/README.md](../../infra/README.md) covers the daily `backup.sh` cron job, upgrading with `OMERO_VERSION`, and restoring. Run `./backup.sh` before every upgrade, and keep `ENCRYPTION_KEY` off the server.

## 9. Troubleshooting

### Callback URL mismatch (`redirect_uri` invalid)

- **Cause:** `PUBLIC_BASE_URL`, the browser URL and the callbacks registered in the portal are not identical. Check for a trailing slash and for a renamed machine or tailnet.
- **Fix:** the callback must be exactly `${PUBLIC_BASE_URL}/api/v1/channels/x/callback` (or `.../linkedin/callback`). Correct the portal or `.env`, then run `docker compose up -d`.
- If `PUBLIC_BASE_URL` does not match the browser, login loops and state-changing actions return 403 from the `Origin` check.

### Channel shows "needs reconnect"

- **Cause:** the network rejected the token (401) or it could not be refreshed. The channel moves to `needs_reconnect`, and the app notifies you in-app and on Telegram if configured.
- **Fix:** in **Settings → Channels**, reconnect the channel. Then retry the failed deliveries _(to confirm in the UI)_.

### X: credits exhausted

- **Symptom:** a delivery fails with `X_USAGE_CAPPED` or `X_CREDITS_DEPLETED`.
- **Cause:** the pay-per-use balance ran out. These errors are not retried automatically.
- **Fix:** load credits in the X Developer Console, then retry the delivery manually.

### LinkedIn: reconnect every ~60 days

- **Cause:** LinkedIn access tokens last about 60 days, and self-serve apps get no refresh token.
- **Warning:** the app warns you 7 days before expiry.
- **Fix:** when the token expires, the channel moves to `needs_reconnect`. Reconnect it from **Settings → Channels**.

### Other problems

The troubleshooting table in [infra/README.md](../../infra/README.md) covers services that do not become `healthy`, `password authentication failed`, private GHCR images, full disks and containers that restart on their own.
