# eia-payment-web

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-payment-web
- Type: Federated front-end
- Deployable: Yes
- Owner: Payment
- Runtime: React 19 and Webpack 5
- Data store: None
- Depends on: eia-frontend/packages, eia-contracts, eia-platform/gateway

## Purpose

Payment federated remote: screens, widgets, record tabs, and transaction composition. Payment authority, issuance, SAP S/4HANA posting, reconciliation, tax, and escheatment.

## Source-record hand-off

Other verticals open the payment create dialog with:

`/payment?new=1&sourceType=DIRECT_CLAIM&sourceId=<uuid>&sourceReference=CLM-…&amount=…&currency=USD&payeePartyId=<uuid>`

`sourceType` is one of `DIRECT_CLAIM`, `ASSUMED_CLAIM`, `POLICY`, or `OTHER`.
A classified source links back to `/direct-claims`, `/assumed-claims`, or
`/policy` and submits `sourceType`/`sourceId`/`sourceReference`; `OTHER` may
carry only its human reference. Source fields are optional on a normal create
and are sent only when supplied.

## Payment allocations

The **Allocations** tab splits one payment across the claim and policy
components it settles. It calls
`GET /api/v1/payments/{paymentId}/allocations` with the tenant header and
accepts either a bare array or an `{ items, allocatedAmount, unallocatedAmount,
count }` envelope. The summary shows the payment amount, allocated amount,
unallocated balance, and allocation count; the unallocated balance is the
payment amount minus the allocations and is never changed by recording one.

Each row shows the target type, a target reference linked to the owning
vertical (`/direct-claims?record=`, `/assumed-claims?record=`, or
`/policy?record=`), the component, the amount, and the created timestamp. The
reference uses the API's `targetReference` when present, otherwise the label
chosen in the picker, otherwise the owning vertical's predictive search for the
target id, and finally the short UUID.

**Add allocation** opens a dialog with a target-type select, an EntityPicker
scoped to that vertical (`/api/v1/claims/search` with `X-EIA-Book: DIRECT`,
`/api/v1/assumed-claims/search` with `ASSUMED`, or `/api/v1/policies/search`
with `DIRECT`), a component select, and an amount that defaults to the current
unallocated balance. The amount must be greater than 0 and no more than the
unallocated balance; the dialog rejects a larger value before any request. A
successful `POST /api/v1/payments/{paymentId}/allocations` body carries
`targetType`, `targetId`, `component`, and `amount`; the created row is merged
into the ledger immediately and the list is refetched to reconcile the totals.

A 409 conflict keeps the dialog open with the entered values and offers
**Reload allocations**. Loading, empty, and error states stay inside the tab, so
a slow or failing allocation API never blocks the payment record. Allocating
never changes the payment amount, approval path, or status.

## Linked documents

The Overview tab shows a **Documents** card for the selected payment. It calls
`GET /api/v1/documents?linkedType=PAYMENT&linkedId={paymentId}` with the tenant
header and renders the document count plus each document's number (linked to
`/document?record={id}`), title, type, and status. Documents are evidence: they
record what was filed against the payment but never change its amount, approval
path, or status. An empty state and an evidence note are always shown, and a slow
or failing Document API renders inside the card without blocking the payment
record.

## Activity timeline

The **Activity** tab shows the append-only event stream for the selected
payment. It calls
`GET /api/v1/events/aggregate/{paymentId}?limit=50` with the tenant header and
renders the `{ items }` page newest first by `occurredAt` (aggregate version
breaks ties), so the service's response order does not affect the timeline.

Each row shows the occurred-at timestamp in UTC, a readable event type with the
raw name (for example **Payment created** / `payment.payment.created`), the
event delivery status (`PROCESSED`, `RECEIVED`, `FAILED`, …), and the payload
facts the event carries: amount, currency, source type/reference, and status.
Not every event type carries every fact, so absent facts are omitted rather
than rendered blank. The card states that activity is event-derived and
append-only and that the payment record is the source of truth for current
state.

Selecting another payment refetches activity; the card's **Refresh activity**
control, the page **Refresh** control, and a completed lifecycle write all
refetch it as well. Loading, empty, and error states stay inside the card, so a
slow or failing event stream never blocks or replaces the payment record.

## Responsibilities

- Keep this repository focused on one deployable component or one platform concern.
- Follow the repository standard in `../CONVENTIONS.md` and the specification in `../../SPEC.md`.
- Publish and consume contracts through `eia-contracts`.
- Maintain README, CODEOWNERS, SECURITY, CHANGELOG, tests, and local verification.
- Contain no business logic in shared libraries or front-end remotes.

## Verification

- Lint and format
- Unit tests with 100% business-logic coverage where applicable
- Contract tests
- Integration or Playwright tests where applicable
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
