# Final integration fixes

Date: 2026-08-28
Base: `61c6bde`

## Closed findings

1. Owner confirmation now returns only `orderId`, `status`, and `confirmedAt`; the browser rejects any response with extra settlement fields.
2. Owner order summaries expose only evidence IDs. The owner UI obtains a short-lived signed read URL, displays each required item, handles loading/errors, and keeps confirmation disabled until all evidence has been opened.
3. Admin provider operations list pending, approved, and suspended profiles using safe fields. Approved providers can be suspended and dispatch continues to select only approved profiles.
4. Provider applications accept only the four approved Nanjing district centroids, a fixed 5 km radius, and a unique subset of the two supported services.
5. Pilot addresses require Nanjing, a matching approved district/service zone and centroid, and empty access instructions. Arbitrary coordinates and door-lock text are rejected before persistence.
6. Service checklists accept only the exact service-specific scalar keys. Extra keys, nested values, arrays, and incomplete values are rejected before persistence.

## TDD evidence

- Initial focused RED: 8 expected API failures demonstrated all six server-side gaps.
- Server GREEN: 37/37 focused API tests.
- Frontend RED/GREEN: unsafe confirmation payload, owner evidence gate, and provider suspension scenarios; 72/72 focused tests passed.
- API full: 19 files, 186/186 passed.
- All unit/integration workspaces: Admin 146, Contracts 7, Mini Program 11, Domain 18, API 186 = 368/368 passed.
- Typecheck, lint, public build, and pilot build passed on Node.js 22.
- Public Playwright: 16/16 passed.
- Pilot mocked Playwright: 4/4 passed.
- Real PostgreSQL 16 live acceptance: 1/1 passed in 14.6 seconds, including restart, owner-discovered evidence, safe confirmation DTO, approve-to-suspend operation, and cleanup.

## Boundaries

- Public GitHub Pages demo behavior is unchanged.
- No contact, payment, identity-document, door-lock, object-key, session token, or settlement-internal field was added to pilot read models.
- Production S3/public deployment remains deferred; this delivery remains the controlled local pilot requested by the user.
