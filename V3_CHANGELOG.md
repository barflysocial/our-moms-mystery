# Version 3 change summary

## Guided player flow

- Replaced the dashboard-style home page with one recommended next action.
- Reduced bottom navigation from five items to four.
- Combined suspects and evidence into Case Files.
- Removed locked clue placeholders.
- Added one-question-at-a-time interviews.
- Added contextual hints.
- Added automatic discoveries and a simple theory board.
- Replaced free-form evidence connections with validated guided deductions.
- Added automatic chapter progression.
- Added private tap-to-reveal results.

## Multiple outcomes

- Added four fully authored mystery case bundles.
- Added rotating, random, and fixed assignment modes.
- Added balanced rotation and repeat-version avoidance by mobile number.
- Stored case assignment server-side and omitted it from player and host payloads.
- Added version-specific evidence, interviews, deductions, scoring, and reveals.

## Host usability

- Added status totals and clearer player statuses.
- Added search.
- Added May Need Help detection after extended inactivity.
- Added assignment-mode controls.
- Kept leaderboard results spoiler-free.

## Verification

- `npm test` passes.
- `npm audit` reports no known vulnerabilities at packaging time.
- All four cases contain 12 suspects, 18 evidence items, and 3 deductions.
