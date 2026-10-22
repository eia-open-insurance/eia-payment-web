# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Payment allocation reversal. Active allocations in the **Allocations** tab
  offer **Reverse**, which opens a dialog requiring a non-blank reason of at
  most 500 characters and posts
  `POST /api/v1/payments/{paymentId}/allocations/{allocationId}/reverse` with
  `{ reason }`. A successful reversal stamps `reversedAt` and `reversalReason`
  on the split, which stays in the ledger with its original target, component,
  and amount; the row shows a **REVERSED** badge, reason, and date, and no
  longer offers the action. Reversal is append-only and never deletes the
  allocation or changes the payment amount, approval path, or status. The
  summary now reports **net allocated** (recorded minus reversed), the
  **reversed** total, and the **remaining** balance, with the allocation and
  reversed counts under net allocated; the totals accept the API's
  `totalAllocated`, `totalReversed`, `netAllocated`, and `unallocated` members
  and otherwise fall back to the visible rows. A 409 on reversal (for example
  an already-reversed split) keeps the dialog open with the API problem and
  reload guidance, and every mutation refreshes the activity timeline.
- Playwright coverage for the reversal endpoint, tenant header, and trimmed
  payload; the required reason and local rejection before POST; the reversed
  badge, reason, date, and preserved original split; the active/reversed action
  gating; the net, reversed, and remaining summary values; the unchanged
  payment amount; and a repeated-reversal 409 that stays in the dialog without
  mutating the ledger.
- Payment status reason. The nullable `statusReason` returned by the Payment
  API (`PAY-2026` status writes store the optional PATCH `reason` there, capped
  at 200 characters) is normalized by trimming, collapsing whitespace, and
  ignoring blank or non-text values. **Payment Details** shows a **Status
  reason** row only when a reason is present, together with the latest
  transition context (`from → to`, UTC timestamp, and row version) from the
  latest matching `payment.payment.status-changed` activity event; the
  lifecycle panel shows the same reason and context beside the current status.
  When the activity feed is slow, unavailable, or does not yet contain the
  transition, the context falls back to the payment's current status, version,
  and `updatedAt`. An older projection that omits `statusReason` entirely falls
  back to the reason in the latest transition event. Playwright coverage covers
  normalization (whitespace and the 200-character cap), the present and absent
  states in both views, the transition-derived context, the payment-record
  fallback, and the legacy projection fallback.
- Post-payment controls on the lifecycle action bar. `PAID` and
  `PARTIALLY_PAID` offer **Return payment** (`RETURNED`) and **Reverse payment**
  (`REVERSED`); `RECONCILED` offers **Escheat payment** (`ESCHEATED`); and
  `RETURNED` offers **Reschedule** (`SCHEDULED`) plus **Cancel payment**
  (`CANCELLED`). Return, Reverse, and Escheat require a reason; every secondary
  action is confirmed and sends one `PATCH /api/v1/payments/{id}/status` with
  `{ status, expectedVersion, reason? }`. The response updates the selected
  record and its queue row. `PARTIALLY_PAID` and `RETURNED` show an explanatory
  off-path note, `RETURNED` is recoverable rather than terminal, `REVERSED` and
  `ESCHEATED` show their terminal outcome, and `PAID` and `RECONCILED` explain
  the post-payment controls that remain. API errors stay in the dialog; a 409
  reloads the authoritative record and retries with the current version.
- Playwright coverage for the post-payment action mapping, versioned PATCH
  payloads, the required reasons for Return/Reverse/Escheat, confirmation
  dismissal, reschedule's optional reason, the off-path and terminal
  explanations, and a 409 on Return with an authoritative reload and retry.
- Secondary terminal actions on the payment lifecycle panel. `DRAFT`,
  `PENDING_AUTHORITY`, `AUTHORIZED`, and `SCHEDULED` offer **Cancel payment**
  (`CANCELLED`, optional reason) and **Void payment** (`VOID`, required
  reason); `APPROVED` offers **Void payment** and **Stop payment** (`STOPPED`,
  required reason); `RETURNED` and `FAILED` offer **Cancel payment**. Every
  action opens a confirmation dialog showing the transition and expected
  version, refuses a blank reason for void/stop, and sends one
  `PATCH /api/v1/payments/{id}/status` with
  `{ status, expectedVersion, reason? }`. The response updates the selected
  record and its queue row, and the timeline shows the terminal status with an
  off-path note. API errors stay in the dialog; a 409 reloads the authoritative
  record in the lifecycle panel.
- Playwright coverage for the status-to-terminal-action mapping, the absence of
  terminal actions on later statuses, the PATCH payloads and version, cancel's
  optional reason and void/stop's required reason, confirmation dismissal, the
  terminal status and off-path timeline note, queue updates, and a rejected
  terminal transition retried from the dialog.
- Payment execution lifecycle action bar and timeline: the selected payment
  shows the full `DRAFT` → `PENDING_AUTHORITY` → `AUTHORIZED` → `APPROVED` →
  `SCHEDULED` → `SUBMITTED` → `ACCEPTED` → `PROCESSING` → `PAID` →
  `RECONCILED` path, marks passed/current/pending steps, and exposes only the
  single next happy-path action. Each action sends
  `PATCH /api/v1/payments/{id}/status` with `{ status, expectedVersion, reason? }`.
  Mark paid and Reconcile require confirmation and accept an optional reason.
  A successful write updates the selected record and its queue row; a 409
  conflict is contained in the panel with an authoritative record reload and a
  manual reload control. Terminal exception states expose no automatic action.
  The Overview context now states that the payment owns execution while claim
  and policy links are evidence only.
