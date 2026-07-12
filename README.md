# Reunion at Our Mom's — Digital Mystery App

A mobile-first, self-guided dinner mystery for restaurant play. Guests scan a QR code, register or resume with a mobile number and four-digit PIN, investigate independently, and submit one locked final accusation.

## Included

- Player registration and automatic QR check-in
- Individual or table-team play
- Distinct Quick, Standard, and Extended case modes
- Server-authoritative chapter progression and evidence unlocking
- Active-play minimum pacing with pause and inactivity handling
- 12 suspects with evidence-gated interview follow-ups
- Up to 22 digital evidence items, depending on case mode
- Lead paths, detective notebook, evidence marks, and connections
- Three-level hints with permanent server-recorded score penalties
- Immutable final accusation and server-side scoring
- Final solution, confession, rankings, and leaderboard
- Host dashboard with QR code, registration controls, sanitized player progress, resets, and scores
- PIN-attempt throttling for player resume and host login
- PostgreSQL support for Render and a local JSON fallback for development
- PWA session memory and network-first service-worker updates

## Security and integrity changes in Version 2

The app no longer downloads the complete mystery solution before play. Authenticated players receive only evidence and interview answers they have legitimately unlocked. The browser cannot replace its own progress, remove used hints, skip chapters, or resubmit a final accusation.

Host responses do not include player mobile numbers or PIN hashes. Unknown API paths return JSON `404` responses instead of the app HTML.

Existing Version 1 progress is automatically reset once when first opened because old client-controlled progress cannot be trusted safely. New Version 2 progress is preserved normally.

## Local setup

```bash
npm ci
cp .env.example .env
npm start
```

Open:

- Player app: `http://localhost:3000/?session=OURMOMS`
- Host dashboard: `http://localhost:3000/?host=1&session=OURMOMS`

The development host PIN defaults to `2006`. Set a private `HOST_PIN` before deployment.

## Automated tests

```bash
npm test
```

The test suite checks:

- protected game content and locked evidence
- registration validation
- server-authoritative progression
- permanent hint penalties
- immutable final accusations
- host-data sanitization
- local session-code uniqueness
- distinct case modes and soft pacing
- player and host PIN throttling
- PWA session retention and cache updates
- API `404` handling and progress percentage clamping

## Render deployment

1. Push this folder to a GitHub repository.
2. In Render, create a Blueprint from the repository. The included `render.yaml` defines the Node web service and PostgreSQL database.
3. Set `HOST_PIN` and `PUBLIC_BASE_URL` when prompted.
4. After deployment, set `PUBLIC_BASE_URL` to the final public app URL so generated QR codes use the correct address.

## Environment variables

- `APP_SECRET`: signs player and host sessions. Use a long random value.
- `HOST_PIN`: protects the host dashboard.
- `PUBLIC_BASE_URL`: public deployment URL used in QR codes.
- `DATABASE_URL`: PostgreSQL connection string. The Render Blueprint supplies it.
- `PORT`: local listening port; defaults to `3000`.

`TEST_BYPASS_TIMERS=1` is used only by the automated smoke test and should not be set in deployment.

## Data and privacy

The app stores the player's name or alias, normalized mobile number, hashed PIN, case progress, hint usage, final answers, and score. Mobile numbers and PIN hashes are not returned to the host browser or other players.

Add a public privacy notice, a data-retention schedule, and a player-deletion process before commercial launch.

## Production notes

- Change the host PIN and use a generated app secret.
- Use PostgreSQL in production; local JSON mode is intended for development and demonstrations.
- The built-in PIN throttle is per running server instance. A multi-instance deployment should move throttle state to a shared store such as PostgreSQL or Redis.
- Replace text-only evidence visuals with branded image, audio, or video assets without changing evidence IDs.
