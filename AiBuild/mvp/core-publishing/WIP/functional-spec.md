# Functional Spec: Core Publishing

## Metadata
- **Type:** mvp
- **Branch:** mvp/core-publishing
- **Ticket:** N/A
- **Tests required:** no (mvp) — critical paths (scheduler, OAuth token handling, thread publishing) should still get tests
- **Date:** 2026-10-28
- **Status:** WIP

## Summary
Stage 1 of **omero-social-post**, an open-source, self-hosted, single-user social media publisher.
The owner connects X and LinkedIn through each network's official OAuth, writes posts (text, images, X threads) in a composer with per-network adjustments, places them on a calendar (exact time or queue slots), and a scheduler publishes them on time.
Failures are retried and reported in-app and via Telegram, and published X posts get basic metrics.

## Project context
- **What it is:** a personal alternative to Typefully/Metricool, built from scratch and in public. The development process (specs, decisions, AI-assisted builds) is part of the project's content.
- **Reference:** Postiz (AGPL-3.0) is used as a product and architecture reference only. No code is copied unless the license decision makes it compatible and attribution is kept.
- **Stack (to be confirmed in the technical spec):** pnpm monorepo, Next.js (web), NestJS (API + scheduler), PostgreSQL. A React Native/Expo mobile app comes in a later stage and will reuse the API.
- **Deployment:** Docker Compose on a Hostinger KVM 1 VPS (1 vCPU, 4 GB RAM), reachable only through Tailscale. Nothing is exposed to the public internet.
- **Audience:** primarily the owner. Secondarily, other developers who self-host their own instance with their own developer apps ("bring your own keys").

### Roadmap (separate SDD cycles)
1. **mvp/core-publishing** — this spec.
2. **feature/news-digest** — sources (X accounts, websites/RSS), AI research, ideas → drafts on the calendar.
3. **feature/mobile-app** — Expo app: approve drafts, read the digest, share-sheet drafts from the gallery, push notifications.
4. **feature/meta-networks** — Instagram (professional account) and Facebook Pages.

## Detailed description
A single owner runs their own instance. On first visit they create the owner account; after that the app requires login.

In **Settings → Channels** they connect an X account and a LinkedIn personal profile. The network developer-app credentials (client IDs and secrets) are provided by the self-hoster through environment variables; the UI never asks for them.

The **composer** has a base content and a list of selected channels. Each channel can override the base content (for example, a thread on X and a single longer post on LinkedIn). Posts can include images. On X, a post can be a thread of several items. The composer shows per-network character counters, validation errors and a preview per network.

A post can be:
- saved as a **draft**,
- **scheduled** at an exact date and time,
- **added to the queue** (next free slot from the weekly slot configuration),
- **published now**.

The **calendar** shows week and month views. Posts appear in their time slots, labelled by network and status. Clicking an empty slot opens the composer with that time prefilled. Dragging a draft or scheduled post moves it to a new time.

The **scheduler** publishes each channel's version independently at the scheduled time, using exponential backoff retries for transient errors. Each channel delivery has its own status. When delivery ultimately fails, or a channel needs to be reconnected, the owner gets an in-app notification and a Telegram message from their own bot.

For published X posts, the app fetches basic metrics at fixed checkpoints and shows them on the post detail.

## Main flows

### Flow 1: First-run setup and login
1. The owner opens the app for the first time; no owner account exists.
2. The app shows a setup screen to create the owner account (username + password, with confirmation).
3. After setup, the setup screen is no longer reachable; every visit requires login.
4. The owner logs in and lands on the calendar. They can log out from the user menu.

### Flow 2: Connect a channel
1. Owner goes to Settings → Channels and clicks "Connect X" or "Connect LinkedIn".
2. If that network's credentials are not configured, the button is disabled with a short explanation of which environment variables are missing and a link to the setup docs.
3. Otherwise the owner is redirected to the network's OAuth consent screen, approves, and is redirected back.
4. The channel appears in the list with avatar, display name, handle and status "connected".
5. The owner can disconnect a channel or reconnect it when its status is "needs reconnect".

