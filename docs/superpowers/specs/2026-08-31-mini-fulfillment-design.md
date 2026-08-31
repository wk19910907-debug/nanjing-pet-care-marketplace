# Mini program real fulfillment

Continue the approved simple cat-feeding/dog-walking service loop. User requests execution
without repeated design questions. Preserve server authority, no new owner fields.

## Decision

Use native wx.chooseMedia + readFile + raw wx.request PUT for signed uploads, not multipart
wx.uploadFile (the storage API expects raw bytes). Use a maintained pure-JS SHA-256 library.
Keep upload capability and bytes only in memory. Only successful attach or a subsequent
server read may count evidence. On an ambiguous attachment response retain the same object
key and retry attachment, not upload a duplicate. Refresh server state after mutations.

Use existing pilot read/check-in/report endpoints (server owns service timestamps). Load
service type, status and evidence from the authenticated backend, never query parameters.
Block actions until loaded, during requests and after report submission. Offer explicit
before/after pet-state confirmations and the existing service checklist, optional notes.

Task entry loads only the provider's returned invitations/tasks. Production login remains
the existing real-login boundary; no fake credentials or authorization bypass. Build a
standalone importable mini-program artifact with bundled dependencies, not raw workspace
TypeScript imports. Test generated entrypoints without Node/browser globals.

## Alternatives

- Adopt a new cross-platform framework: larger migration unrelated to closing this gap.
- Wrap the website in web-view: requires separate WeChat domain approval and is not native.
- Selected native adapter/controller: minimal change, reusable backend, testable failures.

## Acceptance and limits

Tests prove canceled selection/failed PUT never attach, attachment failure does not count,
retry reuses attachment, status comes from backend, duplicate taps blocked, wrong MIME/size
and unsafe signed URLs rejected, checksum header carried without auth, raw binary upload,
server-owned timestamps, expired/missing tasks blocked, generated app/pages execute.
Real WeChat device and production login/domain validation remain explicit external gates.
No cloud keys or customer information stored in repo/Vault. Local web behavior unchanged.
