# Production Web Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the same-origin production website accept real guest-owner orders, recover those orders with a high-entropy credential, authenticate staff without invitations, and support owner–platform order messages.

**Architecture:** Extend the existing `User`/`PilotSession` identity boundary instead of building a second order system. Three focused services own guest recovery, staff credentials, and encrypted order conversations; Fastify routes expose them through the existing cookie/origin guard, and the React pilot app consumes them while keeping GitHub Pages in demo mode.

**Tech Stack:** Node.js 22, TypeScript 5.9, Fastify 5, Prisma 6/PostgreSQL 16, Zod 4, React, Vitest, Playwright, Argon2id via `argon2@0.45.1`, pnpm 10.15.0.

## Global Constraints

- Work in an isolated worktree created with `superpowers:using-git-worktrees`; never implement directly on `main`.
- Use Node.js `>=22 <23` and pnpm `10.15.0` for every command.
- Use TDD for every production change: failing test, observed failure, minimal implementation, passing test, commit.
- Only `CAT_FEEDING` and `DOG_WALKING` in 南京市 remain supported.
- Owners use no invitation, phone number, QR code, SMS code, password registration, or public role selector.
- Staff have no public registration; ADMIN creates PROVIDER credentials, while the first ADMIN is created by an interactive server command.
- No online payment, automated refund, live chat, WebSocket, push notification, map navigation, or automatic dispatch.
- Recovery tokens, session tokens, passwords, full addresses, message plaintext, and secrets must never enter logs, audit metadata, repository files, URLs with query parameters, localStorage, or sessionStorage.
- GitHub Pages remains the local-only demo. Real data is enabled only by the same-origin pilot build.
- Public and staff state-changing routes use strict schemas, exact Origin checks, no-store responses, body limits, and bounded rate limiting.
- All core visible controls remain at least 44px high with no horizontal overflow at 390px, 900px, and 1440px.

---

## File Map

### Database and security primitives

- Modify `prisma/schema.prisma` — relations and three new models.
- Create `prisma/migrations/202609020001_production_web_access/migration.sql` — additive tables, constraints, and indexes.
- Modify `apps/api/package.json`, `pnpm-lock.yaml` — pin `argon2@0.45.1`.
- Create `apps/api/src/auth/owner-recovery-credential.ts` — token generation and domain-separated digest.
- Create `apps/api/src/auth/password-hasher.ts` — fixed Argon2id policy.

### Backend services and routes

- Modify `apps/api/src/auth/pilot-session-service.ts` — issue a session for an already authorized user and revoke all sessions for a user.
- Create `apps/api/src/auth/public-owner-access-service.ts` — guest OWNER and recovery lifecycle.
- Create `apps/api/src/auth/staff-credential-service.ts` — staff login, create, list, disable, reset, and change password.
- Create `apps/api/src/auth/production-access-routes.ts` — public owner and staff HTTP contracts.
- Create `apps/api/src/conversations/order-conversation-service.ts` — encrypted owner/admin messages.
- Create `apps/api/src/conversations/routes.ts` — message list/create routes.
- Modify `apps/api/src/app.ts`, `apps/api/src/pilot/composition.ts`, `apps/api/src/health.ts` — composition, safe errors, route registration, and initial-admin readiness.
- Create `apps/api/src/pilot/create-staff.ts` — interactive initial ADMIN command.
- Modify `apps/api/package.json`, root `package.json` — staff bootstrap script.

### Website

- Modify `apps/admin/src/pilot/models.ts`, `apps/admin/src/pilot/api.ts` — strict client contracts.
- Create `apps/admin/src/pilot/StaffLoginPanel.tsx` — staff-only login.
- Create `apps/admin/src/pilot/StaffPasswordPanel.tsx` — mandatory first password change.
- Create `apps/admin/src/pilot/RecoveryCredentialCard.tsx` — copy/download/rotate credential.
- Create `apps/admin/src/pilot/OrderConversation.tsx` — owner/admin message UI.
- Create `apps/admin/src/pilot/StaffAccountPanel.tsx` — ADMIN staff management.
- Modify `apps/admin/src/pilot/PilotApp.tsx`, `OwnerPilotWorkspace.tsx`, `AdminPilotWorkspace.tsx`, `PublicLanding.tsx`, and `customer-web.css` — entry flow and integrated panels.

### Acceptance and operations

- Create `apps/admin/e2e/production-web-access.spec.ts` — multi-context real loop.
- Modify `scripts/run-pilot-live-acceptance.mjs` — seed initial staff credentials through a controlled child-process channel.
- Modify `docs/operations/pilot-quickstart.md`, `deploy/README.md`, `deploy/.env.production.example`, `README.md` — truthful setup and boundaries.
- Modify `scripts/production-deployment-files.test.mjs` — production gates.

