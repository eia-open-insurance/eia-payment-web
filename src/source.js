/**
 * Payment source-record linkage.
 *
 * A payment is only the disbursement leg of the claim, policy, or other
 * obligation it settles; the source record controls what is being paid.
 * `sourceType` decides which remote owns that record, so a hand-off from
 * `?new=1&sourceType=…&sourceId=…` can be linked straight back.
 */
import { recordHref } from './navigation.js';

export const SOURCE_TYPES = ['DIRECT_CLAIM', 'ASSUMED_CLAIM', 'POLICY', 'OTHER'];

export const SOURCE_REFERENCE_MAX_LENGTH = 64;

const SOURCE_LABELS = {
  DIRECT_CLAIM: 'Direct claim',
  ASSUMED_CLAIM: 'Assumed claim',
  POLICY: 'Policy',
  OTHER: 'Other source'
};

const SOURCE_ROUTES = {
  DIRECT_CLAIM: 'direct-claims',
  ASSUMED_CLAIM: 'assumed-claims',
  POLICY: 'policy'
};

/** Uppercases a known source type; blank and unknown values resolve to ''. */
export function normalizeSourceType(value) {
  const type = String(value || '').trim().toUpperCase();
  return SOURCE_TYPES.includes(type) ? type : '';
}

export function sourceTypeLabel(type) {
  if (!type) return '';
  const normalized = normalizeSourceType(type);
  if (SOURCE_LABELS[normalized]) return SOURCE_LABELS[normalized];
  return String(type).replace(/_/g, ' ');
}

export function hasSource(source) {
  return Boolean(
    source && (source.sourceType || source.sourceId || source.sourceReference)
  );
}

/** Shell route owned by the source record, or '' when no record can be linked. */
export function sourceHref(source) {
  if (!source || !source.sourceId) return '';
  const route = SOURCE_ROUTES[normalizeSourceType(source.sourceType)];
  return route ? recordHref(route, source.sourceId) : '';
}

export function sourceLinkLabel(source) {
  switch (normalizeSourceType(source && source.sourceType)) {
    case 'DIRECT_CLAIM':
      return 'Open direct claim record';
    case 'ASSUMED_CLAIM':
      return 'Open assumed claim record';
    case 'POLICY':
      return 'Open policy record';
    default:
      return 'Open source record';
  }
}
