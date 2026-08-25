# Invitation-Only Pilot Shared Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a same-origin, invitation-only Nanjing pilot where owners, administrators, and providers use separate authenticated browser sessions against one PostgreSQL-backed order workflow.

**Architecture:** Keep the GitHub Pages `DemoApp` unchanged and add a `PilotApp` selected at build time. A Fastify composition root serves both `/api` and the pilot web build, translates an HttpOnly session cookie into the existing `AuthService` boundary, and wires the current Prisma services to pilot-specific auth, manual-fee, read-model, and local development evidence adapters. Production pilot configuration remains fail-closed and requires encryption plus S3-compatible storage, while local single-node verification may use an explicit filesystem directory.

**Tech Stack:** Node.js 22, pnpm 10, TypeScript 5.9, React, Vite, Fastify 5, Prisma 6, PostgreSQL 16, Vitest, Playwright, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/static`.

## Global Constraints

- Scope is limited to Nanjing `建邺区`, `鼓楼区`, `玄武区`, and `秦淮区`, with `CAT_FEEDING` and `DOG_WALKING` only.
- GitHub Pages remains the localStorage-only public demo; pilot mode never falls back to demo state.
- Pilot access uses one-time invitations and HttpOnly server sessions; never store tokens in localStorage.
- Do not add phone, WeChat, email, identity-document, bank-card, payment-code, or door-lock-password fields.
- Exact address data is encrypted at rest and is returned only through existing role/time-window checks.
- Pilot manual fee confirmation records an offline check; it never claims or initiates online payment.
- `PILOT_AUTH_PEPPER` and production field-encryption keys must decode to exactly 32 bytes and never enter Git, test snapshots, logs, or the Vault.
- Node.js must remain `>=22 <23`; PostgreSQL must remain 16.x.
- Every production behavior starts with a failing test that is observed failing for the intended reason.
- Main touch targets must remain at least 44px high at 390×844 and must not cause horizontal overflow.

## File and Responsibility Map

- `prisma/schema.prisma`, `prisma/migrations/202608250001_pilot_auth/migration.sql`: persisted display name, invitations, and sessions.
- `apps/api/src/auth/pilot-credential.ts`: purpose-separated HMAC digest and high-entropy tokens.
- `apps/api/src/auth/pilot-session-service.ts`: invite creation/redemption, session auth/revocation, bootstrap, and display-name validation.
- `apps/api/src/auth/pilot-routes.ts`: cookie lifecycle, rate-limited redemption, current-session and nickname endpoints.
- `apps/api/src/auth/pilot-origin-guard.ts`: exact production Origin validation.
- `apps/api/src/pilot/manual-fee-service.ts`: idempotent offline fee confirmation.
- `prisma/migrations/202608250002_manual_fee_key/migration.sql`: manual fee idempotency constraint.
- `apps/api/src/pilot/pilot-read-model.ts`: role-filtered dashboard, orders, review queue, invitations, and invite metadata.
- `apps/api/src/pilot/pilot-routes.ts`: role-filtered read endpoints and pilot admin actions.
- `apps/api/src/adapters/pilot-manual-payment-gateway.ts`: creates a pending `pilot-manual` payment record without a payment token.
- `apps/api/src/adapters/local-pilot-object-storage.ts`, `apps/api/src/pilot/local-upload-routes.ts`: signed, path-safe filesystem evidence for development only.
- `apps/api/src/pilot/composition.ts`, `apps/api/src/server.ts`, `apps/api/src/pilot/bootstrap.ts`: dependency wiring, executable server, and one-time terminal bootstrap.
- `apps/admin/src/pilot/api.ts`: typed same-origin API client with no token persistence.
- `apps/admin/src/pilot/PilotApp.tsx`, `LoginPanel.tsx`, `ProfilePanel.tsx`: session bootstrap and first-login nickname.
- `apps/admin/src/pilot/OwnerPilotWorkspace.tsx`: pets, encrypted address, quote, order, report, and confirmation.
- `apps/admin/src/pilot/AdminPilotWorkspace.tsx`: invitation creation, provider review, offline fee confirmation, and dispatch.
- `apps/admin/src/pilot/ProviderPilotWorkspace.tsx`: application, availability, invitations, evidence, and report.
- `apps/admin/src/pilot/models.ts`, `districts.ts`, `checklists.ts`: client contracts and deterministic Nanjing UI mappings.
- `apps/admin/e2e/pilot-shared-loop.spec.ts`, `apps/admin/e2e/pilot.fixture.ts`: three isolated sessions against one real test database.

---

### Task 1: Persist Pilot Invitations, Sessions, and Display Names

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202608250001_pilot_auth/migration.sql`
- Create: `apps/api/src/auth/pilot-credential.ts`
- Create: `apps/api/src/auth/pilot-session-service.ts`
- Create: `apps/api/tests/pilot-session-service.test.ts`