### Flow 3: Compose and schedule a post
1. Owner clicks "New post" (or an empty calendar slot).
2. Writes the base content, selects one or more channels and optionally attaches images.
3. Optionally customizes a channel:
   - **X:** splits the content into a thread (manual separators, plus a "split automatically" helper that respects the character limit).
   - **LinkedIn:** edits the single-post text.
4. Sees per-channel character counters, validation errors and a preview per network.
5. If the X version contains a link, the composer shows a note that link posts cost more on the X API.
6. Chooses one action: Save draft / Schedule (date-time picker) / Add to queue / Publish now.
7. The post appears on the calendar with its status.

### Flow 4: Queue slots
1. In Settings → Queue, the owner defines weekly slots (for example, Mon–Fri 09:00 and 18:00) in their timezone.
2. "Add to queue" assigns the earliest future slot not taken by another scheduled post.
3. If no free slot exists in the next 30 days, the composer shows an error and suggests scheduling manually.

### Flow 5: Calendar
1. The owner switches between week and month views and navigates periods.
2. Posts are shown with network icons, a status color and a short preview.
3. Clicking a post opens it. Draft and scheduled posts open in the composer; published and failed posts open in a detail view.
4. Dragging a draft or scheduled post to another slot reschedules it after a confirmation toast with undo.

### Flow 6: Publishing
1. At the scheduled time, the scheduler picks the post and publishes each channel delivery independently.
2. **X thread:** items are published sequentially, each as a reply to the previous one.
3. Each delivery moves through `scheduled → publishing → published` (or `failed`), storing the remote post id and URL.
4. The post-level status is derived from its deliveries: `published`, `partially published` or `failed`.

### Flow 7: Failures and notifications
1. **Transient errors** (network, 5xx, rate limit) are retried with exponential backoff, up to 3 attempts within about 15 minutes.
2. **Auth errors** (expired or revoked token) are not retried. The channel is marked "needs reconnect" and the delivery is marked failed.
3. **On final failure,** the owner gets:
   - an in-app notification in a notifications tray,
   - a Telegram message with the post preview, the network, the error reason and a link to the post in the app.
4. **Partial thread failure:** the delivery shows which item failed and offers "Retry from failed item".
5. The owner can retry a failed delivery manually.

### Flow 8: Basic X metrics
1. For each published X post, metrics are fetched at +1 h, +24 h and +7 d after publishing: impressions, likes, reposts, replies, quotes and bookmarks (whatever the API returns).
2. The post detail view shows the latest values and the time they were fetched.
3. No automatic polling beyond those checkpoints, to keep API read costs bounded.

## Edge cases
- **Server down at the scheduled time:**
  - On startup, overdue posts within a grace window (default 6 h, configurable) are published immediately.
  - Older ones are marked "missed" and notified, not published.
- **LinkedIn token close to expiring** (~60-day lifetime): notify via Telegram and in-app 7 days before, and on expiry mark the channel "needs reconnect".
- **Channel disconnected while it has scheduled posts:** those deliveries are flagged and shown on the calendar; reconnecting clears the flag.
- **X duplicate-content rejection:** shown as a non-retryable failure with a clear message.
- **Image too large or unsupported for a network:** blocked in the composer with the network's limit shown.
- **X character limit:** 280 by default. A per-channel setting enables long posts for X Premium accounts.
- **Editing a post while it is publishing:** not allowed; the composer opens read-only with a "publishing…" notice.
- **Published posts:** cannot be edited or rescheduled; they can only be viewed. Deleting from the network is out of scope.
- **Rescheduling into the past** (by drag or picker): rejected.
- **Deleting a scheduled post:** asks for confirmation and removes it from the queue.
- **Two posts in the same queue slot:** "Add to queue" never assigns an occupied slot. Manual scheduling at the same time is allowed.
- **Timezone:**
  - Stored in UTC, displayed in the owner's configured timezone (default from the browser).
  - Daylight-saving transitions must not shift scheduled posts.
- **Missing Telegram config:** notifications are in-app only, with a hint in Settings.
- **Login brute force:** repeated failed logins are rate limited.

