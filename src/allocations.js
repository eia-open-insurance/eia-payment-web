/**
 * Payment allocation helpers.
 *
 * An allocation splits one payment across a claim or policy component. The
 * payment amount is the ceiling: the allocations may total less than the
 * payment (leaving an unallocated balance) but never more, and recording an
 * allocation never changes the payment itself.
 *
 * The API is intentionally normalized defensively: it may return a bare array
 * or an `{ items, allocatedAmount, unallocatedAmount, count }` envelope, and
 * rows may expose either the `target*` projection or the underlying
 * claim/policy id columns. The UI always computes the summary from the list it
 * can see, with the server totals preferred when the envelope supplies them.
 */
import { recordHref } from './navigation.js';
import { formatMoney } from './format.js';

export const ALLOCATION_TARGET_TYPES = ['DIRECT_CLAIM', 'ASSUMED_CLAIM', 'POLICY'];

export const ALLOCATION_COMPONENTS = [
  'INDEMNITY',
  'DEFENSE',
  'ALAE',
  'EXPENSE',
  'MEDICAL',
  'LIEN',
  'TRUST',
  'PREMIUM',
  'COMMISSION',
  'BROKERAGE',
  'CASH_CALL',
  'BALANCE',
  'REFUND',
  'FEE',
  'TAX'
];

/** Storage scale for money: the Payment API uses numeric(19,4). */
export const ALLOCATION_SCALE = 10000;

const TARGET_META = {
  DIRECT_CLAIM: {
    label: 'Direct claim',
    endpoint: '/api/v1/claims/search',
    book: 'DIRECT',
    placeholder: 'Search direct claim number…'
  },
  ASSUMED_CLAIM: {
    label: 'Assumed claim',
    endpoint: '/api/v1/assumed-claims/search',
    book: 'ASSUMED',
    placeholder: 'Search assumed claim number…'
  },
  POLICY: {
    label: 'Policy',
    endpoint: '/api/v1/policies/search',
    book: 'DIRECT',
    placeholder: 'Search policy number…'
  }
};

const TARGET_ROUTES = {
  DIRECT_CLAIM: 'direct-claims',
  ASSUMED_CLAIM: 'assumed-claims',
  POLICY: 'policy'
};

const TARGET_ALIASES = {
  DIRECT: 'DIRECT_CLAIM',
  CLAIM: 'DIRECT_CLAIM',
  DIRECT_CLAIM: 'DIRECT_CLAIM',
  DIRECTCLAIM: 'DIRECT_CLAIM',
  ASSUMED: 'ASSUMED_CLAIM',
  ASSUMED_CLAIM: 'ASSUMED_CLAIM',
  ASSUMEDCLAIM: 'ASSUMED_CLAIM',
  POLICY: 'POLICY',
  POL: 'POLICY'
};

/** Uppercases a known target type; blank and unknown values resolve to ''. */
export function normalizeTargetType(value) {
  const type = String(value || '').trim().toUpperCase();
  return TARGET_ALIASES[type] || '';
}

export function targetMeta(type) {
  return TARGET_META[normalizeTargetType(type)] || null;
}

export function targetTypeLabel(type) {
  const meta = targetMeta(type);
  if (meta) return meta.label;
  const raw = String(type || '').trim();
  return raw ? raw.replace(/_/g, ' ') : '';
}

export function componentLabel(component) {
  const raw = String(component || '').trim();
  return raw ? raw.replace(/_/g, ' ') : '';
}

/** GET/POST /api/v1/payments/{paymentId}/allocations */
export function allocationEndpoint(paymentId) {
  return `/api/v1/payments/${encodeURIComponent(paymentId)}/allocations`;
}

/** Accepts a bare array or an `{ items }` / `{ allocations }` envelope. */
export function allocationRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.allocations)) return payload.allocations;
  return [];
}

function optionalUnits(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * ALLOCATION_SCALE) : null;
}

/** Converts a decimal money string/number to integer 1/10000 units. */
export function toUnits(value) {
  return optionalUnits(value) ?? 0;
}

/** Converts integer 1/10000 units back to a four-decimal string. */
export function decimalAmount(units) {
  const value = Number(units);
  const safe = Number.isFinite(value) ? value : 0;
  return (safe / ALLOCATION_SCALE).toFixed(4);
}

export function allocationId(row) {
  if (!row || typeof row !== 'object') return '';
  return String(row.id || row.allocationId || '').trim();
}