**Interfaces:**
- Produces: `createPilotCredential(pepper, purpose, randomBytes?)` returning `{ raw, digest }`.
- Produces: `PilotSessionService.createInvite(actor, role)`, `bootstrapAdminInvite()`, `redeem(code)`, `authenticate(authorizationHeader)`, `revoke(authorizationHeader)`, `setDisplayName(actor, value)`, and `listInvites(actor)`.
- Session authorization continues to satisfy the existing `AuthService` interface.

- [ ] **Step 1: Write the failing persistence and service tests**

Add real-database tests with deterministic clock/token injection. The central expectations must be expressed directly:

```ts
const service = new PilotSessionService(prisma, {
  pepper: Buffer.alloc(32, 7), inviteHours: 24, sessionDays: 7,
  now: () => new Date('2026-08-25T08:00:00Z'),
  token: sequenceTokens('admin-invite', 'owner-invite', 'owner-session'),
});

const bootstrap = await service.bootstrapAdminInvite();
expect(bootstrap.code).toBe('admin-invite');
expect(await prisma.pilotInvite.findFirstOrThrow()).not.toHaveProperty('code', 'admin-invite');

const adminLogin = await service.redeem('admin-invite');
const admin = await service.authenticate(`Bearer ${adminLogin.token}`);
expect(admin.role).toBe('ADMIN');

const ownerInvite = await service.createInvite(admin, 'OWNER');
const [first, second] = await Promise.allSettled([
  service.redeem(ownerInvite.code), service.redeem(ownerInvite.code),
]);
expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
expect(await prisma.pilotSession.count({ where: { user: { role: 'OWNER' } } })).toBe(1);
```

Also assert expired and unknown codes share `INVITE_INVALID`, revoked/expired sessions throw `UNAUTHENTICATED`, only `ADMIN` creates invitations, `targetUserId` bootstrap does not create a second admin, and display names reject `13800138000`, `wx_abcdef`, and `user@example.com` while accepting `秦淮小林`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @pet/api test -- tests/pilot-session-service.test.ts
```

Expected: FAIL because Prisma has no `pilotInvite`/`pilotSession` delegates and `PilotSessionService` does not exist.

- [ ] **Step 3: Add the Prisma models and forward migration**

Add to `User`:

```prisma
displayName          String?        @db.VarChar(30)
pilotSessions        PilotSession[]
pilotInvitesCreated  PilotInvite[]  @relation("PilotInviteCreator")
pilotInvitesTargeted PilotInvite[]  @relation("PilotInviteTarget")
```

Add models:

```prisma
model PilotInvite {
  id           String    @id @default(uuid()) @db.Uuid
  codeHash     String    @unique @db.Char(64)
  role         ActorRole
  targetUserId String?   @db.Uuid
  expiresAt    DateTime  @db.Timestamptz(3)
  consumedAt   DateTime? @db.Timestamptz(3)
  createdById  String    @db.Uuid
  createdAt    DateTime  @default(now()) @db.Timestamptz(3)
  createdBy    User      @relation("PilotInviteCreator", fields: [createdById], references: [id], onDelete: Restrict)
  targetUser   User?     @relation("PilotInviteTarget", fields: [targetUserId], references: [id], onDelete: Restrict)

  @@index([expiresAt, consumedAt])
  @@index([createdById, createdAt])
}

model PilotSession {
  id         String    @id @default(uuid()) @db.Uuid
  tokenHash  String    @unique @db.Char(64)
  userId     String    @db.Uuid
  expiresAt  DateTime  @db.Timestamptz(3)
  revokedAt  DateTime? @db.Timestamptz(3)
  createdAt  DateTime  @default(now()) @db.Timestamptz(3)
  lastSeenAt DateTime  @default(now()) @db.Timestamptz(3)
  user       User      @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@index([userId, expiresAt])
}
```

The SQL migration must add `displayName`, create both tables with the exact foreign keys above, and create the declared unique/index structures without altering prior migrations.

- [ ] **Step 4: Implement HMAC credentials and transactional session behavior**

Use purpose-separated HMAC and timing-safe, high-entropy raw values:

```ts
export function digestPilotCredential(pepper: Buffer, purpose: 'invite' | 'session', raw: string) {
  return createHmac('sha256', pepper).update(`${purpose}\0${raw}`, 'utf8').digest('hex');
}

export function createPilotCredential(
  pepper: Buffer,
  purpose: 'invite' | 'session',
  random: (size: number) => Buffer = randomBytes,
) {
  const raw = random(32).toString('base64url');
  return { raw, digest: digestPilotCredential(pepper, purpose, raw) };
}
```

In `redeem`, calculate the invite digest, start a serializable transaction, load a non-consumed unexpired invite, create or reuse `targetUserId`, update it with `consumedAt` only when still null, and create a session digest. If the guarded update count is not one, throw `INVITE_INVALID`. Never return either digest.

Validate display names with:

```ts
const DisplayNameSchema = z.string().trim().min(1).max(30).refine(
  (value) => !/(?:1\d{10}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:微信|vx|wx)\s*[:：_\-]?[A-Za-z0-9_-]{4,}|\d{6,})/i.test(value),
  'DISPLAY_NAME_INVALID',
);
```

- [ ] **Step 5: Generate Prisma Client and verify GREEN**

Run:

```powershell
pnpm exec prisma generate --schema prisma/schema.prisma
pnpm --filter @pet/api test -- tests/pilot-session-service.test.ts
pnpm --filter @pet/api typecheck
git diff --check
```

Expected: all focused tests pass; typecheck and diff check exit 0.

- [ ] **Step 6: Commit Task 1**

```powershell
git add prisma apps/api/src/auth apps/api/tests/pilot-session-service.test.ts
git commit -m "feat: add invitation-only pilot sessions"
```

---

### Task 2: Expose Cookie Authentication and Fail-Closed Request Guards

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/health.ts`
- Create: `apps/api/src/auth/pilot-origin-guard.ts`
- Create: `apps/api/src/auth/pilot-routes.ts`
- Create: `apps/api/tests/pilot-auth-routes.test.ts`
- Modify: `apps/api/tests/config.test.ts`
- Modify: `apps/api/tests/production-readiness.test.ts`

