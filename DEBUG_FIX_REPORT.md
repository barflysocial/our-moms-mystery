# Reunion at Our Mom's Digital Game App — Error Fix Verification

Date: July 12, 2026
Build: Version 2 security and progression patch

## Result

All 15 defects in the prior debug report were addressed in the source and covered by automated regression checks.

## Fixed defects

1. **Solution exposed before play — Fixed**
   - `/api/game` now requires a valid player session.
   - Final-answer markers, scoring keywords, suspect truth fields, reveals, and the confession are never sent before accusation submission.
   - Locked evidence titles and content are hidden.
   - Unused hint text, future chapter details, future leads, and locked interview answers are withheld.

2. **Player-submitted progress trusted — Fixed**
   - Direct progress replacement through `PUT /api/progress` is rejected.
   - All progress changes use validated server actions through `POST /api/action`.
   - Chapter completion, evidence access, questions, leads, notes, connections, hints, and pause state are checked server-side.

3. **Hint penalties could be erased — Fixed**
   - Hint use is permanently added by the server.
   - The client has no endpoint that can remove hint history.
   - Scoring reads only the authoritative stored hint record.

4. **Final accusation could be resubmitted — Fixed**
   - Accusations are insert-only.
   - PostgreSQL and local JSON modes both reject a second submission with HTTP `409`.
   - Completed case state is locked from further player actions.

5. **Host API exposed mobile numbers and PIN hashes — Fixed**
   - The host dashboard receives a sanitized player summary only.
   - Mobile numbers, PIN hashes, raw progress objects, and other unnecessary fields are omitted.

6. **No PIN rate limiting — Fixed**
   - Player resume and host login are limited to five failed attempts per 15-minute window.
   - Further attempts receive HTTP `429` and a `Retry-After` header.

7. **Case lengths behaved identically — Fixed**
   - Quick, Standard, and Extended now have different:
     - suspect-profile requirements,
     - question requirements,
     - lead requirements,
     - evidence-connection requirements,
     - available evidence depth,
     - and pacing durations.

8. **Soft timing not implemented — Fixed**
   - Each investigation chapter has a server-enforced minimum active-play duration.
   - Paused time does not count.
   - Inactivity beyond five minutes is capped rather than counted indefinitely.
   - Chapter 4 also includes a timed dramatic evidence release.

9. **Unsupported registration values accepted — Fixed**
   - `playMode`, `caseLength`, event code, mobile number, PIN, name, and team name are strictly validated.

10. **Local JSON allowed duplicate session codes — Fixed**
    - Local and PostgreSQL databases now enforce the same session-code uniqueness behavior.

11. **Manually entered event code did not update client state — Fixed**
    - Registration, resume, and host login synchronize the confirmed server session into the app state, URL, and remembered session value.

12. **Installed PWA lost custom session codes — Fixed**
    - The app stores the last confirmed session locally.
    - PWA startup restores that session when no session query is present.

13. **Service worker could serve stale deployments — Fixed**
    - Cache version updated to `reunion-v2-20260712`.
    - Old caches are deleted during activation.
    - Navigation and static assets use a network-first strategy.
    - `skipWaiting()` and `clients.claim()` activate updates promptly.

14. **Unknown API routes returned HTML with HTTP 200 — Fixed**
    - Unknown `/api/*` routes return JSON with HTTP `404`.

15. **Progress could display 120% — Fixed**
    - Progress uses the actual chapter count and is clamped to 100%.

## Verification performed

- `npm ci`
- `npm audit`: 0 known vulnerabilities
- JavaScript syntax validation for server, database, app, service worker, and test files
- JSON validation for game content and PWA manifest
- Full secure player flow from registration through final accusation
- Permanent hint-penalty test
- Forged-progress rejection test
- Immutable-accusation test
- Host response privacy test
- Duplicate-session test
- Quick versus Extended behavior test
- Soft-timer rejection test
- Player and host PIN-throttling tests
- API JSON `404` test
- Local launch and health check

## Test commands

```bash
npm ci
npm test
npm audit
```

## Browser-test note

A headless Chromium launch was attempted in the container, but Chromium could not initialize its Linux DBus/network runtime. This is a container-environment limitation previously observed with the original build. The app JavaScript, server behavior, API flows, content graph, static files, launch endpoint, and regression cases were validated independently.
