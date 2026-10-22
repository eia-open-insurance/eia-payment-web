/**
 * Payment execution lifecycle.
 *
 * The payment record owns execution: the Payment API is the only writer of the
 * status, and every transition below is one PATCH on
 * `/api/v1/payments/{id}/status` with the current version. Claim and policy
 * links are evidence of what the payment settles; they never advance or
 * control this lifecycle.
 *
 * The happy path is forward only:
 *   DRAFT -> PENDING_AUTHORITY -> AUTHORIZED -> APPROVED -> SCHEDULED ->
 *   SUBMITTED -> ACCEPTED -> PROCESSING -> PAID -> RECONCILED
 *
 * FAILED, RETURNED, CANCELLED, VOID, and the other exception states are
 * terminal-ish: they are not on the happy path and the workbench exposes no
 * automatic next action for them.
 */

/** Ordered happy-path steps, including the human label and transition text. */
export const EXECUTION_LIFECYCLE = [
  { status: 'DRAFT', label: 'Draft', transition: 'Payment created' },
  { status: 'PENDING_AUTHORITY', label: 'Pending authority', transition: 'Submitted for authority' },
  { status: 'AUTHORIZED', label: 'Authorized', transition: 'Authorized by approver' },
  { status: 'APPROVED', label: 'Approved', transition: 'Approved for execution' },
  { status: 'SCHEDULED', label: 'Scheduled', transition: 'Scheduled for payment run' },
  { status: 'SUBMITTED', label: 'Submitted', transition: 'Sent to SAP/bank' },
  { status: 'ACCEPTED', label: 'Accepted', transition: 'Accepted by SAP/bank' },
  { status: 'PROCESSING', label: 'Processing', transition: 'Processing at bank' },
  { status: 'PAID', label: 'Paid', transition: 'Funds settled' },
  { status: 'RECONCILED', label: 'Reconciled', transition: 'Matched to bank statement' }
];

export const RECONCILED_STATUS = 'RECONCILED';
export const PAID_STATUS = 'PAID';

/**
 * The single next happy-path action per current status. `confirm` actions open
 * a confirmation dialog before the PATCH is sent; Mark paid and Reconcile are
 * the two money-committing steps.
 */
export const HAPPY_PATH_ACTIONS = {
  DRAFT: {
    from: 'DRAFT',
    to: 'PENDING_AUTHORITY',
    label: 'Submit for authority',
    confirm: false
  },
  PENDING_AUTHORITY: {
    from: 'PENDING_AUTHORITY',
    to: 'AUTHORIZED',
    label: 'Authorize',
    confirm: false
  },
  AUTHORIZED: {
    from: 'AUTHORIZED',
    to: 'APPROVED',
    label: 'Approve',
    confirm: false
  },
  APPROVED: {
    from: 'APPROVED',
    to: 'SCHEDULED',
    label: 'Schedule',
    confirm: false
  },
  SCHEDULED: {
    from: 'SCHEDULED',
    to: 'SUBMITTED',
    label: 'Send',
    confirm: false
  },
  SUBMITTED: {
    from: 'SUBMITTED',
    to: 'ACCEPTED',
    label: 'Accept',
    confirm: false
  },
  ACCEPTED: {
    from: 'ACCEPTED',
    to: 'PROCESSING',
    label: 'Process',
    confirm: false
  },
  PROCESSING: {
    from: 'PROCESSING',
    to: 'PAID',
    label: 'Mark paid',
    confirm: true
  },
  PAID: {
    from: 'PAID',
    to: 'RECONCILED',
    label: 'Reconcile',
    confirm: true
  }
};

/** Exception states that end the forward happy path. */
export const TERMINAL_STATUSES = [
  'FAILED',
  'RETURNED',
  'CANCELLED',
  'VOID',
  'REJECTED',
  'STOPPED',
  'REVERSED',
  'ESCHEATED'
];

/** PATCH /api/v1/payments/{id}/status */
export function statusChangeEndpoint(paymentId) {
  return `/api/v1/payments/${encodeURIComponent(paymentId)}/status`;
}

/** Returns the single next action for a status, or null on/after RECONCILED. */
export function nextLifecycleAction(status) {
  if (!status) return null;
  return HAPPY_PATH_ACTIONS[status] || null;
}

/** 0-based index on the happy path, or -1 for an off-path/terminal status. */
export function lifecycleIndex(status) {
  return EXECUTION_LIFECYCLE.findIndex((step) => step.status === status);
}

/** The step metadata for a status, or null when the status is off the path. */
export function lifecycleStep(status) {
  const index = lifecycleIndex(status);
  return index < 0 ? null : EXECUTION_LIFECYCLE[index];
}

/** passed | current | upcoming | off-path */
export function lifecycleStepState(status, stepStatus) {
  const current = lifecycleIndex(status);
  if (current < 0) return 'off-path';
  const index = lifecycleIndex(stepStatus);
  if (index < 0) return 'upcoming';
  if (index < current) return 'passed';
  if (index === current) return 'current';
  return 'upcoming';
}

export function isLifecycleComplete(status) {
  return status === RECONCILED_STATUS;
}

export function isOffPathStatus(status) {
  return Boolean(status) && lifecycleIndex(status) < 0;
}

/**
 * The PATCH body. `status` and the payment's current `expectedVersion` are
 * always sent; `reason` is optional and omitted when blank so the API receives
 * the minimal payload for routine transitions.
 */
export function statusChangePayload(payment, action, reason = '') {
  const payload = {
    status: action.to,
    expectedVersion: payment.version
  };
  const trimmed = String(reason || '').trim();
  if (trimmed) payload.reason = trimmed;
  return payload;
}

/**
 * Confirmation copy for the two money-committing transitions. Keeping it in
 * one place makes the dialog wording and tests agree.
 */
export function confirmationCopy(action) {
  if (!action) return { title: '', description: '' };
  if (action.to === PAID_STATUS) {
    return {
      title: 'Mark payment as paid?',
      description:
        'Confirming records that the bank settled this payment. It writes PAID with the'
        + ' payment version below; the payment still has to be reconciled afterwards.'
    };
  }
  if (action.to === RECONCILED_STATUS) {
    return {
      title: 'Reconcile payment?',
      description:
        'Confirming matches this paid payment to the bank statement. It writes RECONCILED'
        + ' with the payment version below and completes the execution lifecycle.'
    };
  }
  return {
    title: `${action.label}?`,
    description: `Confirming writes ${action.to} with the payment version below.`
  };
}

/** Human execution context for the Overview readiness card. */
export function executionLabel(status) {
  if (status === RECONCILED_STATUS) return 'Complete: paid and reconciled';
  if (status === PAID_STATUS) return 'Settled; awaiting reconciliation';
  if (['SUBMITTED', 'ACCEPTED', 'PROCESSING'].includes(status)) {
    return 'Issued to SAP/bank; awaiting settlement';
  }
  if (['APPROVED', 'SCHEDULED'].includes(status)) return 'Approved for execution';
  if (['DRAFT', 'PENDING_AUTHORITY', 'AUTHORIZED'].includes(status)) {
    return 'Blocked: approval required';
  }
  return `No execution action for ${status || 'unknown status'}`;
}
