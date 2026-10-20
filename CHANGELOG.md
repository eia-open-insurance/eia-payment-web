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
