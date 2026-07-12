# Version 3.0.1 PIN Validation Fix

## Corrected

Both player PIN fields in `public/app.js` now use:

```html
pattern="[0-9]{4}"
```

This replaces the JavaScript-template pattern `pattern="\d{4}"`, which browsers could receive as `d{4}` and reject valid numeric PINs.

## Affected screens

- New-player registration
- Returning-player resume

## Verification

- JavaScript syntax checks passed.
- Clean `npm ci` completed.
- `npm audit` reported 0 known vulnerabilities.
- Smoke test passed.
- Regression test passed.
- A new regression assertion verifies that both fields retain the browser-safe numeric pattern.
- Service-worker cache version updated so deployed devices receive the corrected `app.js`.

## Release

Application version: `3.0.1`
