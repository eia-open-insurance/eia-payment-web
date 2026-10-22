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

## Payment execution lifecycle

The selected payment shows an **Execution lifecycle** panel with the ordered
happy path and its single next action:

| Current status | Action | Target status |
| --- | --- | --- |
| `DRAFT` | Submit for authority | `PENDING_AUTHORITY` |
| `PENDING_AUTHORITY` | Authorize | `AUTHORIZED` |
| `AUTHORIZED` | Approve | `APPROVED` |
| `APPROVED` | Schedule | `SCHEDULED` |
| `SCHEDULED` | Send | `SUBMITTED` |
| `SUBMITTED` | Accept | `ACCEPTED` |
| `ACCEPTED` | Process | `PROCESSING` |
| `PROCESSING` | Mark paid | `PAID` |
| `PAID` | Reconcile | `RECONCILED` |

Each action sends one `PATCH /api/v1/payments/{id}/status` with
`{ status, expectedVersion: payment.version }` and an optional `reason`. Mark
paid and Reconcile open a confirmation dialog first, where the operator may
enter the reason; routine transitions send the minimal payload. A successful
write updates both the selected record and its queue row from the response. A
409 conflict is contained in the lifecycle panel: the workbench reloads the
authoritative payment (and therefore the current version), shows the problem,
and offers a manual reload.

The timeline marks every step as done, current, or pending, and states that the
payment owns execution: claim and policy links are evidence of what is being
paid, not controllers of the status. `RECONCILED` completes the path; terminal
exception states such as `FAILED`, `RETURNED`, `CANCELLED`, `STOPPED`, and
`VOID` are off-path, show their terminal outcome and an off-path note, and
expose no forward action.

## Terminal actions

The action bar also exposes the secondary, terminal actions the Payment API
supports for the current status:

| Current status | Action | Target status | Reason |
| --- | --- | --- | --- |
| `DRAFT`, `PENDING_AUTHORITY`, `AUTHORIZED` | Cancel payment | `CANCELLED` | Optional |
| `DRAFT`, `PENDING_AUTHORITY`, `AUTHORIZED` | Void payment | `VOID` | Required |
| `APPROVED` | Void payment | `VOID` | Required |
| `APPROVED` | Stop payment | `STOPPED` | Required |
| `SCHEDULED` | Cancel payment | `CANCELLED` | Optional |
| `SCHEDULED` | Void payment | `VOID` | Required |
| `RETURNED`, `FAILED` | Cancel payment | `CANCELLED` | Optional |
| Other statuses | none | — | — |

Every terminal action opens a confirmation dialog naming the status change and
the expected version. Void and stop refuse to submit a blank reason; cancel
accepts an optional reason. A confirmed action sends one
`PATCH /api/v1/payments/{id}/status` with
`{ status, expectedVersion: payment.version, reason? }`, updates the selected
record and its queue row from the response, and moves the timeline to the new
terminal status with an off-path note. A rejected transition stays in the
dialog with the API problem; a 409 is contained in the lifecycle panel and
reloads the authoritative record so the retry uses the current version.

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