**Interfaces:**
- Consumes: `PilotSessionService` from Task 1.
- Produces: `PilotAuthRoutesDependencies`, `registerPilotAuthRoutes`, `installPilotCookieBridge`, and `requirePilotOrigin`.
- Produces: `AppConfig.pilot` only when `PILOT_MODE=enabled`.

- [ ] **Step 1: Install the minimal Fastify plugins**

Run:

```powershell
pnpm --filter @pet/api add @fastify/cookie@^11 @fastify/rate-limit@^10 @fastify/static@^8
```

Expected: only `apps/api/package.json` and `pnpm-lock.yaml` change.

- [ ] **Step 2: Write failing route/config tests**

Cover login, current session, nickname, logout, cookie flags, five-failure rate limit, exact Origin enforcement, and absence of secrets in readiness. Use Fastify injection:

```ts
const login = await app.inject({
  method: 'POST', url: '/api/v1/pilot/sessions',
  headers: { origin: 'https://pilot.example.com' },
  payload: { inviteCode: ownerInvite.code },
});
expect(login.statusCode).toBe(201);
expect(login.headers['set-cookie']).toContain('petcare_pilot_session=');
expect(login.headers['set-cookie']).toContain('HttpOnly');
expect(login.headers['set-cookie']).toContain('SameSite=Lax');
expect(login.headers['set-cookie']).toContain('Secure');

const session = await app.inject({
  method: 'GET', url: '/api/v1/pilot/session',
  headers: { cookie: login.headers['set-cookie']! },
});
expect(session.json()).toMatchObject({ role: 'OWNER', displayName: null });
```

