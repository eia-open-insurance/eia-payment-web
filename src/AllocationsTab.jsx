import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TENANT, api, problemMessage } from './api.js';
import {
  ALLOCATION_COMPONENTS,
  ALLOCATION_REVERSAL_REASON_MAX,
  ALLOCATION_TARGET_TYPES,
  allocationAmount,
  allocationComponent,
  allocationCreatedAt,
  allocationEndpoint,
  allocationId,
  allocationPayload,
  allocationReversed,
  allocationReversedAt,
  allocationReversalPayload,
  allocationReversalReason,
  allocationReverseEndpoint,
  allocationRows,
  allocationTargetHref,
  allocationTargetId,
  allocationTargetReference,
  allocationTargetType,
  componentLabel,
  decimalAmount,
  summarizeAllocations,
  targetMeta,
  targetTypeLabel,
  toUnits,
  validateAllocation,
  validateAllocationReversalReason
} from './allocations.js';
import { formatMoney, shortId } from './format.js';
import { navigate } from './navigation.js';
import EntityPicker from './EntityPicker.jsx';

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background: 'rgba(11, 46, 79, 0.52)'
};

const DIALOG_STYLE = {
  width: 'min(760px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 70px rgba(11, 46, 79, 0.28)'
};

function openLink(event) {
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href'));
}

function labelKey(type, id) {
  return `${type}:${id}`;
}

function initialForm(unallocatedUnits) {
  return {
    targetType: 'DIRECT_CLAIM',
    targetId: '',
    targetLabel: '',
    component: 'INDEMNITY',
    amount: decimalAmount(Math.max(0, unallocatedUnits))
  };
}

/**
 * Allocation ledger for one payment.
 *
 * The tab owns its loading, error, empty, conflict, and form state so an
 * unavailable allocation API never blocks the payment record. The list is
 * fetched when the tab mounts (that is, when it is selected); the modal posts
 * to the same collection and reconciles the summary from the server response.
 */
