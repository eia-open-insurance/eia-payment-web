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
