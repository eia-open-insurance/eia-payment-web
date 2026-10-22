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
 * FAILED, RETURNED, CANCELLED, VOID, and the other exception states are not on
 * the happy path. RETURNED is recoverable via Reschedule; the other exception
 * states are terminal. Post-payment controls (Return, Reverse, Escheat) move a
 * settled payment off the happy path and always require confirmation.
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
export const PARTIALLY_PAID_STATUS = 'PARTIALLY_PAID';
export const RETURNED_STATUS = 'RETURNED';
export const REVERSED_STATUS = 'REVERSED';
export const ESCHEATED_STATUS = 'ESCHEATED';

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

/**
 * Exception states that end the forward happy path permanently. RETURNED is
 * off-path but recoverable, so it is described as an exception rather than a
 * terminal outcome: the API allows it to be rescheduled.
 */
export const TERMINAL_STATUSES = [
  'FAILED',
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
  CANCELLED: 'Payment cancelled',
  VOID: 'Payment voided',
  REJECTED: 'Payment rejected',
  STOPPED: 'Payment stopped',
  REVERSED: 'Payment reversed',
  ESCHEATED: 'Payment escheated'
};

/**
 * One secondary action descriptor. `kind` separates the terminal exception
 * actions from the recovery action that re-enters the happy path, so the panel
 * can style and explain them differently without overloading `to`.
 *
 * `reasonRequired` marks the post-payment actions whose audit trail is
 * mandatory: Return, Reverse, and Escheat. Every secondary action is still
 * confirmed and sends one versioned PATCH.
 */
function secondaryAction(id, from, to, {
  kind = 'terminal',
  label,
  reasonRequired = false,
  danger
} = {}) {
  const defaultLabel = `${id.charAt(0).toUpperCase()}${id.slice(1)} payment`;
  return {
    kind,
    id,
    from,
    to,
    label: label || defaultLabel,
    confirm: true,
    reasonRequired,
    danger: danger !== undefined ? danger : kind === 'terminal' && to !== 'CANCELLED'
  };
}

function terminalAction(id, from, to, options = {}) {
  return secondaryAction(id, from, to, {
    ...options,
    // Void and Stop keep their mandatory audit reason by default.
    reasonRequired: options.reasonRequired !== undefined
      ? options.reasonRequired
      : to === 'VOID' || to === 'STOPPED'
  });
}

function recoveryAction(id, from, to, options = {}) {
  return secondaryAction(id, from, to, {
    label: 'Reschedule',
    ...options,
    kind: 'recovery',
    danger: false
  });
}

/**
 * Secondary actions per current status. These move the payment off the happy
 * path (or, for Reschedule, bring it back), so every one is confirmed. Return,
 * Reverse, and Escheat require a reason; Cancel and Reschedule accept an
 * optional one.
 *
 * Post-payment controls mirror the Payment API transition graph:
 *   PAID           -> RETURNED (bank return) | REVERSED (accounting reversal)
 *   PARTIALLY_PAID -> RETURNED | REVERSED
 *   RECONCILED     -> ESCHEATED (unclaimed funds)
 *   RETURNED       -> SCHEDULED (reissue/reschedule) | CANCELLED
 *
 * Cancel, void, and stop remain available on the pre-execution statuses.
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
  PAID: [
    terminalAction('return', 'PAID', 'RETURNED', { reasonRequired: true }),
    terminalAction('reverse', 'PAID', 'REVERSED', { reasonRequired: true })
  ],
  PARTIALLY_PAID: [
    terminalAction('return', 'PARTIALLY_PAID', 'RETURNED', { reasonRequired: true }),
    terminalAction('reverse', 'PARTIALLY_PAID', 'REVERSED', { reasonRequired: true })
  ],
  RECONCILED: [
    terminalAction('escheat', 'RECONCILED', 'ESCHEATED', { reasonRequired: true })
  ],
  RETURNED: [
    recoveryAction('reschedule', 'RETURNED', 'SCHEDULED'),
    terminalAction('cancel', 'RETURNED', 'CANCELLED')
  ],
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

/** Secondary actions offered for a status; empty for other statuses. */
export function secondaryLifecycleActions(status) {
  return SECONDARY_ACTIONS[status] || [];
}

/** True when the action moves the payment to a terminal exception status. */
export function isTerminalAction(action) {
  return Boolean(action) && action.kind === 'terminal';
}

/** True when the action re-enters the happy path, currently only Reschedule. */
export function isRecoveryAction(action) {
  return Boolean(action) && action.kind === 'recovery';
}

/** Return, Reverse, Escheat, Void, and Stop require a reason; others do not. */
export function actionRequiresReason(action) {
  return Boolean(action && action.reasonRequired);
}

/**
 * Rejects a blank reason for actions whose audit trail is mandatory. Returns ''
 * when the action may proceed, so the same guard serves the dialog and any
 * direct caller.
 */
