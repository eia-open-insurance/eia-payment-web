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
 * automatic next action for them. The only explicit controls there are the
 * secondary cancel/void/stop actions, and each of those is confirmed.
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

/** Human label for a terminal status, used by the panel and success notices. */
export const TERMINAL_STATUS_LABELS = {
  FAILED: 'Payment failed',
  RETURNED: 'Payment returned',
  CANCELLED: 'Payment cancelled',
  VOID: 'Payment voided',
  REJECTED: 'Payment rejected',
  STOPPED: 'Payment stopped',
  REVERSED: 'Payment reversed',
  ESCHEATED: 'Payment escheated'
};

/**
 * One secondary action descriptor. `kind` distinguishes it from the single
 * happy-path action so the dialog can require a reason and the UI can style it
 * as terminal without overloading `to`.
 */
function terminalAction(id, from, to) {
  const label = `${id.charAt(0).toUpperCase()}${id.slice(1)} payment`;
  return {
    kind: 'terminal',
    id,
    from,
    to,
    label,
    confirm: true,
    reasonRequired: to === 'VOID' || to === 'STOPPED',
    danger: to !== 'CANCELLED'
  };
}

/**
 * Secondary, terminal actions per current status. These move the payment off
 * the happy path, so every one is confirmed. A void or stop also records a
 * mandatory reason; a cancel reason is optional.
 *
 * The mapping mirrors the Payment API transition graph: cancel is available
 * before scheduling and from the recoverable exception states, while APPROVED
 * offers void and stop instead of cancel.
 */
export const SECONDARY_ACTIONS = {
  DRAFT: [
    terminalAction('cancel', 'DRAFT', 'CANCELLED'),
    terminalAction('void', 'DRAFT', 'VOID')
  ],
  PENDING_AUTHORITY: [
    terminalAction('cancel', 'PENDING_AUTHORITY', 'CANCELLED'),
    terminalAction('void', 'PENDING_AUTHORITY', 'VOID')
  ],
  AUTHORIZED: [
    terminalAction('cancel', 'AUTHORIZED', 'CANCELLED'),
    terminalAction('void', 'AUTHORIZED', 'VOID')
  ],
  APPROVED: [
    terminalAction('void', 'APPROVED', 'VOID'),
    terminalAction('stop', 'APPROVED', 'STOPPED')
  ],
  SCHEDULED: [
    terminalAction('cancel', 'SCHEDULED', 'CANCELLED'),
    terminalAction('void', 'SCHEDULED', 'VOID')
  ],
  RETURNED: [terminalAction('cancel', 'RETURNED', 'CANCELLED')],
  FAILED: [terminalAction('cancel', 'FAILED', 'CANCELLED')]
};

/** PATCH /api/v1/payments/{id}/status */
export function statusChangeEndpoint(paymentId) {
  return `/api/v1/payments/${encodeURIComponent(paymentId)}/status`;
}

/** Returns the single next action for a status, or null on/after RECONCILED. */
export function nextLifecycleAction(status) {
  if (!status) return null;
  return HAPPY_PATH_ACTIONS[status] || null;
}

/** Secondary terminal actions offered for a status; empty for other statuses. */
export function secondaryLifecycleActions(status) {
  return SECONDARY_ACTIONS[status] || [];
}

/** True when the action is one of the terminal cancel/void/stop actions. */
export function isTerminalAction(action) {
  return Boolean(action) && action.kind === 'terminal';
}

/** Void and stop require a reason; cancel does not. */
export function actionRequiresReason(action) {
  return Boolean(action && action.reasonRequired);
}

/**
 * Rejects a blank reason for void/stop. Returns '' when the action may proceed,
 * so the same guard serves the dialog and any direct caller.
 */
export function reasonValidationError(action, reason) {
  if (!actionRequiresReason(action)) return '';
  if (String(reason || '').trim()) return '';
  return action.to === 'STOPPED'
    ? 'A reason is required to stop a payment.'
    : 'A reason is required to void a payment.';
}

/** Dialog copy for the optional/required reason field. */
export function reasonFieldCopy(action) {
  if (!action) {
    return { label: 'Reason (optional)', placeholder: '', hint: '' };
  }
  if (actionRequiresReason(action)) {
    return {
      label: 'Reason (required)',
      placeholder: action.to === 'STOPPED'
        ? 'Explain why this payment is being stopped'
        : 'Explain why this payment is being voided',
      hint: 'Required for audit; up to 200 characters, recorded with the status change.'
    };
  }
  if (action.to === PAID_STATUS) {
    return {
      label: 'Reason (optional)',
      placeholder: 'For example the bank reference or settlement note',
      hint: 'Optional context, up to 200 characters, recorded with the status change.'
    };
  }
  if (action.to === RECONCILED_STATUS) {
    return {
      label: 'Reason (optional)',
      placeholder: 'For example the bank statement reference or reconciliation note',
      hint: 'Optional context, up to 200 characters, recorded with the status change.'
    };
  }
  return {
    label: 'Reason (optional)',
    placeholder: 'For example the duplicate claim or the operator request',
    hint: 'Optional context, up to 200 characters, recorded with the status change.'
  };
}

/** True for a terminal payment status. */
export function isTerminalStatus(status) {
  return Boolean(status) && TERMINAL_STATUSES.includes(status);
}

/** Human label for a terminal status, or '' when the status is not terminal. */
export function terminalStatusLabel(status) {
  return TERMINAL_STATUS_LABELS[status] || '';
}

/**
 * The off-path note under the timeline. Terminal statuses also name their
 * terminal outcome so a cancelled, voided, or stopped payment is unmistakable.
 */
export function offPathNote(status) {
  const label = terminalStatusLabel(status);
  if (label) {
    return `Status ${status} is terminal (${label.toLowerCase()}) and is not on the execution`
      + ' happy path; the forward lifecycle is closed. The payment record still owns its state.';
  }
  return `Status ${status} is not on the execution happy path; the workbench exposes no`
    + ' automatic next action. The payment record still owns its state.';
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
  if (isTerminalAction(action)) {
    if (action.to === 'CANCELLED') {
      return {
        title: 'Cancel payment?',
        description:
          'Confirming writes CANCELLED with the payment version below. Cancelling is terminal:'
          + ' the payment leaves the execution happy path and cannot be advanced further.'
          + ' The record stays visible for audit; a reason is optional.'
      };
    }
    if (action.to === 'VOID') {
      return {
        title: 'Void payment?',
        description:
          'Confirming writes VOID with the payment version below. Voiding is terminal:'
          + ' the payment leaves the execution happy path and cannot be advanced further.'
          + ' A reason is required and recorded with the status change.'
      };
    }
    if (action.to === 'STOPPED') {
      return {
        title: 'Stop payment?',
        description:
          'Confirming writes STOPPED with the payment version below. Stopping is terminal:'
          + ' the payment instruction is halted and the record cannot be advanced further.'
          + ' A reason is required and recorded with the status change.'
      };
    }
  }
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
  const terminal = terminalStatusLabel(status);
  if (terminal) return `Terminal: ${terminal.toLowerCase()}`;
  if (['SUBMITTED', 'ACCEPTED', 'PROCESSING'].includes(status)) {
    return 'Issued to SAP/bank; awaiting settlement';
  }
  if (['APPROVED', 'SCHEDULED'].includes(status)) return 'Approved for execution';
  if (['DRAFT', 'PENDING_AUTHORITY', 'AUTHORIZED'].includes(status)) {
    return 'Blocked: approval required';
  }
  return `No execution action for ${status || 'unknown status'}`;
}
