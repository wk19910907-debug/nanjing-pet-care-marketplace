# Provider Application and Review Design

## Goal

Add a browser-local supply-side loop to the public demo: a prospective service provider submits a safe application, the platform reviews it, and an approved applicant becomes eligible for matching only for the declared district and services.

## Scope

- Add an application panel to the service-provider workspace.
- Collect only an experience nickname, one existing Nanjing experience district, one or both core service types, and a short experience description.
- Show the submitted application and its current review state.
- Add a pending-application queue to the platform workspace.
- Let the platform approve a pending application.
- Convert an approved application into a verified demo provider exactly once.
- Restrict each order's matching candidates to verified providers who support the order's service type and district.
- Persist applications and approved providers in the existing browser-local demo state.
- Load legacy version-1 browser state that does not yet contain applications without losing existing orders.

## Non-goals

- No real recruitment, remote submission, login, phone number, ID number, ID photo, certificate, background check, bank details, contract, payment, rejection workflow, provider task identity switching, or production database change.
- No claim that an applicant has completed a real identity or background verification.
- No change to the real API provider-review implementation or public pricing.

## Approaches Considered

### Static recruitment explanation

This would communicate intent but add no usable product behavior.

### Application form without matching integration

This would demonstrate demand collection but leave the platform review claim disconnected from order matching.

### Application, approval, and eligibility integration

Recommended. The workflow is still small enough for a browser-local demo, but it proves the important platform rule: unreviewed people cannot receive orders, and approved people are only candidates for the district and services they declared.

## Domain Model

`ProviderApplication` contains:

- `id`: deterministic local identifier.
- `name`: trimmed experience nickname.
- `district`: one of the four existing experience districts.
- `services`: a non-empty array of `CAT_FEEDING` and/or `DOG_WALKING` without duplicates.
- `experience`: trimmed safe-demo description.
- `status`: `PENDING` or `APPROVED`.
- `createdAt` and optional `reviewedAt` ISO timestamps.
- optional `providerId` populated after approval.

`DemoState` keeps version `1` and adds `providerApplications`. Keeping the version avoids discarding existing public-demo orders. `loadDemoState` treats a missing or invalid application array as empty while continuing to restore the seeded providers.

## Workflow Rules

### Submit application

- Name, district, experience, and at least one service are required.
- District must be one of the four public experience districts.
- Service values must be core service types and are normalized without duplicates.
- The same trimmed name and district cannot have another pending or approved application.
- A new application starts as `PENDING` and does not change `providers`.

### Approve application

- Only a known `PENDING` application can be approved.
- Approval changes status to `APPROVED`, records `reviewedAt`, creates one verified provider, and stores its provider ID on the application.
- Replaying approval is rejected and never creates a duplicate provider.

### Match order

- Candidate providers must be verified, support the order service type, and have the same district as the order.
- `assignOrder` enforces the same rules as the platform UI, so eligibility cannot be bypassed by calling the domain function directly.
- If no candidate exists, the platform displays a clear empty state and disables matching instead of selecting an unrelated provider.

## Components

### ProviderApplicationPanel

A focused controlled-form component inside `ProviderWorkspace`. It displays safe-demo guidance, the four fixed districts, two service checkboxes, the experience field, and recent application statuses.

### ProviderReviewQueue

A focused platform component inside `OperatorWorkspace`. It lists pending applications, declared district/services/experience, and an approval action. Approved applications remain visible with an approved status so the result is auditable in the demo.

### Matching candidates

`OperatorWorkspace` derives candidates per order through a shared pure selector from the workflow module. The dropdown renders only eligible providers and handles an empty result explicitly.

## Data Flow

1. The service-provider workspace submits `ProviderApplicationDraft`.
2. `DemoApp` applies `submitProviderApplication`, saves the next state, and shows a status notice.
3. The platform workspace renders the pending application.
4. Approval applies `approveProviderApplication`, persists the state, and exposes the new verified provider.
5. A matching order in the same district and service displays that provider as a candidate.
6. Matching continues through the unchanged service and confirmation flow.

## Error Handling and Accessibility

- Native labels, selects, checkboxes, textarea, and buttons are used.
- Validation errors flow through the existing status notice.
- Application status uses visible Chinese text: `待平台审核` or `审核通过 · 已进入匹配池`.
- Approval buttons have explicit accessible names containing the applicant name.
- No sensitive-data fields are present; guidance explicitly says not to enter real contact or identity information.
- Desktop uses a two-column form/review layout where space allows; mobile stacks content with no horizontal overflow and 44-pixel action targets.

## Testing

- Vitest covers submission validation, unreviewed exclusion, one-time approval, provider creation, district/service eligibility, assignment enforcement, and legacy-state loading.
- Playwright covers provider application, platform approval, and appearance in a matching order's candidate list.
- Playwright also verifies a different district does not expose the approved provider and confirms the mobile page has no horizontal overflow.
- Existing quote, order, role, fulfillment, persistence, reset, typecheck, build, and full service-loop tests remain green.

## Acceptance Criteria

- A visitor can submit a safe demo provider application without personal contact or identity data.
- Pending applicants never appear in order matching.
- Approval creates exactly one verified provider and visibly updates application status.
- Approved providers appear only for matching service types and districts.
- Legacy saved browser state loads without losing orders.
- Existing owner-to-confirmation flow still works.
- Desktop and 390×844 layouts remain usable and free of horizontal overflow.