Assert a production POST from `https://attacker.example` is 403, development requests without Origin work, six invalid attempts yield 429, and errors never echo the invite code.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
pnpm --filter @pet/api test -- tests/pilot-auth-routes.test.ts tests/config.test.ts tests/production-readiness.test.ts
```

Expected: FAIL because pilot config/routes and cookie support do not exist.

- [ ] **Step 4: Implement discriminated pilot configuration**

Parse these exact fields: `PILOT_MODE`, `PILOT_HOST`, `PILOT_PORT`, `PILOT_PUBLIC_ORIGIN`, `PILOT_AUTH_PEPPER`, `PILOT_SESSION_DAYS`, `PILOT_INVITE_HOURS`, and `PILOT_EVIDENCE_DIR`. Decode and validate the pepper length during configuration. Represent pilot config as:

```ts
type PilotConfig = {
  enabled: true;
  host: string;
  port: number;
  publicOrigin?: string;
  authPepper: Buffer;
  sessionDays: number;
  inviteHours: number;
  evidenceDir?: string;
  secureCookies: boolean;
};
```

For `NODE_ENV=production`, require `PILOT_PUBLIC_ORIGIN`, `FIELD_ENCRYPTION_KEY_V1`, and all S3 fields when pilot mode is enabled; do not require WeChat credentials in that profile. Preserve the existing full-production validation when pilot mode is disabled.

- [ ] **Step 5: Implement cookie bridge, Origin guard, and routes**

Register cookie parsing before business routes. The bridge must only synthesize an internal authorization header when the request did not already provide one:

```ts
app.addHook('onRequest', async (request) => {
  const token = request.cookies.petcare_pilot_session;
  if (token && !request.headers.authorization) request.headers.authorization = `Bearer ${token}`;
});
```

Expose:

```text
POST   /api/v1/pilot/sessions       { inviteCode }
GET    /api/v1/pilot/session
PATCH  /api/v1/pilot/me             { displayName }
DELETE /api/v1/pilot/session
```

Apply a five-attempt/ten-minute rate limit only to login. Set/clear the cookie through one helper so all flags are identical. Apply `requirePilotOrigin` to state-changing `/api/v1/pilot/**` requests in production.

- [ ] **Step 6: Verify GREEN and regression safety**

```powershell
pnpm --filter @pet/api test -- tests/pilot-auth-routes.test.ts tests/config.test.ts tests/production-readiness.test.ts
pnpm --filter @pet/api test
pnpm --filter @pet/api typecheck
git diff --check
```

Expected: focused and full API tests pass with no secret values in output.

- [ ] **Step 7: Commit Task 2**

```powershell
git add apps/api/package.json pnpm-lock.yaml apps/api/src apps/api/tests
git commit -m "feat: expose secure pilot authentication"
```

---

### Task 3: Add Manual Fee Confirmation and Role-Filtered Read Models

**Files:**
- Create: `apps/api/src/adapters/pilot-manual-payment-gateway.ts`
- Modify: `apps/api/src/payments/payment-gateway.ts`
- Create: `apps/api/src/pilot/manual-fee-service.ts`
- Create: `apps/api/src/pilot/pilot-read-model.ts`
- Create: `apps/api/src/pilot/pilot-routes.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/tests/pilot-business-routes.test.ts`

**Interfaces:**
- Produces: `PilotManualPaymentGateway` with provider name `pilot-manual` and no browser payment token.
- Produces: `ManualFeeService.confirm(actor, orderId, idempotencyKey)`.
- Produces: `PilotReadModel.dashboard(actor)`, `orders(actor)`, `order(actor, id)`, `reviewQueue(actor)`, and `invites(actor)`.

- [ ] **Step 1: Write failing authorization, masking, and idempotency tests**

Create owner A, owner B, provider A, provider B, and admin sessions. Assert:

```ts
expect(await read.orders(ownerA)).toHaveLength(1);
expect(JSON.stringify(await read.orders(ownerA))).not.toContain(ownerBOrder.id);
expect(JSON.stringify(await read.orders(providerB))).not.toContain(ownerAOrder.id);
await expect(read.reviewQueue(ownerA)).rejects.toThrow('FORBIDDEN');

const first = await fees.confirm(admin, ownerAOrder.id, 'manual-fee-0001');
const replay = await fees.confirm(admin, ownerAOrder.id, 'manual-fee-0001');
expect(replay.id).toBe(first.id);
expect(await prisma.payment.count({ where: { orderId: ownerAOrder.id, status: 'SUCCEEDED' } })).toBe(1);
expect(await prisma.auditEvent.count({ where: { action: 'MANUAL_FEE_CONFIRMED' } })).toBe(1);
```

Also assert non-admin confirmation is 403, a different idempotency key after success is 409, responses omit address ciphertext/nonces/auth tags, and provider invitation views contain only city/district/service zone/time/service type before acceptance.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
pnpm --filter @pet/api test -- tests/pilot-business-routes.test.ts
```

Expected: FAIL because the manual fee and pilot read modules do not exist.

- [ ] **Step 3: Allow payment creation without a browser token**

Change `CreatedPayment.paymentToken` to `string | null`, update existing gateways/tests, and implement:

```ts
export class PilotManualPaymentGateway implements PaymentGateway {
  public readonly providerName = 'pilot-manual';
  async createPayment(request: CreatePaymentRequest) {
    return { providerPaymentId: `pilot-manual-${request.orderId}`, paymentToken: null };
  }
  verifyWebhook(): never { throw new Error('PAYMENT_VERIFICATION_FAILED'); }
  async refund(): Promise<never> { throw new Error('MANUAL_REFUND_REQUIRED'); }
}
```

The order route must return `paymentToken: null` in pilot mode and must never invent a token.

- [ ] **Step 4: Implement atomic manual fee confirmation**

Persist the idempotency key in a new nullable unique `Payment.manualConfirmationKey` column through `prisma/migrations/202608250002_manual_fee_key/migration.sql`. `confirm` must authorize `ADMIN`, require 8–100 characters, load a `pilot-manual` payment, and transactionally guard `Payment.status=CREATED` plus `Order.status=PENDING_PAYMENT`. Update payment to `SUCCEEDED`, set `providerEventId` to `pilot-manual:<idempotencyKey>`, update order to `PENDING_DISPATCH`, and append only this audit payload:

```ts
{ provider: 'pilot-manual', amountFen: payment.amountFen }
```

Do not put the idempotency key or any user/address data in audit metadata.

- [ ] **Step 5: Implement explicit role-shaped read objects**

Do not spread Prisma records into responses. Build objects with named fields. The shared order summary is:

```ts
type PilotOrderSummary = {
  id: string;
  serviceType: 'CAT_FEEDING' | 'DOG_WALKING';
  status: OrderStatus;
  startsAt: string;
  durationMinutes: number;
  totalFen: number;
  currency: 'CNY';
  district: string;
  serviceZone: string;
  ownerDisplayName?: string;
  providerDisplayName?: string;
  invitation?: { id: string; status: InvitationStatus; expiresAt: string };
  report?: { notes: string; submittedAt: string; checklist: unknown };
};
```

Only owner/admin objects contain owner-safe notes; only the assigned provider inside the allowed window obtains exact address through the existing address route. Limit every list to 100 and sort by `createdAt desc`.

- [ ] **Step 6: Register pilot routes and verify GREEN**

Expose the exact endpoints from the design plus:

```text
POST /api/v1/pilot/invites
POST /api/v1/pilot/orders/:orderId/manual-fee-confirmation
GET  /api/v1/pilot/dashboard
GET  /api/v1/pilot/orders
GET  /api/v1/pilot/orders/:orderId
GET  /api/v1/pilot/providers/review-queue
GET  /api/v1/pilot/invites
POST /api/v1/pilot/orders/:orderId/check-in
POST /api/v1/pilot/orders/:orderId/report
```

The pilot check-in route accepts `{ beforeState }` and passes the server clock to `FulfillmentService.checkIn`; the pilot report route accepts `{ checklist, afterState, notes }` and passes the server clock as `checkedOutAt`. Preserve the existing non-pilot route contracts, but never accept client timestamps from `PilotApp`.

Run:

```powershell
pnpm exec prisma generate --schema prisma/schema.prisma
pnpm --filter @pet/api test -- tests/pilot-business-routes.test.ts
pnpm --filter @pet/api test
pnpm --filter @pet/api typecheck
git diff --check
```

Expected: all API tests pass and role-isolation assertions remain green.

- [ ] **Step 7: Commit Task 3**

```powershell
git add prisma apps/api/src apps/api/tests
git commit -m "feat: add pilot fee and shared read models"
```

---

### Task 4: Provide Path-Safe Development Evidence Storage

**Files:**
- Create: `apps/api/src/adapters/local-pilot-object-storage.ts`
- Create: `apps/api/src/pilot/local-upload-routes.ts`
- Create: `apps/api/tests/local-pilot-object-storage.test.ts`

**Interfaces:**
- Produces: `LocalPilotObjectStorage implements ObjectStorage`.
- Produces: `acceptUpload(token, bytes)`, `readObject(token)`, and `registerLocalUploadRoutes`.

- [ ] **Step 1: Write failing storage security tests**

Use a test-created temporary directory and assert issue → PUT → verify → signed read succeeds. Also assert traversal, expired signatures, oversized bytes, wrong SHA-256, wrong MIME metadata, and a token signed for another object all fail without creating files.

```ts
const issued = await storage.issueUpload({
  objectKey: `orders/${orderId}/evidence-1`, mimeType: 'image/png',
  sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  expiresInSeconds: 600,
});
await storage.acceptUpload(new URL(issued.uploadUrl, 'http://pilot').searchParams.get('token')!, bytes);
expect(await storage.verifyUpload(issued.objectKey, expected)).toBe(true);
```

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
pnpm --filter @pet/api test -- tests/local-pilot-object-storage.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement signed upload/read tokens and filesystem containment**

Encode `{ operation, objectKey, mimeType, sizeBytes, sha256, expiresAt }` as Base64URL JSON and append an HMAC-SHA256 signature using a purpose distinct from login credentials. Resolve object paths only after checking:

```ts
const resolved = path.resolve(rootDir, objectKey);
const root = path.resolve(rootDir) + path.sep;
if (!resolved.startsWith(root)) throw new Error('FORBIDDEN');
```

Write uploads through a temporary sibling file followed by atomic rename. Store metadata in a sibling `.json`; never serve the directory statically. `readObject` returns bytes only after validating a signed, unexpired read token.

- [ ] **Step 4: Register raw byte routes**

Add a scoped content-type parser for `application/octet-stream`, then expose:

```text
PUT /api/v1/pilot/local-evidence?token=...
GET /api/v1/pilot/local-evidence?token=...
```

The adapter itself authenticates the signed token; the GET response uses the stored MIME type and `Cache-Control: private, no-store`.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
pnpm --filter @pet/api test -- tests/local-pilot-object-storage.test.ts
pnpm --filter @pet/api typecheck
git diff --check
git add apps/api/src/adapters/local-pilot-object-storage.ts apps/api/src/pilot/local-upload-routes.ts apps/api/tests/local-pilot-object-storage.test.ts
git commit -m "feat: store pilot evidence safely on disk"
```

---

### Task 5: Build an Executable Same-Origin Pilot Server

**Files:**
- Create: `apps/api/src/pilot/composition.ts`
- Create: `apps/api/src/pilot/bootstrap.ts`
- Create: `apps/api/src/server.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/health.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `apps/api/tests/pilot-composition.test.ts`

**Interfaces:**
- Produces: `createPilotApplication(config, overrides?)` returning `{ app, prisma }`.
- Produces executable `pnpm pilot:start` and terminal-only `pnpm pilot:bootstrap`.

- [ ] **Step 1: Write failing composition and restart tests**

Build the app against a real test database, create/redeem an owner invitation, close the Fastify/Prisma instances, recreate them, and assert the same session authenticates and the same user remains. Assert `/health/ready` is 200 only after `SELECT 1` succeeds and returns provider labels without keys.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
pnpm --filter @pet/api test -- tests/pilot-composition.test.ts
```

Expected: FAIL because no composition root or executable server exists.

- [ ] **Step 3: Wire existing services with explicit pilot adapters**

Use existing constructors and these fixed local pilot policies:

```ts
const pricing = {
  baseFen: { CAT_FEEDING: 3200, DOG_WALKING: 3700 },
  includedPets: 1, extraPetFen: 700,
  includedMinutes: { CAT_FEEDING: 25, DOG_WALKING: 30 },
  extraDurationBlockMinutes: 20, extraDurationBlockFen: 700,
  includedDistanceKm: 5, extraDistanceKmFen: 100,
  holidayMultiplierBps: 10_000,
};
```

Use a service-zone distance calculator that returns `0` for the four configured districts and rejects every other zone. Use the real `PrismaAuditRepository`, `FieldCrypto`, `QuoteService`, `OrderService`, `ProviderService`, `DispatchService`, `FulfillmentService`, `SettlementService`, and pilot services. The alert sink may log only `{ orderId, reason }`.

In development, create `LocalPilotObjectStorage` only when `PILOT_EVIDENCE_DIR` is an explicit absolute path. In production pilot mode, require an injected `S3Signer` and create the existing `S3ObjectStorage`; if the signer is absent, fail startup before listening. Never silently substitute filesystem storage in production.

- [ ] **Step 4: Serve the built PilotApp from the same origin**

Mount `@fastify/static` only after API routes, with `wildcard: false`. Add a final GET fallback for non-`/api` paths that returns `index.html`; `/api` misses must stay JSON 404. Set HTML responses to `Cache-Control: no-store` and hashed assets to long-lived immutable caching.

- [ ] **Step 5: Add safe commands and ignore local evidence**

Add package scripts:

```json
{
  "pilot:build": "pnpm --filter @pet/admin build --mode pilot",
  "pilot:start": "pnpm pilot:build && pnpm --filter @pet/api start:pilot",
  "pilot:bootstrap": "pnpm --filter @pet/api bootstrap:pilot"
}
```

The API package uses `tsx` as a development dependency for `start:pilot` and `bootstrap:pilot`. Add `.pilot-evidence/` to `.gitignore`. Bootstrap prints exactly the raw code once to stdout and prints operational messages to stderr; it must not accept or print the pepper.

- [ ] **Step 6: Verify GREEN and commit**

```powershell
pnpm --filter @pet/api test -- tests/pilot-composition.test.ts
pnpm --filter @pet/api test
pnpm --filter @pet/api typecheck
pnpm pilot:build
git diff --check
git add package.json pnpm-lock.yaml .gitignore apps/api apps/admin
git commit -m "feat: run the invitation-only pilot server"
```

---

### Task 6: Add Session Bootstrap, Nickname, and Admin Invitation UI

**Files:**
- Modify: `apps/admin/src/main.tsx`
- Create: `apps/admin/src/pilot/models.ts`
- Create: `apps/admin/src/pilot/api.ts`
- Create: `apps/admin/src/pilot/PilotApp.tsx`
- Create: `apps/admin/src/pilot/LoginPanel.tsx`
- Create: `apps/admin/src/pilot/ProfilePanel.tsx`
- Create: `apps/admin/src/pilot/AdminInvitePanel.tsx`
- Create: `apps/admin/src/pilot/api.test.ts`
- Create: `apps/admin/src/pilot/PilotApp.test.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Produces: `PilotApi` methods matching all `/api/v1/pilot` endpoints.
- Produces: `PilotApp` that renders exactly one role from server session data and never exposes a role switcher.

- [ ] **Step 1: Write failing client and render tests**

Assert `PilotApi` sends `credentials: 'same-origin'`, uses `Content-Type: application/json`, creates 8–100-character idempotency keys for writes, maps `{ code }` errors to safe Chinese messages, and never reads/writes localStorage. Render tests must show login when session is 401, nickname setup when `displayName` is null, and admin invitation controls only for `ADMIN`.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
pnpm --filter @pet/admin test -- src/pilot/api.test.ts src/pilot/PilotApp.test.tsx
```

Expected: FAIL because pilot client/components do not exist.

- [ ] **Step 3: Implement typed API transport**

Use one request helper:

```ts
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) throw new PilotApiError(response.status, await safeErrorCode(response));
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
```

Never accept a token argument. Invitation codes exist only in the controlled login input and the one-time admin creation response.

- [ ] **Step 4: Implement session state and build-time app selection**

In `main.tsx`:

```tsx
const pilotMode = import.meta.env.MODE === 'pilot';
createRoot(document.getElementById('root')!).render(
  <StrictMode>{pilotMode ? <PilotApp/> : operatorFixture ? <Console/> : <DemoApp/>}</StrictMode>,
);
```

`PilotApp` loads `/v1/pilot/session` once, displays a retryable service-unavailable state on 503, and shows no protected workspace until the session and nickname are valid.

- [ ] **Step 5: Implement one-time invitation display**

`AdminInvitePanel` selects only `OWNER` or `PROVIDER`, calls create invite, and renders the returned raw code in a `role=status` block with expiry and the exact warning `邀请码仅显示一次，请通过受控线下渠道交付。`. A subsequent refresh uses metadata and cannot redisplay the code.

- [ ] **Step 6: Verify GREEN, responsive controls, and commit**

```powershell
pnpm --filter @pet/admin test -- src/pilot/api.test.ts src/pilot/PilotApp.test.tsx
pnpm --filter @pet/admin typecheck
pnpm --filter @pet/admin build --mode pilot
git diff --check
git add apps/admin/src
git commit -m "feat: add pilot login and invitation UI"
```

---

### Task 7: Add the PostgreSQL-Backed Owner Workspace

**Files:**
- Create: `apps/admin/src/pilot/districts.ts`
- Create: `apps/admin/src/pilot/OwnerPilotWorkspace.tsx`
- Create: `apps/admin/src/pilot/OwnerPilotWorkspace.test.tsx`
- Modify: `apps/admin/src/pilot/PilotApp.tsx`
- Modify: `apps/admin/src/pilot/api.ts`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: owner pet/address/quote/order routes plus pilot read endpoints.
- Produces: an owner-only sequential workflow with no sensitive browser persistence.

- [ ] **Step 1: Write failing owner workspace tests**

Render with a fake `PilotApi` and assert: district list contains exactly four allowed districts; service choices contain exactly two services; access instructions are not present; submit order uses the server quote and generated idempotency key; owner sees only returned own orders; pending payment copy is `等待平台核对费用`; report confirmation calls the correct order endpoint.

- [ ] **Step 2: Run focused test and verify RED**

```powershell
pnpm --filter @pet/admin test -- src/pilot/OwnerPilotWorkspace.test.tsx
```

Expected: FAIL because the owner pilot workspace does not exist.

- [ ] **Step 3: Implement deterministic district mapping and forms**

Use non-sensitive district centroids only for matching calculations:

```ts
export const PILOT_DISTRICTS = [
  { district: '建邺区', zone: '建邺区', latitude: 32.003, longitude: 118.732 },
  { district: '鼓楼区', zone: '鼓楼区', latitude: 32.066, longitude: 118.769 },
  { district: '玄武区', zone: '玄武区', latitude: 32.048, longitude: 118.798 },
  { district: '秦淮区', zone: '秦淮区', latitude: 32.039, longitude: 118.795 },
] as const;
```

Collect pet nickname/species, district, exact service-address detail, service time, duration, and non-sensitive notes. Submit `accessInstructions: ''`. Do not cache exact address, notes, or report content in localStorage/sessionStorage.

- [ ] **Step 4: Implement order status/report actions**

Reload order lists after each mutation. Only show confirm for `PENDING_CONFIRMATION`; show report notes/checklist from the server read model. Translate statuses through an exhaustive `Record<OrderStatus, string>` so unknown states fail typecheck.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
pnpm --filter @pet/admin test -- src/pilot/OwnerPilotWorkspace.test.tsx
pnpm --filter @pet/admin typecheck
pnpm --filter @pet/admin build --mode pilot
git diff --check
git add apps/admin/src/pilot apps/admin/src/styles.css
git commit -m "feat: add pilot owner order workspace"
```

---

### Task 8: Add Admin Dispatch and Provider Fulfillment Workspaces

**Files:**
- Create: `apps/admin/src/pilot/checklists.ts`
- Create: `apps/admin/src/pilot/AdminPilotWorkspace.tsx`
- Create: `apps/admin/src/pilot/ProviderPilotWorkspace.tsx`
- Create: `apps/admin/src/pilot/AdminPilotWorkspace.test.tsx`
- Create: `apps/admin/src/pilot/ProviderPilotWorkspace.test.tsx`
- Modify: `apps/admin/src/pilot/PilotApp.tsx`
- Modify: `apps/admin/src/pilot/api.ts`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: provider application/availability/review, manual fee, dispatch, invitation accept, address, upload/evidence, check-in, report APIs.
- Produces: server-session-bound admin/provider workflows with no client role switching.

- [ ] **Step 1: Write failing role and workflow tests**

Assert admin can review, confirm manual fee, and start dispatch; admin copy says `本系统未处理在线支付`. Assert provider cannot select another identity, sees only returned own invitations/tasks, cannot display an assigned address before the API returns it, and must complete the service-specific checklist plus attach evidence before report submission.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
pnpm --filter @pet/admin test -- src/pilot/AdminPilotWorkspace.test.tsx src/pilot/ProviderPilotWorkspace.test.tsx
```

Expected: FAIL because both workspaces do not exist.

- [ ] **Step 3: Implement admin actions with scoped confirmations**

Render separate queues for provider review, pending fee, pending dispatch, and dispatch failures. Before a state-changing click, show the target nickname/order ID in an inline confirmation panel; do not use a bulk action. Pass a fresh idempotency key to manual fee confirmation and disable the button while pending.

- [ ] **Step 4: Implement provider application, availability, and invitations**

Use the selected district centroid and radius `5`. Experience months are integer inputs bounded 0–1200. Availability must fully cover the proposed order window. The provider page derives identity only from `/session` and contains no identity select.

- [ ] **Step 5: Implement evidence and report submission**

For the chosen local image, calculate:

```ts
const bytes = new Uint8Array(await file.arrayBuffer());
const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map((value) => value.toString(16).padStart(2, '0')).join('');
```

Then issue upload, `PUT` bytes to the returned URL with the exact MIME type, attach evidence metadata, and submit the exhaustive checklist. Keep the UI definition aligned with `validateChecklist`:

```ts
export const CHECKLIST_DEFINITIONS = {
  CAT_FEEDING: ['petCountConfirmed', 'foodRefilled', 'waterRefilled', 'litterCleaned'],
  DOG_WALKING: ['leashSecured', 'walkDurationMinutes'],
} as const;
```

Cat values are all `true`. Dog reports require `leashSecured: true` and a finite positive numeric `walkDurationMinutes`; do not convert the duration to a boolean checkbox.

Use the pilot check-in/report endpoints whose timestamps come from the server clock; do not send or fake check-in/check-out time on the client.

- [ ] **Step 6: Verify GREEN, phone layout, and commit**

```powershell
pnpm --filter @pet/admin test -- src/pilot/AdminPilotWorkspace.test.tsx src/pilot/ProviderPilotWorkspace.test.tsx
pnpm --filter @pet/admin typecheck
pnpm --filter @pet/admin build --mode pilot
git diff --check
git add apps/admin/src/pilot apps/admin/src/styles.css
git commit -m "feat: close pilot dispatch and fulfillment UI"
```

---

### Task 9: Verify Three-Session Persistence and Document Safe Operation

**Files:**
- Create: `apps/admin/e2e/pilot.fixture.ts`
- Create: `apps/admin/e2e/pilot-shared-loop.spec.ts`
- Modify: `apps/admin/playwright.config.ts`
- Modify: `README.md`
- Modify: `docs/operations/LOCAL.md`
- Modify: `docs/operations/NANJING_PILOT.md`
- Modify: `docs/superpowers/plans/2026-08-25-pilot-invite-shared-backend.md`

**Interfaces:**
- Consumes all prior tasks.
- Produces repeatable full-flow acceptance evidence and operator instructions that contain no secrets.

- [ ] **Step 1: Write the failing real-database Playwright scenario**

The fixture must start `createPilotApplication` in-process and call `bootstrapAdminInvite()` directly, retaining raw codes only in test variables. Use three isolated browser contexts. The test performs:

```text
admin login → create owner/provider invites
provider login → set nickname → apply → set availability
admin approve provider
owner login → set nickname → pet → encrypted address → quote → order
admin manual fee confirmation → start dispatch
provider sees only own invitation → accept → check-in → upload evidence → report
owner sees only own report → confirm
API restart → all three sessions reload → completed order persists
revoked session → 401
second owner/provider → cross-account reads and writes return 403/404
```

Use dynamically computed service times within the backend check-in window and a generated 1×1 PNG fixture held in memory. Do not write raw invitation codes to disk or Playwright attachments.

- [ ] **Step 2: Run the new E2E test and verify RED**

```powershell
pnpm --filter @pet/admin test:e2e -- pilot-shared-loop.spec.ts
```

Expected: FAIL at the first missing/incomplete shared pilot interaction.

- [ ] **Step 3: Complete only defects exposed by the E2E test**

For every failure, add or refine the smallest focused unit/integration test first, observe it fail, implement the minimal correction, rerun the focused test, then resume the E2E scenario. Do not weaken cross-role assertions or substitute demo localStorage state.

- [ ] **Step 4: Add responsive and privacy assertions**

At 390×844 and desktop, assert all visible buttons/inputs/selects have at least 44px height, `document.documentElement.scrollWidth <= window.innerWidth`, no console errors, and no page label/placeholder matches:

```ts
/手机号|微信号|邮箱|身份证|证件照片|银行卡|支付码|门锁密码/
```

Assert cookies are HttpOnly from response headers and `localStorage.length` remains zero in pilot mode.

- [ ] **Step 5: Document exact safe startup**

README and operations docs must explain generating keys without showing real values, applying migrations, building, bootstrapping, starting, distributing codes offline, and stopping. State clearly that this is invitation-only, manual-fee, single-node pilot software and not an approved public booking/payment system.

- [ ] **Step 6: Run final verification on Node 22 and a fresh database**

Use a uniquely named `petcare_verify_<timestamp>_<8hex>` database. Apply every migration, then run:

```powershell
pnpm check
pnpm pilot:build
pnpm --filter @pet/admin test:e2e
git diff --check
```

Restart the API inside the pilot E2E scenario, verify data persistence, then drop the exact temporary database with `WITH (FORCE)` and delete only the explicitly configured temporary evidence directory. Confirm both residual counts are zero.

- [ ] **Step 7: Update this plan and commit Task 9**

Check completed local steps in this file, leaving external deployment unchecked because no production domain/credentials are authorized. Then commit:

```powershell
git add README.md docs apps/admin/e2e apps/admin/playwright.config.ts
git commit -m "test: verify invitation-only pilot loop"
```

## External Deployment Gate

- [ ] Provision a private/controlled server, PostgreSQL 16 database, HTTPS domain, field-encryption key, pilot auth pepper, and S3-compatible evidence storage outside Git.
- [ ] Obtain action-time approval before transmitting any production secrets or changing public DNS, repository secrets, cloud permissions, or deployment state.
- [ ] Run the same three-session acceptance against the deployed origin before calling the pilot usable for real customers.