---

### Task 1: Additive schema and pinned password dependency

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202609020001_production_web_access/migration.sql`
- Modify: `apps/api/package.json`
- Modify: root `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `apps/api/tests/schema.test.ts`

**Interfaces:**
- Produces Prisma models `OwnerRecoveryCredential`, `StaffCredential`, and `OrderMessage` with relations on `User` and `Order`.
- Later tasks consume generated delegates `prisma.ownerRecoveryCredential`, `prisma.staffCredential`, and `prisma.orderMessage`.

- [ ] **Step 1: Write the failing schema test**

```ts
it('adds guest recovery, staff credential and encrypted order message storage', async () => {
  const schema = await readFile('../../prisma/schema.prisma', 'utf8');
  const sql = await readFile('../../prisma/migrations/202609020001_production_web_access/migration.sql', 'utf8');
  for (const model of ['OwnerRecoveryCredential', 'StaffCredential', 'OrderMessage']) {
    expect(schema).toContain(`model ${model}`);
    expect(sql).toContain(`CREATE TABLE "${model}"`);
  }
  expect(schema).toContain('tokenHash          String    @unique @db.Char(64)');
  expect(schema).toContain('usernameNormalized String    @unique @db.VarChar(64)');
  expect(schema).toContain('bodyCiphertext      Bytes');
  expect(sql).toContain('CHECK ("authorRole" IN (\'OWNER\', \'ADMIN\'))');
});
```

- [ ] **Step 2: Run the test and observe the missing migration failure**

Run: `pnpm --filter @pet/api test -- schema.test.ts`

Expected: FAIL because `202609020001_production_web_access/migration.sql` and the three models do not exist.

- [ ] **Step 3: Add the three models and relations**

Use these exact relation fields and model shapes:

```prisma
model OwnerRecoveryCredential {
  id         String    @id @default(uuid()) @db.Uuid
  userId     String    @unique @db.Uuid
  lookupPrefix String  @db.Char(12)
  tokenHash  String    @unique @db.Char(64)
  createdAt  DateTime  @default(now()) @db.Timestamptz(3)
  rotatedAt  DateTime? @db.Timestamptz(3)
  lastUsedAt DateTime? @db.Timestamptz(3)
  revokedAt  DateTime? @db.Timestamptz(3)
  user       User      @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@index([lookupPrefix])
}

model StaffCredential {
  id                 String    @id @default(uuid()) @db.Uuid
  userId             String    @unique @db.Uuid
  usernameNormalized String    @unique @db.VarChar(64)
  passwordHash       String
  mustChangePassword Boolean   @default(true)
  failedAttempts     Int       @default(0)
  lockedUntil        DateTime? @db.Timestamptz(3)
  passwordChangedAt  DateTime? @db.Timestamptz(3)
  disabledAt         DateTime? @db.Timestamptz(3)
  createdAt          DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt          DateTime  @updatedAt @db.Timestamptz(3)
  user               User      @relation(fields: [userId], references: [id], onDelete: Restrict)
}

model OrderMessage {
  id                   String    @id @default(uuid()) @db.Uuid
  orderId              String    @db.Uuid
  authorUserId         String    @db.Uuid
  authorRole           ActorRole
  bodyCiphertext       Bytes
  bodyNonce            Bytes
  bodyAuthTag          Bytes
  encryptionKeyVersion Int
  createdAt            DateTime  @default(now()) @db.Timestamptz(3)
  order                Order     @relation(fields: [orderId], references: [id], onDelete: Restrict)
  author               User      @relation("OrderMessageAuthor", fields: [authorUserId], references: [id], onDelete: Restrict)

  @@index([orderId, createdAt, id])
}
```

Add `ownerRecoveryCredential`, `staffCredential`, `orderMessagesAuthored`, and `messages` relations to `User`/`Order`. Write additive SQL with unique/index constraints and a database check limiting `authorRole` to OWNER or ADMIN. Do not alter or drop existing columns.

- [ ] **Step 4: Pin Argon2id and regenerate Prisma**

Run: `pnpm --filter @pet/api add argon2@0.45.1`, add `argon2` to the root `pnpm.onlyBuiltDependencies` allowlist together with the existing Prisma/esbuild build dependencies, then run `pnpm install --frozen-lockfile && pnpm exec prisma generate`.

Expected: package and lockfile change; Prisma Client generation succeeds under Node 22.

- [ ] **Step 5: Verify schema and migration**

Run: `pnpm --filter @pet/api test -- schema.test.ts && pnpm typecheck`

