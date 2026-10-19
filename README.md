# eia-payment-web

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-payment-web
- Type: Federated front-end
- Deployable: Yes
- Owner: Payment
- Runtime: React 19 and Webpack 5
- Data store: None
- Depends on: eia-frontend-platform, eia-contracts, eia-gateway

## Purpose

Payment federated remote: screens, widgets, record tabs, and transaction composition. Payment authority, issuance, SAP S/4HANA posting, reconciliation, tax, and escheatment.

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
