# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

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