export function allocationTargetType(row) {
  if (!row || typeof row !== 'object') return '';
  const explicit = normalizeTargetType(row.targetType || row.recordType);
  if (explicit) return explicit;
  if (row.assumedClaimId) return 'ASSUMED_CLAIM';
  if (row.claimId) return 'DIRECT_CLAIM';
  if (row.policyId) return 'POLICY';
  return '';
}

export function allocationTargetId(row) {
  if (!row || typeof row !== 'object') return '';
  const type = allocationTargetType(row);
  if (type === 'ASSUMED_CLAIM' && row.assumedClaimId) return String(row.assumedClaimId).trim();
  if (type === 'DIRECT_CLAIM' && row.claimId) return String(row.claimId).trim();
  if (type === 'POLICY' && row.policyId) return String(row.policyId).trim();
  return String(
    row.targetId || row.targetRecordId || row.recordId || row.claimId || row.assumedClaimId || row.policyId || ''
  ).trim();
}

export function allocationTargetReference(row) {
  if (!row || typeof row !== 'object') return '';
  return String(
    row.targetReference ||
    row.reference ||
    row.targetLabel ||
    row.claimNumber ||
    row.assumedClaimNumber ||
    row.policyNumber ||
    ''
  ).trim();
}

export function allocationComponent(row) {
  if (!row || typeof row !== 'object') return '';
  return String(row.component || row.reserveComponent || row.componentCode || '').trim();
}

export function allocationAmount(row) {
  if (!row || typeof row !== 'object') return '';
  return row.amount ?? row.allocatedAmount ?? row.value ?? '';
}

export function allocationCreatedAt(row) {
  if (!row || typeof row !== 'object') return '';
  return String(row.createdAt || row.created || row.allocationDate || '').trim();
}

/** Shell route owned by the target record, or '' when none can be linked. */
export function allocationTargetHref(row) {
  const type = allocationTargetType(row);
  const id = allocationTargetId(row);
  const route = TARGET_ROUTES[type];
  return route && id ? recordHref(route, id) : '';
}

/** Builds the POST body; the payment id and currency are implied by the URL. */
export function allocationPayload(form) {
  return {
    targetType: normalizeTargetType(form?.targetType),
    targetId: String(form?.targetId || '').trim(),
    component: String(form?.component || '').trim().toUpperCase(),
    amount: String(form?.amount ?? '').trim()
  };
}

/**
 * Summary of the allocation ledger against the payment amount. Server totals
 * win when present; otherwise the visible rows are summed exactly in 1/10000
 * units so decimal strings never drift in JavaScript floating point.
 */
export function summarizeAllocations(payload, payment) {
  const items = allocationRows(payload);
  const source = payload && !Array.isArray(payload) ? payload : {};
  const paymentUnits = toUnits(payment?.amount);

  const serverAllocated = optionalUnits(
    source.allocatedAmount ?? source.totalAmount ?? source.allocated
  );
  const allocatedUnits = serverAllocated === null
    ? items.reduce((total, row) => total + toUnits(allocationAmount(row)), 0)
    : serverAllocated;

  const serverUnallocated = optionalUnits(
    source.unallocatedAmount ?? source.remainingAmount ?? source.unallocated
  );
  const unallocatedUnits = serverUnallocated === null
    ? paymentUnits - allocatedUnits
    : serverUnallocated;

  const count = Number.isInteger(source.count) ? source.count : items.length;

  return {
    items,
    paymentUnits,
    allocatedUnits,
    unallocatedUnits,
    count,
    overAllocated: allocatedUnits > paymentUnits
  };
}

/**
 * Client-side mirror of the API rule: pick a target and component, then an
 * amount that is greater than zero and no more than the payment's unallocated
 * balance. The server remains authoritative, including the 409 conflict.
 */
export function validateAllocation(form, unallocatedUnits, currency) {
  const type = normalizeTargetType(form?.targetType);
  if (!type) return 'Select a target type.';
  const meta = targetMeta(type);
  if (!allocationTargetId(form)) {
    return `Select a ${meta.label.toLowerCase()} record for this allocation.`;
  }
  if (!String(form?.component || '').trim()) return 'Select a component.';
  const raw = String(form?.amount ?? '').trim();
  if (!raw) return 'Enter an allocation amount.';
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return 'Allocation amount must be a number.';
  const units = Math.round(amount * ALLOCATION_SCALE);
  if (units <= 0) return 'Allocation amount must be greater than 0.';
  if (units > unallocatedUnits) {
    const remaining = formatMoney(decimalAmount(Math.max(0, unallocatedUnits)), currency);
    return `Allocation amount cannot exceed the unallocated ${remaining}.`;
  }
  return '';
}