export function reasonValidationError(action, reason) {
  if (!actionRequiresReason(action)) return '';
  if (String(reason || '').trim()) return '';
  const messages = {
    RETURNED: 'A reason is required to return a payment.',
    REVERSED: 'A reason is required to reverse a payment.',
    ESCHEATED: 'A reason is required to escheat a payment.',
    STOPPED: 'A reason is required to stop a payment.',
    VOID: 'A reason is required to void a payment.'
  };
  return messages[action.to] || 'A reason is required for this payment action.';
}

/** Dialog copy for the optional/required reason field. */
export function reasonFieldCopy(action) {
  if (!action) {
    return { label: 'Reason (optional)', placeholder: '', hint: '' };
  }
  if (actionRequiresReason(action)) {
    const placeholders = {
      RETURNED: 'Explain why this payment is being returned',
      REVERSED: 'Explain why this payment is being reversed',
      ESCHEATED: 'Explain why this payment is being escheated',
      STOPPED: 'Explain why this payment is being stopped',
      VOID: 'Explain why this payment is being voided'
    };
    return {
      label: 'Reason (required)',
      placeholder: placeholders[action.to] || 'Explain why this payment action is needed',
      hint: 'Required for audit; up to 200 characters, recorded with the status change.'
    };
  }
  if (isRecoveryAction(action)) {
    return {
      label: 'Reason (optional)',
      placeholder: 'For example the corrected payment run or value date',
      hint: 'Optional context, up to 200 characters, recorded with the status change.'
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
 * The off-path note under the timeline. Terminal statuses name their terminal
 * outcome; the post-payment exception statuses explain the controls that stay
 * available so a partial or returned payment is never a dead end.
 */
export function offPathNote(status) {
  if (status === PARTIALLY_PAID_STATUS) {
    return 'Status PARTIALLY_PAID is not on the execution happy path: only part of the'
      + ' instructed amount has settled. Return or Reverse the payment to close the instruction;'
      + ' the payment record still owns its state.';
  }
  if (status === RETURNED_STATUS) {
    return 'Status RETURNED is not on the execution happy path: the bank returned the funds.'
      + ' The payment is recoverable — Reschedule re-enters the lifecycle at SCHEDULED, or'
      + ' Cancel closes it at CANCELLED.';
  }
  const label = terminalStatusLabel(status);
  if (label) {
    return `Status ${status} is terminal (${label.toLowerCase()}) and is not on the execution`
      + ' happy path; the forward lifecycle is closed. The payment record still owns its state.';
  }
  return `Status ${status} is not on the execution happy path; the workbench exposes no`
    + ' automatic forward action. The payment record still owns its state.';
}

/**
 * Post-payment explanation for the statuses that keep controls after settlement.
 * PAID and RECONCILED are on the happy path, so they need this note while the
 * off-path statuses already carry an off-path note.
 */
export function postPaymentNote(status) {
  if (status === PAID_STATUS) {
    return 'Paid funds can still be returned by the bank or reversed for accounting.'
      + ' Return and Reverse move the payment off the happy path, require a reason, and are'
      + ' confirmed; Reconcile remains the forward step.';
  }
  if (status === RECONCILED_STATUS) {
    return 'Reconciliation completes the forward lifecycle. If the payee cannot be located and'
      + ' the funds are unclaimed, Escheat payment is still available; escheatment is terminal'
      + ' and requires a reason.';
  }
  return '';
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
 * always sent; `reason` is omitted when blank so routine transitions send the
 * minimal payload. Callers guard mandatory reasons with reasonValidationError.
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
 * Confirmation copy for every action that writes a status. Keeping it in one
 * place makes the dialog wording and tests agree.
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
    if (action.to === RETURNED_STATUS) {
      return {
        title: 'Return payment?',
        description:
          'Confirming writes RETURNED with the payment version below. Returning records that the'
          + ' bank sent the funds back; the payment leaves the happy path but stays recoverable.'
          + ' It can be rescheduled or cancelled afterwards. A reason is required and recorded'
          + ' with the status change.'
      };
    }
    if (action.to === REVERSED_STATUS) {
      return {
        title: 'Reverse payment?',
        description:
          'Confirming writes REVERSED with the payment version below. Reversing is terminal:'
          + ' the payment leaves the execution happy path and cannot be advanced further.'
          + ' A reason is required and recorded with the status change.'
      };
    }
    if (action.to === ESCHEATED_STATUS) {
      return {
        title: 'Escheat payment?',
        description:
          'Confirming writes ESCHEATED with the payment version below. Escheatment is terminal:'
          + ' the unclaimed funds leave the payment lifecycle and cannot be advanced further.'
          + ' A reason is required and recorded with the status change.'
      };
    }
  }
  if (isRecoveryAction(action)) {
    return {
      title: 'Reschedule payment?',
      description:
        'Confirming writes SCHEDULED with the payment version below. This re-enters the execution'
        + ' happy path at Scheduled so the returned payment can be sent again; a reason is optional.'
    };
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
  if (status === PARTIALLY_PAID_STATUS) return 'Partially settled; return or reverse available';
  if (status === RETURNED_STATUS) return 'Returned; reschedule or cancel available';
  const terminal = isTerminalStatus(status) ? terminalStatusLabel(status) : '';
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