export default function AllocationsTab({ payment, onChanged }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [targetLabels, setTargetLabels] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(() => initialForm(toUnits(payment?.amount)));
  const [formError, setFormError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [reversal, setReversal] = useState(null);
  const [reversalReason, setReversalReason] = useState('');
  const [reversalFormError, setReversalFormError] = useState('');
  const [reversalError, setReversalError] = useState('');
  const [reversing, setReversing] = useState(false);

  const mountedRef = useRef(true);
  const attemptedLabelsRef = useRef(new Set());
  const summary = useMemo(() => summarizeAllocations(payload, payment), [payload, payment]);
  const currency = payment.currency || 'USD';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function fetchAllocations() {
    const { response, body } = await api(allocationEndpoint(payment.id));
    if (!response.ok) {
      const error = new Error(
        problemMessage(body, `Allocations request failed: ${response.status}`)
      );
      error.status = response.status;
      throw error;
    }
    return body;
  }

  // The list belongs to the selected payment: reset every tab-local state when
  // the payment changes, then load the ledger without blocking the record.
  useEffect(() => {
    let alive = true;
    setPayload(null);
    setLoading(true);
    setLoadError('');
    setTargetLabels({});
    setShowForm(false);
    setForm(initialForm(toUnits(payment.amount)));
    setFormError('');
    setConflict(false);
    setSaving(false);
    setStatus('');
    setReversal(null);
    setReversalReason('');
    setReversalFormError('');
    setReversalError('');
    setReversing(false);
    attemptedLabelsRef.current = new Set();

    fetchAllocations()
      .then((body) => {
        if (!alive) return;
        setPayload(body);
        setLoading(false);
      })
      .catch((cause) => {
        if (!alive) return;
        setLoadError(cause.message || 'Allocations could not be loaded.');
        setLoading(false);
      });

    return () => {
      alive = false;
    };
    // fetchAllocations closes over the payment id from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment.id]);

  /**
   * Rows created before this browser session carry only a target id. Try the
   * owning vertical's predictive search with that id; when the result contains
   * the same record, use its label, otherwise the short id stays visible. The
   * lookup is an enhancement and never surfaces an error.
   */
  useEffect(() => {
    if (!summary || loading || loadError) return;
    const pending = [];
    const seen = new Set();
    summary.items.forEach((row) => {
      const type = allocationTargetType(row);
      const id = allocationTargetId(row);
      if (!type || !id || allocationTargetReference(row)) return;
      const key = labelKey(type, id);
      if (targetLabels[key] || attemptedLabelsRef.current.has(key) || seen.has(key)) return;
      const meta = targetMeta(type);
      if (!meta) return;
      seen.add(key);
      attemptedLabelsRef.current.add(key);
      pending.push({ key, id, meta });
    });

    pending.forEach(({ key, id, meta }) => {
      fetch(`${meta.endpoint}?q=${encodeURIComponent(id)}&limit=8`, {
        headers: { 'X-EIA-Tenant': TENANT, 'X-EIA-Book': meta.book }
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          if (!mountedRef.current || !body) return;
          const items = Array.isArray(body) ? body : Array.isArray(body.items) ? body.items : [];
          const match = items.find(
            (item) => String(item?.id || '').toLowerCase() === id.toLowerCase()
          );
          const label = match && (match.label || match.targetReference || match.reference);
          if (!label) return;
          setTargetLabels((current) => (
            current[key] ? current : { ...current, [key]: String(label) }
          ));
        })
        .catch(() => {
          // Resolution is best effort; the short id remains the fallback.
        });
    });
  }, [summary, loading, loadError, targetLabels]);

  useEffect(() => {
    if (!showForm) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) closeForm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showForm, saving]);

  useEffect(() => {
    if (!reversal) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !reversing) closeReversal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reversal, reversing]);

  const items = summary?.items || [];
  const remainingUnits = summary ? summary.remainingUnits : toUnits(payment.amount);
  const unallocatedUnits = remainingUnits;
  const addDisabled = loading || Boolean(loadError) || !summary || remainingUnits <= 0
    || saving || Boolean(reversal);
  const formMeta = targetMeta(form.targetType);

  function targetLabel(row) {
    const reference = allocationTargetReference(row);
    if (reference) return reference;
    const type = allocationTargetType(row);
    const id = allocationTargetId(row);
    return targetLabels[labelKey(type, id)] || shortId(id);
  }

  function openForm() {
    if (addDisabled) return;
    setForm(initialForm(unallocatedUnits));
    setFormError('');
    setConflict(false);
    setStatus('');
    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;
    setShowForm(false);
    setFormError('');
    setConflict(false);
  }

  /**
   * Opens the reversal dialog for one active split. Reversed allocations keep
   * their ledger row for audit, so they never offer the action again.
   */
  function openReversal(row) {
    if (!row || allocationReversed(row) || reversing || saving) return;
    const id = allocationId(row);
    if (!id) return;
    setReversal({ row, id });
    setReversalReason('');
    setReversalFormError('');
    setReversalError('');
    setStatus('');
  }

  function closeReversal() {
    if (reversing) return;
    setReversal(null);
    setReversalReason('');
    setReversalFormError('');
    setReversalError('');
  }

  /**
   * Reverses one split. The POST only appends the reversal; the split stays in
   * the ledger with its reason and date, so the optimistic row update keeps the
   * original target, component, and amount and adds the stamped reversal.
   */
  async function submitReversal(event) {
    event.preventDefault();
    if (!reversal || reversing) return;
    const validation = validateAllocationReversalReason(reversalReason);
    if (validation) {
      setReversalFormError(validation);
      return;
    }

    const payloadBody = allocationReversalPayload(reversalReason);
    setReversing(true);
    setReversalFormError('');
    setReversalError('');
    setStatus('');

    try {
      const { response, body } = await api(
        allocationReverseEndpoint(payment.id, reversal.id),
        { method: 'POST', body: payloadBody }
      );
      if (!response.ok) {
        const message = problemMessage(body, `Allocation reversal failed: ${response.status}`);
        setReversalError(
          response.status === 409
            ? `${message} The allocation may already have been reversed; reload the allocations before retrying.`
            : message
        );
        return;
      }

      const updated = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
      const reversedAt =
        updated.reversedAt || updated.reversalAt || updated.reversed_at || '';
      const reason =
        updated.reversalReason || updated.reversedReason || payloadBody.reason;
      const nextRow = {
        ...reversal.row,
        ...updated,
        reversed: true,
        reversalReason: reason,
        reversedAt
      };

      // Drop any server envelope totals with the optimistic update so the
      // summary recomputes from the complete row list, then reconcile with the
      // ledger. A failed refresh leaves the reversed row visible with a hint.
      setPayload((current) => ({
        items: allocationRows(current).map((entry) => (
          allocationId(entry) === reversal.id ? nextRow : entry
        ))
      }));
      setReversal(null);
      setReversalReason('');
      setStatus(
        `Reversed ${formatMoney(allocationAmount(nextRow), currency)} allocation to `
        + `${targetLabel(nextRow)}. The original split remains on the ledger.`
      );

      fetchAllocations()
        .then((next) => {
          if (mountedRef.current) setPayload(next);
        })
        .catch(() => {
          if (mountedRef.current) {
            setStatus(
              (previous) => `${previous} Reload the allocations to reconcile the totals.`
            );
          }
        });
      if (onChanged) onChanged();
    } catch (cause) {
      setReversalError(cause.message);
    } finally {
      setReversing(false);
    }
  }

  function update(field, value) {
    setForm((current) => {
      if (field !== 'targetType') return { ...current, [field]: value };
      return { ...current, targetType: value, targetId: '', targetLabel: '' };
    });
  }

  function chooseTarget(id, item) {
    const label = item?.label || item?.reference || item?.secondary || '';
    if (id && label) {
      const key = labelKey(form.targetType, id);
      setTargetLabels((current) => (current[key] ? current : { ...current, [key]: label }));
    }
    setForm((current) => ({
      ...current,
      targetId: id || '',
      targetLabel: id ? label : ''
    }));
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const validation = validateAllocation(form, unallocatedUnits, currency);
    if (validation) {
      setFormError(validation);
      setConflict(false);
      return;
    }

    const payloadBody = allocationPayload(form);
    const pickedKey = labelKey(payloadBody.targetType, payloadBody.targetId);
    const pickedLabel = targetLabels[pickedKey] || form.targetLabel || shortId(payloadBody.targetId);
    setSaving(true);
    setFormError('');
    setConflict(false);
    setStatus('');

    try {
      const { response, body } = await api(allocationEndpoint(payment.id), {
        method: 'POST',
        body: payloadBody
      });
      if (!response.ok) {
        if (response.status === 409) {
          setConflict(true);
          setFormError(
            `${problemMessage(
              body,
              'The allocation was rejected because it would exceed the payment amount.'
            )} The allocations changed since this form was loaded; reload the allocations and adjust the amount.`
          );
        } else {
          setFormError(problemMessage(body, `Allocation failed: ${response.status}`));
        }
        return;
      }

      // Show the created row immediately, then reconcile with the ledger. A
      // failed refresh leaves the saved row visible with a reload hint.
      const created = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
      const row = {
        ...payloadBody,
        ...created,
        targetType: created.targetType || payloadBody.targetType,
        targetId: created.targetId || payloadBody.targetId,
        component: created.component || payloadBody.component,
        amount: created.amount ?? payloadBody.amount
      };
      setPayload((current) => {
        const existing = allocationRows(current);
        const createdId = allocationId(row);
        const next = createdId
          ? [...existing.filter((entry) => allocationId(entry) !== createdId), row]
          : [...existing, row];
        return { items: next };
      });
      setTargetLabels((current) => (
        current[pickedKey] ? current : { ...current, [pickedKey]: pickedLabel }
      ));
      setShowForm(false);
      setStatus(`Allocated ${formatMoney(payloadBody.amount, payment.currency)} to ${pickedLabel}.`);

      fetchAllocations()
        .then((next) => {
          if (mountedRef.current) setPayload(next);
        })
        .catch(() => {
          if (mountedRef.current) {
            setStatus(
              (previous) => `${previous} Reload the allocations to reconcile the totals.`
            );
          }
        });
      if (onChanged) onChanged();
    } catch (cause) {
      setFormError(cause.message);
    } finally {
      setSaving(false);
    }
  }

  async function retry() {
    setLoading(true);
    setLoadError('');
    setStatus('');
    try {
      setPayload(await fetchAllocations());
    } catch (cause) {
      setPayload(null);
      setLoadError(cause.message || 'Allocations could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  async function reloadForConflict() {
    setFormError('');
    setConflict(false);
    setStatus('');
    try {
      setPayload(await fetchAllocations());
      setStatus('Allocations reloaded.');
    } catch (cause) {
      setFormError(cause.message || 'The allocations could not be reloaded.');
    }
  }

  return (
    <section aria-label="Payment allocations">
      <div className="eia-section-title">
        <h2>Payment allocations</h2>
        <div className="eia-actions">
          <button
            type="button"
            className="eia-btn-secondary"
            data-testid="allocations-refresh"
            onClick={retry}
            disabled={loading}
          >
            Refresh allocations
          </button>
          <button
            type="button"
            data-testid="allocation-add"
            aria-haspopup="dialog"
            aria-expanded={showForm}
            onClick={openForm}
            disabled={addDisabled}
            title={
              !loading && summary && summary.remainingUnits <= 0
                ? 'The payment is fully allocated.'
                : undefined
            }
          >
            Add allocation
          </button>
        </div>
      </div>
      <p className="eia-muted" style={{ marginTop: 0 }}>
        Split this payment across the claim or policy components it settles. The net of the
        allocations cannot exceed the {formatMoney(payment.amount, payment.currency)} payment,
        and adding or reversing an allocation never changes the payment amount.
      </p>

      <section className="eia-summary-grid" aria-label="Allocation summary">
        <div className="eia-card">
          <h3>Payment amount</h3>
          <div className="value" data-testid="allocations-payment-amount">
            {formatMoney(payment.amount, payment.currency)}
          </div>
          <div className="eia-metric-label">{payment.currency || '—'} instructed amount</div>
        </div>
        <div className="eia-card">
          <h3>Net allocated</h3>
          <div className="value" data-testid="allocations-net-amount">
            {loading ? '…' : summary && !loadError ? formatMoney(decimalAmount(summary.netAllocatedUnits), currency) : '—'}
          </div>
          <div className="eia-metric-label">
            {summary && !loading && !loadError ? (
              <>
                <span data-testid="allocations-count">{summary.count}</span>
                {` allocation${summary.count === 1 ? '' : 's'}`}
                {summary.reversedCount > 0
                  ? ` · ${summary.reversedCount} reversed`
                  : ''}
              </>
            ) : (
              <>
                <span data-testid="allocations-count">{loading ? '…' : '—'}</span>
                {' '}claim and policy splits
              </>
            )}
          </div>
        </div>
        <div className="eia-card">
          <h3>Reversed</h3>
          <div className="value" data-testid="allocations-reversed-amount">
            {loading ? '…' : summary && !loadError ? formatMoney(decimalAmount(summary.reversedUnits), currency) : '—'}
          </div>
          <div className="eia-metric-label">
            {summary && !loadError && summary.reversedCount > 0
              ? `${summary.reversedCount} reversed split${summary.reversedCount === 1 ? '' : 's'} kept for audit`
              : 'No reversed splits'}
          </div>
        </div>
        <div className="eia-card">
          <h3>Remaining</h3>
          <div className="value" data-testid="allocations-remaining-amount">
            {loading ? '…' : summary && !loadError ? formatMoney(decimalAmount(summary.remainingUnits), currency) : '—'}
          </div>
          <div className="eia-metric-label">
            {summary && !loadError && summary.overAllocated
              ? `Net allocated exceeds the payment by ${formatMoney(
                  decimalAmount(summary.netAllocatedUnits - summary.paymentUnits),
                  currency
                )}`
              : 'Payment amount minus net allocated'}
          </div>
        </div>
      </section>

      <section className="eia-card" aria-label="Allocation ledger" data-testid="allocations-card">
        <div className="eia-section-title" style={{ marginTop: 0 }}>
          <h3>Allocation ledger</h3>
          <span className="eia-muted" data-testid="allocation-ledger-count">
            {loading
              ? '…'
              : loadError
                ? '—'
                : `${items.length} row${items.length === 1 ? '' : 's'}${
                    summary && summary.reversedCount > 0
                      ? ` · ${summary.reversedCount} reversed`
                      : ''
                  }`}
          </span>
        </div>

        {status && (
          <p role="status" data-testid="allocations-status" style={{ margin: '8px 0 0' }}>
            {status}
          </p>
        )}

        {loading && (
          <p className="eia-muted" data-testid="allocations-loading" style={{ margin: '12px 0 0' }}>
            Loading payment allocations…
          </p>
        )}

        {!loading && loadError && (
          <div data-testid="allocations-error">
            <p role="alert" style={{ margin: '12px 0 0' }}>{loadError}</p>
            <button
              type="button"
              className="eia-btn-secondary"
              onClick={retry}
              disabled={loading}
              style={{ marginTop: 8 }}
            >
              Retry allocations
            </button>
          </div>
        )}

        {!loading && !loadError && items.length === 0 && (
          <div className="eia-empty" data-testid="allocations-empty" style={{ marginTop: 10 }}>
            <p style={{ marginTop: 0 }}>No allocations recorded for this payment yet.</p>
            <p style={{ marginTop: 0 }}>
              Use Add allocation to split the payment across a claim or policy component. The
              full amount remains unallocated until then.
            </p>
          </div>
        )}

        {!loading && !loadError && items.length > 0 && (
          <div className="eia-table-wrap" data-testid="allocations-table" style={{ marginTop: 10 }}>
            <table className="eia-table" aria-label="Payment allocations">
              <thead>
                <tr>
                  <th>Target type</th>
                  <th>Target reference</th>
                  <th>Component</th>
                  <th>Amount</th>
                  <th>Reversal</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, index) => {
                  const type = allocationTargetType(row);
                  const href = allocationTargetHref(row);
                  const label = targetLabel(row);
                  const reversed = allocationReversed(row);
                  const tone = type === 'DIRECT_CLAIM' ? 'direct' : type === 'ASSUMED_CLAIM' ? 'assumed' : '';
                  return (
                    <tr
                      key={allocationId(row) || `${allocationTargetId(row)}-${index}`}
                      data-testid={`allocation-row-${index}`}
                      data-reversed={reversed ? 'true' : 'false'}
                    >
                      <td>
                        <span
                          className={`eia-badge ${tone}`.trim()}
                          data-testid={`allocation-target-type-${index}`}
                          title={targetTypeLabel(type)}
                        >
                          {type || '—'}
                        </span>
                      </td>
                      <td>
                        {href ? (
                          <a
                            href={href}
                            data-testid={`allocation-target-link-${index}`}
                            title={`Open ${targetTypeLabel(type)} record`}
                            onClick={openLink}
                          >
                            {label}
                          </a>
                        ) : (
                          <span data-testid={`allocation-target-${index}`}>{label}</span>
                        )}
                      </td>
                      <td data-testid={`allocation-component-${index}`}>
                        {allocationComponent(row) || '—'}
                      </td>
                      <td
                        data-testid={`allocation-amount-${index}`}
                        style={{ textAlign: 'right', whiteSpace: 'nowrap' }}
                      >
                        {formatMoney(allocationAmount(row), currency)}
                      </td>
                      <td data-testid={`allocation-reversal-${index}`}>
                        {reversed ? (
                          <div className="eia-allocation-reversal">
                            <span
                              className="eia-badge reversed"
                              data-testid={`allocation-reversed-badge-${index}`}
                            >
                              REVERSED
                            </span>
                            <span
                              className="eia-allocation-reversal-reason"
                              data-testid={`allocation-reversed-reason-${index}`}
                            >
                              {allocationReversalReason(row) || 'No reason recorded'}
                            </span>
                            <span
                              className="eia-muted"
                              data-testid={`allocation-reversed-at-${index}`}
                            >
                              {allocationReversedAt(row) || 'Date not recorded'}
                            </span>
                          </div>
                        ) : (
                          <span className="eia-badge ok" data-testid={`allocation-active-badge-${index}`}>
                            ACTIVE
                          </span>
                        )}
                      </td>
                      <td data-testid={`allocation-created-${index}`}>
                        {allocationCreatedAt(row) || '—'}
                      </td>
                      <td>
                        {reversed ? (
                          <span
                            className="eia-muted"
                            data-testid={`allocation-reversed-locked-${index}`}
                          >
                            Reversed
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="eia-btn-secondary"
                            data-testid={`allocation-reverse-${index}`}
                            onClick={() => openReversal(row)}
                            disabled={reversing || saving || loading}
                            title="Reverse this allocation; the split stays on the ledger"
                          >
                            Reverse
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className="eia-context-panel"
        aria-label="Why this matters"
        data-testid="allocations-context"
        style={{ marginTop: 14 }}
      >
        <h4>Why this matters</h4>
        <p>
          An allocation splits one payment across the claim or policy components it settles — for
          example the indemnity and defense portions of a direct claim, or the policy year a
          coverage payment belongs to. The sum of the allocations cannot exceed the payment
          amount; any remainder is shown as unallocated. Reversal is an append-only accounting
          correction: it stamps the required reason and the reversal date on the split, keeps the
          original target, component, and amount visible for audit, and never deletes the row.
          Net allocated is the recorded allocations minus the reversed ones, and remaining is the
          payment amount minus net allocated. Allocating or reversing does not change the payment
          amount, approval path, or status — it records how the disbursement is distributed. A
          concurrent change that would over-allocate the payment, or a repeat reversal of the same
          split, is rejected with 409, so reload the ledger before retrying.
        </p>
      </section>

      {showForm && formMeta && (
        <div
          style={OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) closeForm();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="allocation-dialog-title"
            className="eia-card"
            style={DIALOG_STYLE}
            data-testid="allocation-dialog"
          >
            <div className="eia-record-title">
              <div>
                <h2 id="allocation-dialog-title" style={{ margin: 0 }}>Add allocation</h2>
                <p className="eia-record-subtitle">
                  Splits {formatMoney(payment.amount, payment.currency)} across a claim or policy
                  component. The payment amount does not change.
                </p>
              </div>
              <button type="button" className="eia-btn-ghost" onClick={closeForm} disabled={saving}>
                Close
              </button>
            </div>

            <form onSubmit={submit} style={{ marginTop: 16 }} data-testid="allocation-form">
              <div className="eia-form-grid">
                <div className="eia-field">
                  <label htmlFor="allocation-target-type">Target type</label>
                  <select
                    id="allocation-target-type"
                    value={form.targetType}
                    onChange={(event) => update('targetType', event.target.value)}
                    disabled={saving}
                    autoFocus
                  >
                    {ALLOCATION_TARGET_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {targetTypeLabel(type)} ({type})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="eia-field span-2">
                  <label>Target record</label>
                  <EntityPicker
                    key={form.targetType}
                    endpoint={formMeta.endpoint}
                    book={formMeta.book}
                    value={form.targetId}
                    valueLabel={form.targetLabel}
                    onChange={chooseTarget}
                    placeholder={formMeta.placeholder}
                    disabled={saving}
                  />
                  {form.targetId && (
                    <span className="eia-picker-hint">
                      {form.targetLabel || shortId(form.targetId)} ·{' '}
                      <a
                        href={allocationTargetHref(form)}
                        data-testid="allocation-picker-link"
                        onClick={openLink}
                      >
                        Open {targetTypeLabel(form.targetType)} record
                      </a>
                    </span>
                  )}
                </div>
                <div className="eia-field">
                  <label htmlFor="allocation-component">Component</label>
                  <select
                    id="allocation-component"
                    value={form.component}
                    onChange={(event) => update('component', event.target.value)}
                    disabled={saving}
                  >
                    {ALLOCATION_COMPONENTS.map((component) => (
                      <option key={component} value={component}>
                        {componentLabel(component)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="eia-field">
                  <label htmlFor="allocation-amount">Amount</label>
                  <input
                    id="allocation-amount"
                    type="number"
                    step="0.0001"
                    value={form.amount}
                    onChange={(event) => update('amount', event.target.value)}
                    required
                    disabled={saving}
                    aria-describedby="allocation-amount-hint"
                  />
                  <span
                    id="allocation-amount-hint"
                    className="eia-picker-hint"
                    data-testid="allocation-unallocated-hint"
                  >
                    Unallocated {formatMoney(decimalAmount(Math.max(0, unallocatedUnits)), currency)} ·
                    enter more than 0 and no more than the unallocated balance.
                  </span>
                </div>
                <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="eia-btn-secondary"
                    onClick={closeForm}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button type="submit" data-testid="allocation-submit" disabled={saving}>
                    {saving ? 'Allocating…' : 'Add allocation'}
                  </button>
                </div>
              </div>
            </form>

            {formError && (
              <div data-testid={conflict ? 'allocation-stale' : 'allocation-form-error'}>
                <p role="alert" style={{ margin: '10px 0 0' }}>{formError}</p>
                {conflict && (
                  <button
                    type="button"
                    className="eia-btn-secondary"
                    data-testid="allocation-reload"
                    onClick={reloadForConflict}
                    disabled={saving}
                    style={{ marginTop: 8 }}
                  >
                    Reload allocations
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {reversal && (
        <div
          style={OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !reversing) closeReversal();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="allocation-reverse-title"
            className="eia-card"
            style={{ ...DIALOG_STYLE, width: 'min(640px, 100%)' }}
            data-testid="allocation-reverse-dialog"
          >
            <div className="eia-record-title">
              <div>
                <h2 id="allocation-reverse-title" style={{ margin: 0 }}>Reverse allocation</h2>
                <p className="eia-record-subtitle">
                  Reverses {formatMoney(allocationAmount(reversal.row), currency)} allocated to{' '}
                  {targetLabel(reversal.row)} · {componentLabel(allocationComponent(reversal.row)) || '—'}.
                </p>
              </div>
              <button
                type="button"
                className="eia-btn-ghost"
                onClick={closeReversal}
                disabled={reversing}
              >
                Close
              </button>
            </div>

            <p className="eia-muted" data-testid="allocation-reverse-context" style={{ marginTop: 8 }}>
              Original split recorded {allocationCreatedAt(reversal.row) || '—'}. The reversal keeps
              the allocation on the ledger and records a reason and the reversal date; the split is
              never deleted.
            </p>

            {reversalFormError && (
              <p role="alert" data-testid="allocation-reverse-form-error" style={{ margin: '10px 0 0' }}>
                {reversalFormError}
              </p>
            )}
            {reversalError && (
              <p role="alert" data-testid="allocation-reverse-error" style={{ margin: '10px 0 0' }}>
                {reversalError}
              </p>
            )}

            <form onSubmit={submitReversal} style={{ marginTop: 14 }} data-testid="allocation-reverse-form">
              <div className="eia-field">
                <label htmlFor="allocation-reverse-reason">Reversal reason</label>
                <textarea
                  id="allocation-reverse-reason"
                  data-testid="allocation-reverse-reason"
                  rows={3}
                  maxLength={ALLOCATION_REVERSAL_REASON_MAX}
                  value={reversalReason}
                  onChange={(event) => {
                    setReversalReason(event.target.value);
                    setReversalFormError('');
                  }}
                  aria-required="true"
                  aria-invalid={reversalFormError ? 'true' : 'false'}
                  disabled={reversing}
                  autoFocus
                />
                <span className="eia-picker-hint">
                  Required. The reason is kept on the allocation ledger with the reversal date.
                </span>
              </div>
              <div className="eia-actions" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeReversal}
                  disabled={reversing}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="eia-btn-danger"
                  data-testid="allocation-reverse-submit"
                  disabled={reversing}
                >
                  {reversing ? 'Reversing…' : 'Reverse allocation'}
                </button>
              </div>
            </form>

            <section
              className="eia-context-panel"
              aria-label="Allocation reversal context"
              data-testid="allocation-reverse-context-panel"
            >
              <h4>What reversing does</h4>
              <p>
                Appends a reversal to the split&apos;s audit history: the reason and reversal date
                stay on the ledger with the original target, component, and amount. The allocation
                is not deleted, the split is no longer counted in net allocated, and the remaining
                balance rises by its amount. Reversing never changes the payment amount, approval
                path, or status.
              </p>
            </section>
          </section>
        </div>
      )}
    </section>
  );
}
