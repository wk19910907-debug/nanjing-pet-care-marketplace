# Public Quote and Order Prefill Design

## Goal

Turn the public landing page from a static price explanation into a short, usable conversion path: a visitor chooses a service and Nanjing district, sees a transparent experience quote, and moves into the owner order form with those choices already filled.

## Scope

- Add one public quote panel between the pricing cards and the safeguards section.
- Let visitors choose `上门喂猫` or `上门遛狗`.
- Let visitors choose one of the four existing experience districts: `建邺区`, `鼓楼区`, `玄武区`, or `秦淮区`.
- Display the matching experience price: cat feeding `¥32`, dog walking `¥37`.
- Explain that the amount is an experience reference price and creates no charge.
- Provide a single `按此方案体验下单` action.
- On action, switch to the owner workspace, scroll to the order form, and prefill service type and district.
- Preserve all existing manual form editing, order creation, role switching, workflow persistence, and reset behavior.

## Non-goals

- No real booking, payment, remote submission, contact form, phone number, WeChat QR code, analytics, geolocation, distance pricing, holiday pricing, or precise address collection on the landing section.
- No claim that any district is formally covered.
- No change to the existing demo order price rules or backend contracts.

## Approaches Considered

### Static price cards only

This is the current implementation. It is simple but leaves a gap between understanding the offer and starting an order.

### Independent quote calculator

This improves price clarity but makes users repeat the same choices in the order form.

### Quote selection linked to order prefill

Recommended. A small controlled quote panel owns only `serviceType` and `district`; the app passes the selected values into the owner workspace and focuses the existing order form. It creates the shortest path while keeping responsibilities clear.

## Architecture

`PublicQuote` is a focused presentation component. It receives the current quote selection and emits selection changes or a start action. It does not know about roles, scrolling, storage, or orders.

`DemoApp` owns the public quote selection because it coordinates the landing page and owner workspace. Starting from the quote sets the owner role and scrolls to `#order-experience`, reusing the existing public CTA behavior.

`OwnerWorkspace` receives an optional prefill object. A changing prefill request updates only `serviceType` and `district`; pet name, address, time, and notes remain under user control. A monotonically increasing request key ensures selecting the same quote again can intentionally reapply it.

## Data Flow

1. The visitor changes service or district in `PublicQuote`.
2. The displayed price is derived from the selected service (`3200` or `3700` fen).
3. The visitor selects `按此方案体验下单`.
4. `DemoApp` records `{ requestKey, serviceType, district }`, switches to `OWNER`, and scrolls to the order experience.
5. `OwnerWorkspace` observes the new request key and updates the two matching draft fields.
6. The visitor completes the remaining safe demo fields and submits through the unchanged workflow.

## Error Handling and Accessibility

- Both inputs use visible labels and native `select` controls.
- Price updates are exposed in a live status region.
- The action remains a native button with at least a 44-pixel touch target.
- All selectable values come from fixed typed lists, so invalid public selections cannot be emitted.
- The mobile layout stacks controls, quote summary, and action without horizontal overflow.

## Testing

- Component-level tests cover quote price derivation and supported districts without duplicating the order workflow.
- Playwright verifies that the quote renders, updates from `¥32` to `¥37`, and prefills both service and district in the owner form.
- Mobile Playwright verification confirms no horizontal overflow and a usable stacked quote panel.
- Existing unit, typecheck, build, and end-to-end suites remain green.

## Acceptance Criteria

- A public visitor can obtain a service/district experience quote without entering personal data.
- The displayed price always matches the existing demo order price.
- The quote action opens the owner experience with both choices prefilled.
- Existing direct `立即体验下单` behavior still works.
- No real-order or formal-coverage claim is introduced.
- Desktop and 390×844 mobile layouts remain usable.
