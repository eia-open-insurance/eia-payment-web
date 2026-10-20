/**
 * Resolves a party reference into readable cross-link text.
 *
 * The Party API returns the canonical record: `displayName` plus the
 * human-readable `partyNumber`, for example "Acme Manufacturing · PTY-000000001".
 * This module only formats link text — callers keep the `/party?record=<id>`
 * href and fall back to the short UUID when resolution fails.
 */
export function partyEndpoint(partyId) {
  return `/api/v1/parties/${encodeURIComponent(partyId)}`;
}

export function partyRecordLabel(party) {
  if (!party) return '';
  const name = party.displayName || party.legalName || party.name || '';
  const number = party.partyNumber || '';
  if (name && number) return `${name} · ${number}`;
  return name || number || '';
}