Expected: schema tests and workspace typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma apps/api/package.json package.json pnpm-lock.yaml apps/api/tests/schema.test.ts
git commit -m "feat: add production web access schema"
```

---

### Task 2: Credential primitives and session issuance

**Files:**
- Create: `apps/api/src/auth/owner-recovery-credential.ts`
- Create: `apps/api/src/auth/password-hasher.ts`
- Modify: `apps/api/src/auth/pilot-session-service.ts`
- Test: `apps/api/tests/owner-recovery-credential.test.ts`
- Test: `apps/api/tests/password-hasher.test.ts`
- Test: `apps/api/tests/pilot-session-service.test.ts`

**Interfaces:**
- Produces `generateOwnerRecoveryToken(): string`, `ownerRecoveryLookupPrefix(token): string`, `digestOwnerRecoveryToken(pepper, token): string`, and `matchesOwnerRecoveryToken(pepper, token, storedHash): boolean` using `timingSafeEqual`.
- Produces `PasswordHasher.hash(password): Promise<string>` and `PasswordHasher.verify(hash, password): Promise<boolean>`.
- Produces `PilotSessionService.createSessionForUser(userId): Promise<{token:string; expiresAt:Date}>` and `revokeAllForUser(userId): Promise<number>`.

- [ ] **Step 1: Add failing primitive tests**

```ts
it('creates canonical 256-bit Base64URL recovery tokens with a separate digest domain', () => {
  const token = generateOwnerRecoveryToken();
  expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(digestOwnerRecoveryToken(Buffer.alloc(32, 7), token)).toMatch(/^[a-f0-9]{64}$/);
  expect(digestOwnerRecoveryToken(Buffer.alloc(32, 7), token))
    .not.toBe(digestPilotCredential(Buffer.alloc(32, 7), 'session', token));
  expect(ownerRecoveryLookupPrefix(token)).toBe(token.slice(0, 12));
  expect(matchesOwnerRecoveryToken(Buffer.alloc(32, 7), token,
    digestOwnerRecoveryToken(Buffer.alloc(32, 7), token))).toBe(true);
});

