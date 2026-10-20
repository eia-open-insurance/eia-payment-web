import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TENANT, api, problemMessage } from './api.js';
import {
  ALLOCATION_COMPONENTS,
  ALLOCATION_TARGET_TYPES,
  allocationAmount,
  allocationComponent,
  allocationCreatedAt,
  allocationEndpoint,
  allocationId,
  allocationPayload,
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
  validateAllocation
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

  const items = summary?.items || [];
  const unallocatedUnits = summary ? summary.unallocatedUnits : toUnits(payment.amount);
  const addDisabled = loading || Boolean(loadError) || !summary || unallocatedUnits <= 0 || saving;
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
              !loading && summary && summary.unallocatedUnits <= 0
                ? 'The payment is fully allocated.'
                : undefined
            }
          >
            Add allocation
          </button>
        </div>
      </div>
      <p className="eia-muted" style={{ marginTop: 0 }}>
        Split this payment across the claim or policy components it settles. The sum of the
        allocations cannot exceed the {formatMoney(payment.amount, payment.currency)} payment,
        and adding an allocation never changes the payment amount.
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
          <h3>Allocated</h3>
          <div className="value" data-testid="allocations-allocated-amount">
            {loading ? '…' : summary && !loadError ? formatMoney(decimalAmount(summary.allocatedUnits), currency) : '—'}
          </div>
          <div className="eia-metric-label">
            {summary && !loadError ? `${summary.count} allocation${summary.count === 1 ? '' : 's'}` : 'Claim and policy splits'}
          </div>
        </div>
        <div className="eia-card">
          <h3>Unallocated</h3>
          <div className="value" data-testid="allocations-unallocated-amount">
            {loading ? '…' : summary && !loadError ? formatMoney(decimalAmount(summary.unallocatedUnits), currency) : '—'}
          </div>
          <div className="eia-metric-label">
            {summary && !loadError && summary.overAllocated
              ? `Allocated exceeds the payment by ${formatMoney(
                  decimalAmount(summary.allocatedUnits - summary.paymentUnits),
                  currency
                )}`
              : 'Payment amount minus allocated'}
          </div>
        </div>
        <div className="eia-card">
          <h3>Allocations</h3>
          <div className="value" data-testid="allocations-count">
            {loading ? '…' : summary && !loadError ? summary.count : '—'}
          </div>
          <div className="eia-metric-label">Claim or policy targets</div>
        </div>
      </section>

      <section className="eia-card" aria-label="Allocation ledger" data-testid="allocations-card">
        <div className="eia-section-title" style={{ marginTop: 0 }}>
          <h3>Allocation ledger</h3>
          <span className="eia-muted">
            {loading
              ? '…'
              : loadError
                ? '—'
                : `${items.length} row${items.length === 1 ? '' : 's'}`}
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
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, index) => {
                  const type = allocationTargetType(row);
                  const href = allocationTargetHref(row);
                  const label = targetLabel(row);
                  const tone = type === 'DIRECT_CLAIM' ? 'direct' : type === 'ASSUMED_CLAIM' ? 'assumed' : '';
                  return (
                    <tr key={allocationId(row) || `${allocationTargetId(row)}-${index}`} data-testid={`allocation-row-${index}`}>
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
                      <td data-testid={`allocation-created-${index}`}>
                        {allocationCreatedAt(row) || '—'}
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
          amount; any remainder is shown as unallocated. Allocating does not change the payment
          amount, approval path, or status — it records how the disbursement is distributed. A
          concurrent change that would over-allocate the payment is rejected with 409, so reload
          the ledger before adjusting the amount.
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
    </section>
  );
}
