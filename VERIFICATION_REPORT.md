# Reunion at Our Mom's Version 3.2.0 Verification Report

## Release

**Version:** 3.2.0  
**Edition:** Personalized Detective Edition

## Verified behavior

- Solo players are displayed as `Detective [chosen name or alias]`.
- A name already beginning with `Detective` is not double-prefixed.
- Team players are displayed as `[team name] Detective Team`.
- Team narration addresses the table collectively as `Detectives of [team name]`.
- The personalized identity appears in the top bar, chapter briefings, briefing badge, accusation confirmation, and final reconstruction.
- Resuming a saved game restores the same personalized detective identity.
- All 24 chapter briefings remain protected by chapter progression.
- All four hidden case solutions remain server-side until the final accusation is locked.
- Solo and team personalization tests pass.
- Smoke and regression suites pass.
- JavaScript syntax checks pass.
- `npm audit` reports 0 known vulnerabilities.

## Compatibility

Version 3.2.0 uses the existing player and database schema. No database migration is required when upgrading from Version 3.1.0.

The service-worker cache key changed to `reunion-v3-guided-3.2.0-personalized-detective` so deployed devices retrieve the new interface.
