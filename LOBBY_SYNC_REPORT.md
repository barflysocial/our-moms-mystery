# Version 3.3.0 — Scheduled Lobby and Shared Start

## Changes

- Removed the player pause/resume control from every player screen.
- Added a server-authoritative lobby before the game begins.
- Added a live countdown to the scheduled game date and time.
- Added host controls to set or change the scheduled start time.
- Added a host form to create another scheduled game session with its own code, title, venue, and date/time.
- All registered players in a session begin from the same server timestamp.
- Gameplay actions and accusations are rejected before the official start.
- Closing a phone or leaving the app does not pause the game.
- Returning players rejoin the current shared session state.
- The host dashboard now shows Waiting instead of Paused.
- PostgreSQL and local JSON storage now persist scheduled_at, started_at, and ended_at.

## Verified behavior

A future session was created, a player registered, and the server returned lobby status with a countdown. An attempted game action before the start returned HTTP 409. After the scheduled timestamp passed, `/api/me` returned running status and the same action succeeded.

## Deployment

The schema migration is automatic at startup through `schema.sql`. Existing sessions receive nullable schedule fields. The default `OURMOMS` development session starts immediately; production sessions should be scheduled from the host dashboard.
