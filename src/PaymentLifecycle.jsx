import React from 'react';
import {
  EXECUTION_LIFECYCLE,
  isLifecycleComplete,
  isOffPathStatus,
  lifecycleStep,
  lifecycleStepState,
  nextLifecycleAction
} from './lifecycle.js';

const STATE_LABEL = {
  passed: 'Done',
  current: 'Current',
  upcoming: 'Pending',
  'off-path': 'Off path'
};

/**
 * The selected payment's execution action bar and lifecycle timeline.
 *
 * The panel is deliberately state-only: App owns the PATCH, conflict reload, and
 * confirmation dialog. The single next happy-path action is the only button
 * here, so the workbench cannot accidentally skip a step or issue two
 * conflicting transitions from two controls.
 */
export default function PaymentLifecycle({ payment, busy, conflict, onAction, onReload }) {
  if (!payment) return null;

  const action = nextLifecycleAction(payment.status);
  const current = lifecycleStep(payment.status);
  const complete = isLifecycleComplete(payment.status);
  const offPath = isOffPathStatus(payment.status);

  return (
    <section
      className="eia-card eia-lifecycle-card"
      aria-label="Payment execution lifecycle"
      data-testid="payment-lifecycle"
    >
      <div className="eia-lifecycle-head">
        <div>
          <h3>Execution lifecycle</h3>
          <p className="eia-lifecycle-current" data-testid="lifecycle-current" data-version={payment.version}>
            Current status <strong>{payment.status || '—'}</strong>
            {current ? ` · ${current.label}` : ' · off the happy path'}
            {payment.version !== undefined ? ` · version ${payment.version}` : ''}
            {complete ? ' · lifecycle complete' : ''}
          </p>
        </div>
        <div className="eia-actions" data-testid="payment-action-bar">
          {action ? (
            <button
              type="button"
              data-testid="payment-action"
              onClick={() => onAction(action)}
              disabled={busy}
              title={`${action.label}: ${action.from} → ${action.to}`}
            >
              {busy ? 'Working…' : action.label}
            </button>
          ) : (
            <span className="eia-badge ok" data-testid="payment-action-none">
              No action
            </span>
          )}
        </div>
      </div>

      <div className="eia-lifecycle-scroll">
        <ol
          className="eia-lifecycle-steps"
          data-testid="lifecycle-steps"
          aria-label="Payment lifecycle steps"
        >
          {EXECUTION_LIFECYCLE.map((step, index) => {
            const state = lifecycleStepState(payment.status, step.status);
            return (
              <li
                key={step.status}
                className="eia-lifecycle-step"
                data-testid={`lifecycle-step-${step.status}`}
                data-state={state}
                aria-current={state === 'current' ? 'step' : undefined}
                title={`${step.transition}${state === 'current' ? ' · current status' : ''}`}
              >
                <span className="eia-lifecycle-index" aria-hidden="true">{index + 1}</span>
                <span className="eia-lifecycle-status">{step.status}</span>
                <span className="eia-lifecycle-label">{step.label}</span>
                <span className="eia-lifecycle-state">{STATE_LABEL[state]}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {offPath && (
        <p className="eia-lifecycle-off-path" data-testid="lifecycle-off-path">
          Status {payment.status} is not on the execution happy path; the workbench exposes no
          automatic next action. The payment record still owns its state.
        </p>
      )}

      <p className="eia-lifecycle-context" data-testid="lifecycle-context">
        Payment owns execution. Claim and policy links are evidence of what is being paid; they
        never advance or control this lifecycle. Each action in the bar writes one status
        transition through the Payment API using the payment's current version.
      </p>

      {conflict && (
        <div className="eia-lifecycle-conflict" data-testid="lifecycle-conflict">
          <p role="alert" data-testid="lifecycle-conflict-message">{conflict}</p>
          <button
            type="button"
            className="eia-btn-secondary"
            data-testid="lifecycle-reload"
            onClick={onReload}
            disabled={busy}
          >
            Reload payment
          </button>
        </div>
      )}

    </section>
  );
}
