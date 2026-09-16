# Verification record

Run date: **2026-09-16**, Windows, Node.js 22.19.0 / npm 10.9.3. No Docker commands were used after the user's prohibition. Native PostgreSQL 18 binaries were used for an isolated test cluster on loopback port 55433. The existing PostgreSQL service and unrelated local applications were left intact.

## Commands run

- `npm run db:migrate` against a clean PostgreSQL database `cyp_pivot`.
- `TEST_DATABASE_URL=postgresql://cyp_verify@127.0.0.1:55433/cyp_pivot_test npm --workspace app/server test`.
- `npm run check`.
- `npx prettier --check "app/**/*.{ts,tsx,css,json,html,js,sql}" "docs/*.md" README.md --ignore-unknown`.
- Browser smoke checks with Playwright CLI against `http://127.0.0.1:5173` and `http://127.0.0.1:5174`.

## Backend checks

**13 tests passed**, including the optional native PostgreSQL integration; zero failures or skips in that run. The default `npm test` run has 12 active tests and one skipped integration test unless `TEST_DATABASE_URL` is supplied.

Covered behaviors:

- Authentication failure and collector data scoping.
- Rejection of demo JWTs after promotion to configured mode using the same signing secret.
- Partial collection status, exact idempotent replay and changed-payload conflicts.
- Concurrent collection race: one accepted, one rejected, no overpayment.
- Idempotent authorization creation remains the original response after subsequent collection.
- Positive integer money validation, unauthorized route rejection, separate collection/payout caps and insufficient funds.
- Server-derived zero settlement, nonzero closure rejection and blocked post-close movement.
- Atomic batch validation, duplicate client selection rejection and admin-only authorization creation.
- Minimal receipt fields, `no-store`, ESC/POS initialization bytes and revoked token rejection.
- Dominican midnight boundary, future close rejection, closed-date enforcement.
- File adapter persistence and rollback; PostgreSQL serialized writes/idempotency.
- Generated OpenAPI financial schemas and query documentation.

An independent review found the demo-token promotion and mutable-idempotency-response issues. Both were fixed and have regression tests.

## Build and browser verification

`npm run check` passed typecheck for server, admin and collector, ran the standard backend suite, and built all three workspaces. Vite reported one admin chunk above 500 kB after minification; this is a bundle-size warning, not a failed build.

Browser checks use Playwright CLI with isolated `cyp-*` sessions. Screenshots and browser logs are local and excluded from Git under `output/playwright` and `.playwright-cli`, since receipts/session evidence should not be published.

Verified on the collector portal at 390 × 844: demo login, scoped route/cards, cash pill, “Obligado a cobrar”, bottom sheet/keypad, RD$4,500 collection, paid stop update, receipt fields, RD$2,000 payout and payout receipt. No WhatsApp message was sent and no physical printer was controlled.

Final smoke check after the PostgreSQL pivot:

- Admin portal loaded at `http://127.0.0.1:5173`, demo login succeeded, dashboard rendered PostgreSQL seed totals, map, activity and collector table.
- Collector PWA loaded at `http://127.0.0.1:5174` in a 390 × 844 viewport, demo login succeeded, route cards and bottom navigation rendered.
- Fresh console logs contained only React DevTools informational messages.

## Discovery evidence and limits

The backup hash and size were verified. Native SQL Server/LocalDB engine, tools and instance registry entries were absent. Consequently **no legacy DDL, procedures or actual row counts were extracted**. `table_summary.json` records unknowns as null. Native extraction script syntax was validated, but its restore/export runtime remains untested.

The public demo landing/login and ten linked public assets were read successfully. Evidence identifies uniGUI, Ext JS 3.4 and IIS/8.5. The explicitly authorized test usernames were rejected; no authenticated business screen was inspected or changed. Permission hierarchy and inaccessible form fields are marked unknown or proposed, never reported as observed.

Physical devices, geolocation accuracy, printer output and production deployment were not tested. No legacy customer records were imported. The operational scaffold limitations are in `README.md` and `docs/BUSINESS_LOGIC.md`.