- Playwright coverage for the status-to-action mapping, one versioned PATCH per
  step, optional confirmation reasons, the Mark paid and Reconcile dialogs, the
  409 reload/contain path, the timeline states, and off-path terminal statuses.
- Repository baseline.
- Record discovery for the payment workbench: `?record=` selects a payment and
  re-opens it on popstate, `?new=1` opens the create dialog, and a queue filter
  covers number, type, payee, and status.
- Predictive payee party lookup through `/api/v1/parties/search`, with a party
  label and a cross-link to `/party?record=`.
- Disbursement context panel explaining that the Payment API slice carries no
  source claim or policy reference and that approval gates execution.
- Payee cross-link resolution through `GET /api/v1/parties/{id}`: the header,
  summary payee card, Overview, and context panel show `name · party number`
  link text with a short-UUID fallback, and a 404 never blocks the record.
- Source-record hand-off: `?new=1&sourceType=&sourceId=&sourceReference=` plus
  `amount`, `currency`, and `payeePartyId` prefills the create dialog, resolves
  a prefilled payee label through the Party API, and submits the optional
  `sourceType`/`sourceId`/`sourceReference` fields. A prefilled source shows a
  clearable card with a cross-link to `/direct-claims`, `/assumed-claims`, or
  `/policy`; payments created without a hand-off may still set the source
  manually, with type/id pair validation before POST.
- Payment Overview and context panel now show the source record and explain
  that the payment is the disbursement leg while the source record controls
  what is being paid; the queue, record subtitle, and filter include the source
  reference and source id.
- Linked-document visibility: selecting a payment fetches
  `GET /api/v1/documents?linkedType=PAYMENT&linkedId={id}` with the tenant
  header, and an Overview **Documents** card shows the document count plus each
  document's number, title, type, and status, with the number linking to
  `/document?record={id}`. An empty state and an evidence note are always shown;
  a Document API failure stays inside the card and never blocks the payment
  record.
- Playwright coverage for the linked-document query and tenant header, document
  links, the empty state, a contained document error, and rendering the payment
  while the Document API is still in flight.
- Payment **Activity** tab: selecting a payment fetches
  `GET /api/v1/events/aggregate/{paymentId}?limit=50` with the tenant header and
  renders a newest-first event timeline with each event's timestamp, readable
  type plus raw event name, delivery status, and payload facts (amount,
  currency, source type/reference, and status). The card states that activity is
  event-derived and append-only and that the payment record is the source of
  truth. Activity refetches on record selection, lifecycle writes, and the
  card's Refresh activity control; loading, empty, and error states stay inside
  the card, and a 503 never blocks the payment record.
- Playwright coverage for the aggregate path/limit/tenant header, newest-first
  ordering, payload summaries, the empty state, a contained 503, explicit
  refresh, and refetch when another payment is selected.
- Payment **Allocations** tab: selecting it fetches
  `GET /api/v1/payments/{paymentId}/allocations` with the tenant header and
  shows the payment amount, allocated amount, unallocated balance, and
  allocation count above a ledger of target type, linked target reference,
  component, amount, and created timestamp. Target links route DIRECT_CLAIM to
  `/direct-claims?record=`, ASSUMED_CLAIM to `/assumed-claims?record=`, and
  POLICY to `/policy?record=`. A reference comes from the API when supplied,
  otherwise from the picker label or the owning vertical's predictive search,
  and finally from the short UUID.
- Add-allocation dialog: target-type select, EntityPicker over
  `/api/v1/claims/search` (DIRECT book), `/api/v1/assumed-claims/search`
  (ASSUMED book), and `/api/v1/policies/search` (DIRECT book), a component
  select, and an amount defaulted to the unallocated balance. The amount must be
  greater than 0 and no more than the unallocated balance. The POST body carries
  `targetType`, `targetId`, `component`, and `amount`; the returned row is merged
  into the ledger and the list is refetched. A 409 keeps the dialog open with the
  entered values and offers **Reload allocations**.
- Loading, empty, and error states stay inside the Allocations tab, so a slow or
  failing allocation API never blocks the payment record; allocating never
  changes the payment amount.
- Playwright coverage for the allocation query and tenant header, summary and
  target links, predictive label resolution with a short-id fallback, all three
  picker endpoints and book headers, the POST payload, over-allocation and
  non-positive amount validation, the empty state, a contained load error with
  retry, the 409 conflict reload, and the loading state.
- Shared `api.js`/`format.js` helpers now carry the tenant-aware JSON transport
  and money/short-id formatting used by the workbench and its tabs.

### Changed

- The record action moved from the header into the lifecycle panel. Lifecycle
  writes no longer use the old POST `/submit`, `/authorize`, `/approve`, and
  `/issue` endpoints; every step is one versioned PATCH on
  `/api/v1/payments/{id}/status`.
