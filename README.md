# Reunion at Our Mom's

**Current release:** Version 3.2.0 — Personalized Detective Edition

A mobile-first, self-guided restaurant mystery. Guests scan a QR code, register or resume with a mobile number and four-digit PIN, investigate at their own pace, and submit one locked final accusation.

Version 3.2 makes the player or table the named detective. Solo players are addressed as **Detective [chosen name]**, while teams are addressed collectively as **Detectives of [team name]** and displayed as a named detective team.

## What is included

### Detective-led storytelling

- The player-selected detective name personalizes every reunion opening, chapter briefing, accusation confirmation, and final reconstruction
- Six briefings are authored for each hidden mystery version
- Briefings automatically appear when a chapter opens
- Full on-screen transcripts remain available in restaurant noise
- Optional device-generated audio narration can be played, stopped, and replayed
- A Detective Briefings archive is available from the More menu
- Suspect interviews remain short supporting evidence instead of carrying the main story

### Easier player interface

- Three-step registration instead of one crowded form
- QR code supplies the session automatically
- Individual or table-team play
- Quick Case, Full Case, and Deep Investigation modes
- One clearly recommended next action on the home screen
- Four-item navigation: Home, Case Files, Notebook, and More
- Suspects and evidence combined under Case Files
- Locked evidence hidden until it becomes available
- One-question-at-a-time suspect interviews
- Evidence screens explain what the clue says, why it matters, and what to do next
- Contextual hints displayed beside the current task
- Automatic notebook discoveries
- Simple theory board for suspect, motive, weapon, and key clue
- Guided deductions instead of manual evidence-pair dropdowns
- Automatic chapter completion
- Restaurant-friendly pause and resume
- One-question-at-a-time final accusation
- Private tap-to-reveal solution screen with a Hide Solution button

### Four different mystery versions

Each new player or table receives one complete authored case bundle. The assigned version stays hidden from the browser and cannot change after play begins.

- Case 1: scholarship scandal
- Case 2: reunion-fund scheme
- Case 3: blackmail and private messages
- Case 4: concealed school incident

Each version has its own:

- killer
- motive
- weapon
- murder timeline
- false alibi
- decisive clue
- evidence text
- suspect interview responses
- deductions
- hints
- confession and final reveal

The default **Rotating** assignment mode balances the four versions. It also avoids versions previously played by the same mobile number when another version remains available.

### Host dashboard

- Guest QR code
- Registration open/close control
- Status totals for Registered, Playing, Paused, May Need Help, and Completed
- Search by player/team name or status
- Clear status labels instead of raw progress counts
- Player reset
- Leaderboard without culprit information
- Rotating, Random, or Fixed case assignment mode
- Fixed mode for synchronized live events

### Security and integrity

- Game versions and solutions remain server-side until the final accusation is submitted
- The player browser receives only legitimately unlocked content
- Direct progress replacement is blocked
- Server validates all chapter progression, evidence, interview, hint, and deduction actions
- Hints and their point penalties cannot be removed
- Final accusations cannot be changed or resubmitted
- Player and host PIN attempts are rate-limited
- Host responses omit mobile numbers, PIN hashes, and assigned case versions
- Leaderboards never reveal a killer
- PostgreSQL schema migrations preserve older installations

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

The suite verifies:

- four rotating case assignments
- hidden case versions and solutions
- guided server-authoritative progression
- automatic chapter advancement
- pause/review rules
- distinct case lengths
- immutable scoring and hint penalties
- sanitized host data
- leaderboard spoiler protection
- soft pacing
- PIN throttling
- PWA cache updating and remembered sessions
- structurally complete evidence, interviews, detective briefings, deductions, and solutions for all four cases

## GitHub and Render deployment

1. Create a **private GitHub repository**. Keeping the repository private prevents customers from reading the server-side case files and solutions.
2. Upload the contents of this folder to the repository root.
3. In Render, choose **New → Blueprint** and connect the repository.
4. Keep the Blueprint path as `render.yaml`.
5. Set a private `HOST_PIN` when prompted.
6. Set `PUBLIC_BASE_URL` to the final Render URL after the service is created.
7. Deploy the Blueprint.

The included Blueprint creates:

- a Node web service
- a PostgreSQL database
- `DATABASE_URL` connection wiring
- an automatically generated `APP_SECRET`
- `/api/health` health checking

The included free plans are appropriate for testing. Upgrade the web service and database before a permanent restaurant launch.

## Environment variables

- `APP_SECRET`: long random value used to sign sessions
- `HOST_PIN`: private numeric host-dashboard PIN
- `PUBLIC_BASE_URL`: public URL used by generated QR codes
- `DATABASE_URL`: PostgreSQL connection string supplied by Render
- `PORT`: local port; defaults to `3000`

`TEST_BYPASS_TIMERS=1` is used only by automated tests and must not be set in production.

## Default session

- Session code: `OURMOMS`
- Assignment mode: Rotating
- Player URL: `/?session=OURMOMS`
- Host URL: `/?host=1&session=OURMOMS`

## Updating an existing Version 2 deployment

The schema automatically adds:

- `sessions.version_mode`
- `sessions.fixed_version`
- `players.case_version`

Older Version 2 progress resets once because Version 3 uses a different guided-progress model. Existing Version 2 players default to Case 1, which preserves the original Morgan scholarship mystery.

## Data and privacy

The app stores a player alias/name, normalized mobile number, hashed PIN, assigned hidden case version, progress, hints, final answers, and score.

Before commercial use, publish a privacy notice and define:

- data-retention duration
- player-deletion procedure
- who can access the production database
- how support requests will be verified

## Production notes

- Use a private source repository because the authored solutions are server-side source data.
- Use PostgreSQL in production; local JSON mode is for development and demonstrations.
- The built-in rate limiter is stored in server memory. A multi-instance deployment should move rate-limit state to PostgreSQL or Redis.
- Replace device-generated narration with professionally recorded neutral case narration later without changing briefing IDs or progression rules.
- Add branded evidence images and video later without changing evidence IDs or progression rules.

## Scheduled lobby and synchronized start — Version 3.3.0

Players now register into a lobby and see a server-based countdown. The host sets the game date and start time from the dashboard. At the scheduled time, every registered player enters the investigation on the same server clock.

Player-side pause has been removed. Closing the browser does not stop the game; returning players rejoin the shared timeline. Only the host can change the scheduled start time before the game begins.

### Host scheduling

Open:

`/?host=1&session=OURMOMS`

Use **Game date and start time** under Session controls, then select **Save Start Time**. The dashboard also includes **Create another scheduled game** for creating a new game code and opening its host dashboard.