it('uses the fixed Argon2id policy and rejects invalid lengths', async () => {
  const hasher = new PasswordHasher();
  const hash = await hasher.hash('correct horse battery staple');
  expect(hash).toMatch(/^\$argon2id\$/);
  await expect(hasher.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
  await expect(hasher.hash('short')).rejects.toThrow('PASSWORD_INVALID');
});
```

- [ ] **Step 2: Run tests and observe missing modules**

Run: `pnpm --filter @pet/api test -- owner-recovery-credential.test.ts password-hasher.test.ts`

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement credential primitives**

```ts
export function generateOwnerRecoveryToken(): string {
  return randomBytes(32).toString('base64url');
}

export function digestOwnerRecoveryToken(pepper: Buffer, token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('RECOVERY_INVALID');
  return createHmac('sha256', pepper)
    .update(`owner-recovery-v1\0${token}`, 'utf8').digest('hex');
}

export function matchesOwnerRecoveryToken(pepper: Buffer, token: string, storedHash: string): boolean {
  const actual = Buffer.from(digestOwnerRecoveryToken(pepper, token), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class PasswordHasher {
  async hash(password: string): Promise<string> {
    if (password.length < 12 || password.length > 128) throw new Error('PASSWORD_INVALID');
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  }
  async verify(hash: string, password: string): Promise<boolean> {
    if (password.length < 1 || password.length > 128) return false;
    try { return await argon2.verify(hash, password); } catch { return false; }
  }
}
```

- [ ] **Step 4: Add failing session issuance tests, then implement through the existing token factory**

Test that `createSessionForUser` stores only the session digest and that `revokeAllForUser` revokes every active session. Implement both in `PilotSessionService`; keep the raw token only in the return value and use `digestPilotCredential(..., 'session', token)`.

Run: `pnpm --filter @pet/api test -- pilot-session-service.test.ts`

Expected: new tests PASS and all existing invitation/WeChat/local-session tests remain green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth apps/api/tests
git commit -m "feat: add secure web credential primitives"
```

---

### Task 3: Guest owner and recovery service

**Files:**
- Create: `apps/api/src/auth/public-owner-access-service.ts`
- Test: `apps/api/tests/public-owner-access-service.test.ts`

**Interfaces:**
- Consumes `PilotSessionService.createSessionForUser`, `generateOwnerRecoveryToken`, and `digestOwnerRecoveryToken`.
- Consumes `AuditRepository`; guest creation, credential issue/rotate, and successful recovery append metadata-only events with no token or digest.
- Produces:

```ts
type OwnerSessionResult = { created: boolean; session?: { token: string; expiresAt: Date }; expiresAt: Date };
class PublicOwnerAccessService {
  ensureOwnerSession(authorization?: string): Promise<OwnerSessionResult>;
  issueRecovery(actor: ActorContext): Promise<{ token: string; recoveryPath: string }>;
  rotateRecovery(actor: ActorContext): Promise<{ token: string; recoveryPath: string }>;
  recover(token: string): Promise<{ token: string; expiresAt: Date }>;
}
```

- [ ] **Step 1: Write failing transaction and authorization tests**

Cover: anonymous creation produces one OWNER named `访客宠主`; an existing OWNER session is reused; an ADMIN/PROVIDER cookie is forbidden; concurrent issue calls create one credential; repeat issue returns `RECOVERY_ALREADY_ISSUED`; rotate invalidates the old digest; recover reads at most eight matching 12-character-prefix candidates, uses `matchesOwnerRecoveryToken`, updates `lastUsedAt`, and signs a new session; malformed/revoked/overfull-prefix candidate sets all throw `RECOVERY_INVALID`. Assert audit actions `OWNER_GUEST_CREATED`, `OWNER_RECOVERY_ISSUED`, `OWNER_RECOVERY_ROTATED`, and `OWNER_RECOVERY_USED` contain only user/credential IDs and never token, prefix, or digest.

```ts
await expect(service.ensureOwnerSession()).resolves.toMatchObject({ created: true });
await expect(service.issueRecovery(ownerActor)).resolves.toMatchObject({
  token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  recoveryPath: expect.stringMatching(/^\/#\/orders\/access\//),
});
await expect(service.recover('x'.repeat(43))).rejects.toThrow('RECOVERY_INVALID');
```

- [ ] **Step 2: Run and observe missing service failure**

Run: `pnpm --filter @pet/api test -- public-owner-access-service.test.ts`

Expected: FAIL because `PublicOwnerAccessService` is absent.

- [ ] **Step 3: Implement serializable creation and constant-shape failures**

Use Prisma serializable transactions with at most three retries on `P2034`/`P2002`. Store `lookupPrefix` on issue/rotate. Recovery queries `take: 9`; any result count above eight fails closed, and all candidates are checked with `matchesOwnerRecoveryToken` before selecting exactly one. Return only `RECOVERY_INVALID` for malformed, unknown, revoked, ambiguous, or non-OWNER credentials. `recoveryPath` must be `/#/orders/access/${token}` and must never contain `?`.

- [ ] **Step 4: Run service and leak-regression tests**

Run: `pnpm --filter @pet/api test -- public-owner-access-service.test.ts pilot-session-service.test.ts`

Expected: PASS; serialized errors and audit fixtures contain no raw token.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/public-owner-access-service.ts apps/api/tests/public-owner-access-service.test.ts
git commit -m "feat: add guest owner recovery service"
```

---

### Task 4: Staff credentials and interactive ADMIN bootstrap

**Files:**
- Create: `apps/api/src/auth/staff-credential-service.ts`
- Create: `apps/api/src/pilot/create-staff.ts`
- Modify: `apps/api/package.json`
- Modify: root `package.json`
- Test: `apps/api/tests/staff-credential-service.test.ts`
- Test: `apps/api/tests/create-staff.test.ts`

**Interfaces:**
- Produces `StaffCredentialService.login`, `changePassword`, `list`, `createProvider`, `setDisabled`, and `resetPassword`.
- Produces root command `pnpm staff:create-admin -- --username <ascii-name>`; password is read twice from hidden stdin and never accepted in argv/env.

```ts
type StaffLoginResult = {
  session: { token: string; expiresAt: Date };
  mustChangePassword: boolean;
};
type StaffAccountDto = {
  userId: string; username: string; displayName: string; role: 'PROVIDER';
  mustChangePassword: boolean; disabledAt: string | null; createdAt: string;
};
```

- [ ] **Step 1: Write failing service tests**

```ts
await service.createProvider(admin, {
  username: 'provider.one', displayName: '服务人员一', temporaryPassword: 'Temporary-pass-2026',
});
await expect(service.login('PROVIDER.ONE', 'Temporary-pass-2026', 'ip:127.0.0.1'))
  .resolves.toMatchObject({ mustChangePassword: true });
await expect(service.createProvider(owner, input)).rejects.toThrow('FORBIDDEN');
```

Also assert five failures lock the username digest and IP key for ten minutes, success resets failures, disabled login has the same `STAFF_LOGIN_INVALID` error, reset revokes all active sessions, only PROVIDER can be created in the web API, and audit metadata contains no username/password/hash.

- [ ] **Step 2: Run and observe missing service failure**

Run: `pnpm --filter @pet/api test -- staff-credential-service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement service with normalized usernames and dummy-hash verification**

Normalize with `/^[a-z0-9][a-z0-9._-]{2,63}$/`, lowercase before lookup, verify a fixed dummy Argon2id hash when no account exists, and throw only `STAFF_LOGIN_INVALID`. Create a session only after password verification and lock checks. `changePassword` clears `mustChangePassword`. Disable and reset each run as a Prisma transaction that updates the credential and revokes every active session for that user before commit.

- [ ] **Step 4: Add the CLI contract test and implementation**

```ts
expect(parseCreateStaffArgs(['--username', 'ops.admin'])).toEqual({ username: 'ops.admin' });
expect(() => parseCreateStaffArgs(['--username', 'ops.admin', '--password', 'secret']))
  .toThrow('PASSWORD_ARG_FORBIDDEN');
```

The CLI must verify stdin is a TTY, prompt twice without echo, create only ADMIN, and print only the created username/user ID. Add `"staff:create-admin": "tsx src/pilot/create-staff.ts"` in API and a root forwarding script.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @pet/api test -- staff-credential-service.test.ts create-staff.test.ts && pnpm typecheck`

Expected: PASS.

```bash
git add apps/api/src/auth/staff-credential-service.ts apps/api/src/pilot/create-staff.ts apps/api/tests apps/api/package.json package.json
git commit -m "feat: add managed staff credentials"
```

---

### Task 5: Production access routes, errors, origin guard, and composition

**Files:**
- Create: `apps/api/src/auth/production-access-routes.ts`
- Modify: `apps/api/src/auth/pilot-routes.ts`
- Modify: `apps/api/src/auth/pilot-origin-guard.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/pilot/composition.ts`
- Modify: `apps/api/src/health.ts`
- Test: `apps/api/tests/production-access-routes.test.ts`
- Test: `apps/api/tests/production-readiness.test.ts`
- Test: `apps/api/tests/pilot-composition.test.ts`

**Interfaces:**
- Exposes the public/staff/admin endpoints listed in the approved spec, including `GET /api/v1/admin/staff-accounts`.
- Extends the session DTO with `mustChangePassword: boolean` for staff; non-staff sessions return `false`.

- [ ] **Step 1: Write failing HTTP contract tests**

Test strict empty-body guest session creation, no-store/no-referrer headers, cookie flags, recovery issue/rotate/exchange, staff login/change password, ADMIN list/create/disable/reset, 2 KiB body limits, exact production Origin, uniform failures, and absence of local role routes in production.

```ts
expect(response.headers['set-cookie']).toMatch(/HttpOnly.*Secure.*SameSite=Lax/i);
expect(response.headers['cache-control']).toBe('no-store');
expect(JSON.stringify(response.json())).not.toMatch(/passwordHash|tokenHash|cookie/i);
```

- [ ] **Step 2: Run and observe 404 failures**

Run: `pnpm --filter @pet/api test -- production-access-routes.test.ts`

Expected: FAIL because the new routes return 404.

- [ ] **Step 3: Implement strict schemas and cookie writers**

Use `.strict()` Zod objects. Reuse the existing `petcare_pilot_session` cookie helper by exporting `writeSessionCookie` from `pilot-routes.ts`; never duplicate cookie options. Register rate-limit settings per public-create/recovery/staff-login route and set response security headers in one route-level hook.

- [ ] **Step 4: Register dependencies and safe errors**

Add `publicOwnerAccess` and `staffCredentials` to `AppDependencies`, create both in `createPilotApplication`, and register the routes only in pilot mode. Extend `PilotSessionContext` with `mustChangePassword: boolean`; `authenticate` reads the optional staff credential and returns `false` for owners. The business `onboardedAuth` wrapper throws `PASSWORD_CHANGE_REQUIRED` before every business route when the flag is true. Map `RECOVERY_ALREADY_ISSUED` to 409, `RECOVERY_INVALID`/`STAFF_LOGIN_INVALID` to uniform 401, `PASSWORD_CHANGE_REQUIRED` to 403, and rate limits to 429. Extend the generic pilot-safe error prefix to `/api/v1/public/` and `/api/v1/staff/` without exposing thrown messages.

- [ ] **Step 5: Gate production readiness on an active ADMIN credential**

Add an async probe that returns false when no active ADMIN `StaffCredential` exists. Development/test readiness remains unchanged. Test both empty production DB and a bootstrapped active ADMIN.

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter @pet/api test -- production-access-routes.test.ts production-readiness.test.ts pilot-composition.test.ts pilot-auth-routes.test.ts && pnpm typecheck`

Expected: PASS.

```bash
git add apps/api/src apps/api/tests
git commit -m "feat: expose production web access routes"
```

---

### Task 6: Encrypted owner–platform order conversations

**Files:**
- Create: `apps/api/src/conversations/order-conversation-service.ts`
- Create: `apps/api/src/conversations/routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/pilot/composition.ts`
- Test: `apps/api/tests/order-conversation-service.test.ts`
- Test: `apps/api/tests/order-conversation-routes.test.ts`

**Interfaces:**
- Produces:

```ts
type OrderMessageDto = { id: string; orderId: string; authorRole: 'OWNER'|'ADMIN'; body: string; createdAt: string };
class OrderConversationService {
  list(actor: ActorContext, orderId: string, cursor?: string): Promise<{items:OrderMessageDto[]; nextCursor?:string}>;
  send(actor: ActorContext, orderId: string, body: string): Promise<OrderMessageDto>;
}
```

- [ ] **Step 1: Write failing service tests**

Cover OWNER-own-order access, ADMIN access, other OWNER/PROVIDER denial, 1–500 trimmed UTF-8 characters, encrypted-at-rest fields, `(createdAt,id)` cursor stability, 50-message page limit, and audit metadata `{orderId,messageId,bodyLength}` with no body.

- [ ] **Step 2: Run and observe missing module failure**

Run: `pnpm --filter @pet/api test -- order-conversation-service.test.ts`

Expected: FAIL because the conversation service is absent.

- [ ] **Step 3: Implement encryption and cursor pagination**

Encrypt with `FieldCrypto.encrypt(body)`, store separate ciphertext/nonce/tag/version, and decrypt only after authorization. Encode the cursor as Base64URL JSON containing ISO `createdAt` and UUID `id`; strict-parse before use.

- [ ] **Step 4: Add and implement route tests**

Expose `GET/POST /api/v1/pilot/orders/:orderId/messages`; POST body is `{body:string}` only. Test 401/403/400/404, no-store headers, and that provider responses never contain plaintext or ciphertext.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @pet/api test -- order-conversation-service.test.ts order-conversation-routes.test.ts sensitive-access.test.ts`

Expected: PASS.

```bash
git add apps/api/src/conversations apps/api/src/app.ts apps/api/src/pilot/composition.ts apps/api/tests
git commit -m "feat: add encrypted order conversations"
```

---

### Task 7: Strict website API models and parsers

**Files:**
- Modify: `apps/admin/src/pilot/models.ts`
- Modify: `apps/admin/src/pilot/api.ts`
- Test: `apps/admin/src/pilot/api.test.ts`

**Interfaces:**
- Produces client methods `ensureOwnerSession`, `issueRecoveryCredential`, `rotateRecoveryCredential`, `recoverOwnerSession`, `createStaffSession`, `changeStaffPassword`, `listStaffAccounts`, `createStaffAccount`, `updateStaffAccount`, `resetStaffPassword`, `listOrderMessages`, and `sendOrderMessage`.
- Adds exact DTOs matching Tasks 5–6; no response may retain unknown credential-named fields.

- [ ] **Step 1: Add failing request and parser tests**

```ts
await api.ensureOwnerSession();
expect(fetcher).toHaveBeenCalledWith('/api/v1/public/owner-sessions', expect.objectContaining({ method: 'POST' }));
await expect(api.recoverOwnerSession('bad token')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
await expect(api.listOrderMessages(orderId)).resolves.toEqual({ items: [], nextCursor: undefined });
```

Also reject unexpected `tokenHash`, `passwordHash`, raw cookie fields, non-UUID IDs, invalid roles, overlong message bodies, and recovery paths containing `?` or a foreign origin.

- [ ] **Step 2: Run and observe missing method/type failures**

Run: `pnpm --filter @pet/admin test -- api.test.ts`

Expected: FAIL at compile/expectation because the methods do not exist.

- [ ] **Step 3: Implement strict DTOs and methods**

Follow existing `asRecord`, `asString`, timestamp, role, and credential-field rejection patterns. Recovery token is accepted only by the recovery request method and must not be returned by generic error serialization.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @pet/admin test -- api.test.ts && pnpm --filter @pet/admin typecheck`

Expected: PASS.

```bash
git add apps/admin/src/pilot/models.ts apps/admin/src/pilot/api.ts apps/admin/src/pilot/api.test.ts
git commit -m "feat: add production access web client"
```

---

### Task 8: Owner entry, recovery, and staff authentication UI

**Files:**
- Create: `apps/admin/src/pilot/StaffLoginPanel.tsx`
- Create: `apps/admin/src/pilot/StaffPasswordPanel.tsx`
- Create: `apps/admin/src/pilot/RecoveryCredentialCard.tsx`
- Modify: `apps/admin/src/pilot/PilotApp.tsx`
- Modify: `apps/admin/src/pilot/OwnerPilotWorkspace.tsx`
- Modify: `apps/admin/src/demo/PublicLanding.tsx`
- Modify: `apps/admin/src/demo/customer-web.css`
- Test: `apps/admin/src/pilot/PilotApp.test.tsx`
- Test: `apps/admin/src/pilot/RecoveryCredentialCard.test.tsx`

**Interfaces:**
- Consumes Task 7 API methods.
- Produces three entry states: public guest owner, fragment recovery, and low-priority staff login.

- [ ] **Step 1: Write failing component tests**

Assert “立即预约” calls `ensureOwnerSession` once under repeated clicks and opens the existing booking UI; no role selector/invitation/phone/QR field is rendered. Test `/#/orders/access/<token>` clears the fragment before calling recover, then opens orders. Test staff login is reachable only by “员工登录”, and `mustChangePassword` blocks workspaces until change succeeds.

- [ ] **Step 2: Run and observe old role-entry UI failures**

Run: `pnpm --filter @pet/admin test -- PilotApp.test.tsx RecoveryCredentialCard.test.tsx`

Expected: FAIL because the old `LoginPanel` role selector remains and recovery components are absent.

- [ ] **Step 3: Implement the entry state machine**

Keep a single in-flight ref for owner session creation, store no secret in Web Storage, clear fragments with `history.replaceState(null, '', pathname + search)`, and keep staff login out of the primary hero. Development can retain direct-role access only behind an explicit API capability returned by the local environment; production UI never assumes it exists.

- [ ] **Step 4: Implement the recovery card**

Render the token masked by default. Copy only on explicit click. Download a UTF-8 text file created from a Blob containing the site origin, recovery fragment, and warning; revoke the object URL immediately. On copy/download failure keep the token in component memory and show a retry error. Closing unmounts and loses the raw token by design.

- [ ] **Step 5: Verify mobile structure and commit**

Run: `pnpm --filter @pet/admin test -- PilotApp.test.tsx RecoveryCredentialCard.test.tsx PublicLanding.test.tsx OwnerPilotWorkspace.test.tsx && pnpm --filter @pet/admin typecheck`

Expected: PASS; style contract still includes 44px controls and no forbidden small/gold text.

```bash
git add apps/admin/src/pilot apps/admin/src/demo
git commit -m "feat: add guest and staff website entry"
```

---

### Task 9: Staff accounts and order message interfaces

**Files:**
- Create: `apps/admin/src/pilot/StaffAccountPanel.tsx`
- Create: `apps/admin/src/pilot/OrderConversation.tsx`
- Modify: `apps/admin/src/pilot/AdminPilotWorkspace.tsx`
- Modify: `apps/admin/src/pilot/OwnerPilotWorkspace.tsx`
- Modify: `apps/admin/src/styles.css`
- Test: `apps/admin/src/pilot/StaffAccountPanel.test.tsx`
- Test: `apps/admin/src/pilot/OrderConversation.test.tsx`
- Test: `apps/admin/src/pilot/AdminPilotWorkspace.test.tsx`
- Test: `apps/admin/src/pilot/OwnerPilotWorkspace.test.tsx`

**Interfaces:**
- Consumes Task 7 staff/message API methods.
- Produces ADMIN staff management and OWNER/ADMIN order conversation panels; PROVIDER gets neither.

- [ ] **Step 1: Write failing staff account tests**

Cover list, create PROVIDER only, required explicit confirmation for disable/reset, temporary password shown once, no password value after dismissal, duplicate-submit lock, and protected-error propagation.

- [ ] **Step 2: Implement `StaffAccountPanel` and verify**

Run: `pnpm --filter @pet/admin test -- StaffAccountPanel.test.tsx AdminPilotWorkspace.test.tsx`

Expected: PASS; no ADMIN-create option exists in the browser.

- [ ] **Step 3: Write failing conversation tests**

Cover initial list, manual refresh, send/retry preserving the draft, cursor “加载更早消息”, OWNER/ADMIN author labels, 500-character cap, no polling/WebSocket, and no rendering in provider tests.

- [ ] **Step 4: Implement `OrderConversation` and integrate by selected order**

Keep order cards compact: an explicit “订单沟通” button expands one conversation at a time. Message success clears the draft only after the API resolves. Fetch generations must suppress stale responses after order switches/unmounts.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @pet/admin test -- StaffAccountPanel.test.tsx OrderConversation.test.tsx AdminPilotWorkspace.test.tsx OwnerPilotWorkspace.test.tsx ProviderPilotWorkspace.test.tsx`

Expected: PASS.

```bash
git add apps/admin/src/pilot apps/admin/src/styles.css
git commit -m "feat: add staff and order communication panels"
```

---

### Task 10: Real database/browser acceptance and production operations

**Files:**
- Create: `apps/admin/e2e/production-web-access.spec.ts`
- Modify: `scripts/run-pilot-live-acceptance.mjs`
- Modify: `scripts/production-deployment-files.test.mjs`
- Modify: `docs/operations/pilot-quickstart.md`
- Modify: `deploy/README.md`
- Modify: `deploy/.env.production.example`
- Modify: `README.md`

**Interfaces:**
- Consumes all prior tasks.
- Produces a repeatable multi-browser acceptance gate and truthful production runbook.

- [ ] **Step 1: Add a failing end-to-end scenario**

The scenario must use separate owner, recovered-owner, admin, provider, and attacker contexts against the real Fastify app and temporary PostgreSQL. It must: guest-create, complete profile data/order, issue/download recovery, recover in another context, staff-login/change password, create/provider-review, message both directions, confirm manual fee, dispatch, fulfill with real upload adapter, confirm completion, and prove cross-owner/provider message/address denial.

```ts
await ownerPage.getByRole('button', { name: '立即预约' }).click();
await expect(ownerPage.getByRole('heading', { name: '创建预约' })).toBeVisible();
await recoveredPage.goto(`${baseUrl}/#/orders/access/${recoveryToken}`);
await expect(recoveredPage.getByRole('heading', { name: '我的订单' })).toBeVisible();
const denied = await attackerContext.request.get(`${baseUrl}/api/v1/pilot/orders/${orderId}/messages`);
expect(denied.status()).toBe(403);
```

- [ ] **Step 2: Run and observe the first missing-flow failure**

Run: `pnpm test:e2e:live`

Expected: FAIL at the new production entry flow before runner/fixtures are updated.

- [ ] **Step 3: Update the runner without leaking credentials**

Create ADMIN/PROVIDER credentials inside the test process through direct service setup or inherited anonymous pipes. Never pass passwords in argv, environment, files, Playwright traces, screenshots, or console. Keep generated values in process memory and redact them from error output.

- [ ] **Step 4: Add deployment and documentation assertions**

Assert production docs require: run migrations, execute interactive ADMIN bootstrap before readiness, verify `/health/ready`, use HTTPS/Secure cookies, preserve one-instance in-memory limiter boundary, back up DB, configure private S3, and never expose GitHub Pages as the real-order origin. Remove statements that production falls back to local role entry or invitations.

- [ ] **Step 5: Run focused acceptance**

Run: `pnpm test:e2e:live && pnpm test:deploy && pnpm test:live-cleanup`

Expected: production web loop PASS, 7+ deployment assertions PASS, and cleanup tests report no leaked child process/database/evidence directory.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/e2e scripts docs/operations deploy README.md
git commit -m "test: verify production web service loop"
```

---

### Task 11: Full verification, browser QA, independent review, and delivery

**Files:**
- Modify only files required by verified review findings.
- Create durable summary: `01-Projects/pet-home-service-platform/2026-09-02-production-web-access.md` in the shared Vault.

**Interfaces:**
- Consumes the completed feature branch.
- Produces a reviewed, merge-ready branch and evidence-backed deployment handoff.

- [ ] **Step 1: Run the full Node 22 verification suite**

```powershell
$env:PATH='C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64;' + $env:PATH
pnpm lint
pnpm typecheck
pnpm test
pnpm pilot:build
pnpm --filter @pet/admin build
pnpm test:e2e:live
pnpm test:deploy
pnpm test:live-cleanup
git diff --check
```

Expected: every command exits 0; no suite is skipped except explicitly credential-gated real WeChat/S3 provider tests.

- [ ] **Step 2: Perform browser QA**

At 390×844, 900×1100, and 1440×1000 verify: no overflow; one main landmark per page; 44px visible controls; owner entry has no account/role form; fragment disappears before recovery request; recovery token is absent from DOM after dismissal, URL, Web Storage, console, and network query strings; staff login is footer-only; full owner/admin/provider flow works.

- [ ] **Step 3: Request independent code review**

Review schema/migration safety, token/password leakage, authorization/IDOR, rate limits, cookie/origin behavior, encryption, stale UI requests, and production readiness. Fix Critical/Important findings with the `superpowers:receiving-code-review` and `superpowers:test-driven-development` workflows, then rerun Step 1.

- [ ] **Step 4: Commit any review fixes and write the Vault summary**

The summary records scope, commits, exact verification counts, remaining external requirements, and no secrets. Use `apply_patch`; do not store credentials or `.env` values.

- [ ] **Step 5: Finish the branch**

Use `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`. After the user-approved integration choice, merge/push and verify the selected deployment. Do not call the GitHub Pages demo a real-order deployment; real production remains blocked until the user supplies an HTTPS domain, host, PostgreSQL, S3, and secret management.