## Acceptance criteria
- [ ] Given a fresh install, when the owner opens the app, then they are asked to create the owner account, and that screen is unreachable afterwards.
- [ ] Given an unauthenticated visitor, when they open any app route, then they are redirected to login.
- [ ] Given X credentials are configured, when the owner completes X OAuth, then the X channel appears as connected with its handle and avatar.
- [ ] Given LinkedIn credentials are missing, when the owner opens Channels, then "Connect LinkedIn" is disabled and explains what to configure.
- [ ] Given a post with base content for X and LinkedIn and an X thread override of 3 items, when it is scheduled and the time arrives, then X shows a 3-item thread and LinkedIn shows the base text, both linked from the post detail.
- [ ] Given an X item over 280 characters on a non-Premium channel, when the owner tries to schedule, then scheduling is blocked and the item is highlighted.
- [ ] Given a post with 2 images for X and LinkedIn, when it is published, then both networks show the images.
- [ ] Given queue slots Mon–Fri 09:00 and the next slot is taken, when the owner clicks "Add to queue", then the post is scheduled in the following free slot.
- [ ] Given a scheduled post in week view, when the owner drags it to a future slot, then its scheduled time updates, and undo restores it.
- [ ] Given a scheduled post, when the owner drags it into the past, then the move is rejected.
- [ ] Given a transient X error, when publishing, then the app retries up to 3 times with backoff before marking the delivery failed.
- [ ] Given a revoked LinkedIn token, when publishing, then the delivery fails without retry, the channel shows "needs reconnect", and an in-app notification and a Telegram message are sent.
- [ ] Given the server was down at a post's scheduled time and comes back within the grace window, then the post is published on startup; beyond the window it is marked "missed" and notified.
- [ ] Given an X post published 24 h ago, when the owner opens its detail, then it shows impressions, likes, reposts and replies with the fetch time.
- [ ] Given a thread whose second item fails, when the owner clicks "Retry from failed item", then publishing resumes from item 2 as a reply to item 1.
- [ ] Given the full stack started with Docker Compose on a 1 vCPU / 4 GB VPS, then idle memory use stays well within that machine's limits.

## Out of scope
- AI news digest and research (stage 2).
- Mobile app (stage 3).
- Instagram and Facebook (stage 4).
- Video uploads, GIFs, polls.
- LinkedIn metrics (requires a restricted permission) and LinkedIn company pages.
- Analytics dashboards (follower growth, best times, cross-network engagement).
- Multi-user, teams, roles, approvals by other people.
- Hosted/SaaS mode, billing, or providing shared developer apps to other users.
- Deleting or editing posts on the networks after publishing.
- Reddit (its public API is closing to new access).
- AI writing assistance in the composer (may come with stage 2).

## Constraints
- **Infrastructure:**
  - Must run comfortably on 1 vCPU / 4 GB RAM alongside Postgres, so no heavyweight workflow engines.
  - Images are built in CI, not on the VPS.
- **Privacy and security:**
  - Single user. Nothing is exposed publicly; access goes through Tailscale.
  - The app still has its own authentication for self-hosters without Tailscale.
  - OAuth tokens and secrets are encrypted at rest. All secrets come from environment variables and are never committed.
- **Network APIs:**
  - **X:** pay-per-use API, so minimize reads; metrics are fetched only at fixed checkpoints. Link posts cost more and the composer warns about it.
  - **X:** liking, following and quote-posting via API are not available on pay-per-use; they are not needed here.
  - **LinkedIn:** only the self-serve `w_member_social` scope (personal profile posting); tokens last ~60 days.
- **Official APIs only:** no scraping and no unofficial endpoints.
- **Open source:**
  - Public repo with secret scanning (gitleaks) from the first commit.
  - Configuration fully driven by environment variables, with no owner-specific values in code.
- **Look and feel:** a polished UI inspired by Metricool's colorful, clean dashboard style, with its own identity and no copied branding.

## Open questions
- **UI language:** English UI with i18n ready for Spanish, or Spanish first?
- **License:** AGPL-3.0 (recommended, same as Postiz) or MIT. It must be decided before the first public commit with code.
- **X Premium:** does the owner's X account allow long posts (the per-channel toggle default)?
- **Missed-post grace window:** is 6 h the right default?
- **Default queue slots** for a fresh install: none, or a suggested set?
