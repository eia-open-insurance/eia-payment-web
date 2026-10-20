import React, { useEffect, useState } from 'react';
import './ui.css';

const TENANT = '11111111-1111-7111-8111-111111111111';
const DEMO_PAYEE = '22222222-2222-7222-8222-222222222222';

const PAYMENT_TYPES = [
  'INDEMNITY', 'DEFENSE_COST', 'ALAE', 'EXPENSE', 'MEDICAL',
  'STRUCTURED_SETTLEMENT', 'ANNUITY', 'LIEN_PAYMENT', 'TRUST_DEPOSIT',
  'TRUST_DISTRIBUTION', 'SUBROGATION_RECOVERY', 'SALVAGE_RECOVERY',
  'ASSUMED_RECOVERY', 'DEDUCTIBLE_REIMBURSEMENT', 'PREMIUM', 'COMMISSION',
  'BROKERAGE', 'CASH_CALL', 'TECHNICAL_ACCOUNT_SETTLEMENT',
  'SECURITY_COLLATERAL', 'REFUND', 'OFFSET', 'INTERCOMPANY', 'TAX', 'FEE'
];

const NEXT_ACTION = {
  DRAFT: { path: 'submit', label: 'Submit' },
  PENDING_AUTHORITY: { path: 'authorize', label: 'Authorize' },
  AUTHORIZED: { path: 'approve', label: 'Approve' },
  APPROVED: { path: 'issue', label: 'Issue' },
  SCHEDULED: { path: 'issue', label: 'Issue' }
};

const ACTION_NOTICE = {
  submit: 'submitted for authority',
  authorize: 'authorized',
  approve: 'approved for issuance',
  issue: 'issued to SAP/bank'
};

const LIFECYCLE = [
  { status: 'DRAFT', transition: 'Payment created' },
  { status: 'PENDING_AUTHORITY', transition: 'Submitted for authority' },
  { status: 'AUTHORIZED', transition: 'Authorized by approver' },
  { status: 'APPROVED', transition: 'Approved for issuance' },
  { status: 'SCHEDULED', transition: 'Scheduled for payment run' },
  { status: 'SUBMITTED', transition: 'Issued to SAP/bank' }
];

const LIFECYCLE_INDEX = {
  DRAFT: 0,
  PENDING_AUTHORITY: 1,
  AUTHORIZED: 2,
  APPROVED: 3,
  SCHEDULED: 4,
  SUBMITTED: 5,
  ACCEPTED: 6,
  PROCESSING: 7,
  PARTIALLY_PAID: 8,
  PAID: 8,
  RECONCILED: 9
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'approval', label: 'Approval Path' },
  { id: 'details', label: 'Payment Details' }
];

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

function today() {
  return new Date().toISOString().slice(0, 10);
}

function initialForm() {
  return {
    paymentType: 'INDEMNITY',
    amount: '125000.00',
    currency: 'USD',
    payeePartyId: DEMO_PAYEE,
    paymentDate: today()
  };
}

function formatMoney(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const value = Number(amount);
  if (!Number.isFinite(value) || !currency) return String(amount);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

function shortId(value) {
  if (!value) return '—';
  const text = String(value);
  return text.length > 8 ? `${text.slice(0, 8)}…` : text;
}

function humanize(value) {
  if (!value) return '—';
  return String(value).replace(/_/g, ' ');
}

function statusTone(status) {
  if (['SUBMITTED', 'ACCEPTED', 'PROCESSING', 'PARTIALLY_PAID', 'PAID', 'RECONCILED'].includes(status)) {
    return 'green';
  }
  if (['REJECTED', 'FAILED', 'CANCELLED', 'STOPPED', 'RETURNED', 'REVERSED', 'VOID'].includes(status)) {
    return 'red';
  }
  if (['DRAFT', 'PENDING_AUTHORITY'].includes(status)) return 'amber';
  return 'blue';
}

function lifecycleIndex(status) {
  return Object.prototype.hasOwnProperty.call(LIFECYCLE_INDEX, status) ? LIFECYCLE_INDEX[status] : -1;
}

function executionLabel(status) {
  if (['DRAFT', 'PENDING_AUTHORITY', 'AUTHORIZED'].includes(status)) return 'Blocked: approval required';
  if (['APPROVED', 'SCHEDULED'].includes(status)) return 'Approved for execution';
  if (['SUBMITTED', 'ACCEPTED', 'PROCESSING', 'PARTIALLY_PAID', 'PAID', 'RECONCILED'].includes(status)) {
    return 'Issued to SAP/bank';
  }
  return 'No execution action recorded';
}

function readJson(response) {
  return response.json().catch(() => null);
}

function problemMessage(body, fallback) {
  if (!body) return fallback;
  const summary = body.message || body.detail || body.title || fallback;
  const code = typeof body.code === 'string' && body.code ? `${body.code}: ` : '';
  const issues = Array.isArray(body.details) ? body.details : Array.isArray(body.errors) ? body.errors : [];
  if (issues.length === 0) return `${code}${summary}`;
  const details = issues
    .map((issue) => `${issue.field || 'request'}: ${issue.message || issue.code || 'is invalid'}`)
    .join('; ');
  return `${code}${summary} (${details})`;
}

async function api(path, options = {}) {
  const headers = { 'X-EIA-Tenant': TENANT };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = await readJson(response);
  return { response, body };
}

export default function App() {
  const [payments, setPayments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [tab, setTab] = useState('overview');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [detailNonce, setDetailNonce] = useState(0);

  async function load(options = {}) {
    if (!options.silent) {
      setError('');
      setLoading(true);
    }
    try {
      const { response, body } = await api('/api/v1/payments');
      if (!response.ok) {
        setError(problemMessage(body, `Load failed: ${response.status}`));
        return;
      }
      const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
      setPayments(items);
      setSelected((current) => current || items[0] || null);
    } catch (cause) {
      setError(cause.message);
    } finally {
      if (!options.silent) setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((cause) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (!selected?.id) return undefined;
    let alive = true;
    api(`/api/v1/payments/${selected.id}`)
      .then(({ response, body }) => {
        if (!alive) return;
        if (!response.ok) {
          setError(problemMessage(body, `Load failed: ${response.status}`));
          return;
        }
        setSelected((current) => (current?.id === body?.id ? body : current));
      })
      .catch((cause) => {
        if (alive) setError(cause.message);
      });
    return () => {
      alive = false;
    };
  }, [selected?.id, detailNonce]);

  useEffect(() => {
    if (!showCreate) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) {
        setShowCreate(false);
        setError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showCreate, saving]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openCreate() {
    setForm(initialForm());
    setError('');
    setNotice('');
    setShowCreate(true);
  }

  function closeCreate() {
    if (saving) return;
    setShowCreate(false);
    setError('');
  }

  function selectPayment(payment) {
    if (payment.id !== selected?.id) setTab('overview');
    setSelected(payment);
    setError('');
    setNotice('');
    setDetailNonce((value) => value + 1);
  }

  async function refreshWorkspace() {
    setError('');
    setNotice('');
    await load();
    if (selected?.id) setDetailNonce((value) => value + 1);
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const payload = {
        paymentType: form.paymentType,
        amount: form.amount,
        currency: form.currency.trim().toUpperCase(),
        payeePartyId: form.payeePartyId.trim(),
        paymentDate: form.paymentDate
      };
      const { response, body } = await api('/api/v1/payments', { method: 'POST', body: payload });
      if (!response.ok) {
        setError(problemMessage(body, `Create failed: ${response.status}`));
        return;
      }
      setShowCreate(false);
      setForm(initialForm());
      setTab('overview');
      setNotice(`Created ${body?.paymentNumber || 'payment'}.`);
      await load({ silent: true });
      if (body?.id) {
        setSelected(body);
        setDetailNonce((value) => value + 1);
      }
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSaving(false);
    }
  }

  async function advance(payment, action) {
    if (!payment || !action || busyId) return;
    setError('');
    setNotice('');
    setBusyId(payment.id);
    try {
      const { response, body } = await api(`/api/v1/payments/${payment.id}/${action.path}`, {
        method: 'POST'
      });
      if (!response.ok) {
        setError(problemMessage(body, `Action failed: ${response.status}`));
        return;
      }
      setNotice(
        `${body?.paymentNumber || payment.paymentNumber} ${ACTION_NOTICE[action.path] || 'advanced'}; `
        + `status ${body?.status || '—'}.`
      );
      setSelected((current) => (current?.id === payment.id ? body : current));
      await load({ silent: true });
      setDetailNonce((value) => value + 1);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusyId(null);
    }
  }

  const action = selected ? NEXT_ACTION[selected.status] : null;
  const currentIndex = selected ? lifecycleIndex(selected.status) : -1;
  const detailRows = selected
    ? [
        ['Payment ID', selected.id],
        ['Tenant', selected.tenantId],
        ['Payment number', selected.paymentNumber],
        ['Payment type', selected.paymentType],
        ['Status', selected.status],
        ['Amount', selected.amount],
        ['Currency', selected.currency],
        ['Payee party', selected.payeePartyId],
        ['Payment date', selected.paymentDate],
        ['Version', selected.version],
        ['Created', selected.createdAt],
        ['Updated', selected.updatedAt]
      ]
    : [];

  return (
    <main>
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Operations · Payment</div>
          <h1>Payment</h1>
          <p className="subtitle">
            Payment authority, approval, and issuance. Execution stays blocked until the payment is
            approved; amounts use ISO 4217 currency and the SPEC 11.7.5 payment types.
          </p>
        </div>
        <div className="eia-actions">
          <button type="button" className="eia-btn-ghost" onClick={refreshWorkspace}>
            Refresh
          </button>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={showCreate}
            onClick={openCreate}
          >
            Create payment
          </button>
        </div>
      </header>

      {notice && <p role="status" style={{ margin: '0 0 12px' }}>{notice}</p>}
      {error && !showCreate && <p role="alert" style={{ margin: '0 0 12px' }}>{error}</p>}

      <div className="eia-record-layout">
        <aside className="eia-record-list" aria-label="Payment queue">
          <div className="eia-record-list-head">
            <strong>Payment queue</strong>
            <span className="eia-muted">{loading ? '…' : payments.length}</span>
          </div>
          {payments.map((payment) => {
            const isSelected = selected?.id === payment.id;
            return (
              <button
                key={payment.id}
                type="button"
                className={isSelected ? 'selected' : ''}
                aria-current={isSelected ? 'true' : undefined}
                aria-label={`Open record ${payment.paymentNumber}`}
                onClick={() => selectPayment(payment)}
              >
                <span className="record-primary">{payment.paymentNumber}</span>
                <span className="record-secondary">
                  {humanize(payment.paymentType)} · {formatMoney(payment.amount, payment.currency)}
                </span>
                <span className="record-secondary">
                  Payee {shortId(payment.payeePartyId)} · {payment.paymentDate || '—'}
                </span>
                <span>
                  <span className={`eia-pill ${statusTone(payment.status)}`}>{payment.status}</span>
                </span>
              </button>
            );
          })}
          {!loading && payments.length === 0 && (
            <div className="empty">No payments yet. Use Create payment to open the first record.</div>
          )}
          {loading && payments.length === 0 && <div className="empty">Loading payments…</div>}
        </aside>

        <section className="eia-record-panel" aria-label="Payment record">
          {selected ? (
            <>
              <div className="eia-record-title">
                <div>
                  <h2 className="eia-mono">{selected.paymentNumber}</h2>
                  <p className="eia-record-subtitle">
                    <span
                      className={`eia-pill ${statusTone(selected.status)}`}
                      data-testid="payment-status"
                    >
                      {selected.status}
                    </span>
                    {' · '}
                    <strong data-testid="record-amount" style={{ color: 'var(--eia-navy)' }}>
                      {formatMoney(selected.amount, selected.currency)}
                    </strong>
                    {' · '}
                    {humanize(selected.paymentType)}
                  </p>
                  <p className="eia-record-subtitle">
                    Payee <span className="eia-mono">{selected.payeePartyId || '—'}</span>
                    {' · '}
                    Payment date {selected.paymentDate || '—'}
                  </p>
                </div>
                <div className="eia-actions">
                  {action ? (
                    <button
                      type="button"
                      data-testid="payment-action"
                      onClick={() => advance(selected, action)}
                      disabled={busyId === selected.id}
                    >
                      {busyId === selected.id ? 'Working…' : action.label}
                    </button>
                  ) : (
                    <span className="eia-badge" data-testid="payment-action-none">
                      No action
                    </span>
                  )}
                </div>
              </div>

              <div className="eia-summary-grid">
                <div className="eia-card">
                  <h3>Amount</h3>
                  <div className="value" data-testid="summary-amount">
                    {formatMoney(selected.amount, selected.currency)}
                  </div>
                  <div className="eia-metric-label">{selected.currency || '—'} instructed amount</div>
                </div>
                <div className="eia-card">
                  <h3>Currency</h3>
                  <div className="value" data-testid="summary-currency">
                    {selected.currency || '—'}
                  </div>
                  <div className="eia-metric-label">ISO 4217 currency</div>
                </div>
                <div className="eia-card">
                  <h3>Payee</h3>
                  <div className="value" data-testid="summary-payee">
                    {shortId(selected.payeePartyId)}
                  </div>
                  <div className="eia-metric-label">party reference</div>
                </div>
                <div className="eia-card">
                  <h3>Payment date</h3>
                  <div className="value" data-testid="summary-date">
                    {selected.paymentDate || '—'}
                  </div>
                  <div className="eia-metric-label">requested value date</div>
                </div>
              </div>

              <nav className="eia-tabs" role="tablist" aria-label="Payment sections">
                {TABS.map((entry) => (
                  <button
                    key={entry.id}
                    id={`tab-${entry.id}`}
                    type="button"
                    role="tab"
                    className={`eia-tab${tab === entry.id ? ' active' : ''}`}
                    aria-selected={tab === entry.id}
                    aria-controls={`panel-${entry.id}`}
                    onClick={() => setTab(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </nav>

              {tab === 'overview' && (
                <section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
                  <div className="eia-grid eia-grid-2">
                    <section className="eia-card" aria-label="Payment details">
                      <h3>Payment details</h3>
                      <dl className="eia-kv" style={{ marginTop: 8 }}>
                        <dt>Payment number</dt>
                        <dd className="eia-mono">{selected.paymentNumber}</dd>
                        <dt>Type</dt>
                        <dd>{humanize(selected.paymentType)}</dd>
                        <dt>Status</dt>
                        <dd>{selected.status}</dd>
                        <dt>Amount</dt>
                        <dd>{formatMoney(selected.amount, selected.currency)}</dd>
                        <dt>Currency</dt>
                        <dd>{selected.currency || '—'}</dd>
                        <dt>Payee party</dt>
                        <dd className="eia-mono">{selected.payeePartyId || '—'}</dd>
                        <dt>Payment date</dt>
                        <dd>{selected.paymentDate || '—'}</dd>
                        <dt>Version</dt>
                        <dd>{selected.version ?? '—'}</dd>
                      </dl>
                    </section>

                    <section className="eia-card" aria-label="Approval readiness">
                      <h3>Approval readiness</h3>
                      <dl className="eia-kv" style={{ marginTop: 8 }}>
                        <dt>Current state</dt>
                        <dd>{selected.status}</dd>
                        <dt>Next action</dt>
                        <dd>{action ? action.label : '—'}</dd>
                        <dt>Execution</dt>
                        <dd>{executionLabel(selected.status)}</dd>
                        <dt>Created</dt>
                        <dd>{selected.createdAt || '—'}</dd>
                        <dt>Updated</dt>
                        <dd>{selected.updatedAt || '—'}</dd>
                      </dl>
                      <p className="eia-muted" style={{ marginBottom: 0 }}>
                        Execution stays blocked until the payment has passed approval; the primary
                        action in the record header advances the lifecycle.
                      </p>
                    </section>
                  </div>
                </section>
              )}

              {tab === 'approval' && (
                <section id="panel-approval" role="tabpanel" aria-labelledby="tab-approval">
                  <div className="eia-section-title">
                    <h2>Approval path</h2>
                    <span className="eia-muted">Current status {selected.status}</span>
                  </div>
                  <p className="eia-muted" style={{ marginTop: 0 }}>
                    The Payment API exposes submit, authorize, approve, and issue transitions. Issue
                    moves an approved payment to SCHEDULED and then SUBMITTED.
                  </p>
                  <div className="eia-table-wrap">
                    <table className="eia-table">
                      <thead>
                        <tr>
                          <th>Step</th>
                          <th>State</th>
                          <th>Transition</th>
                          <th>Progress</th>
                        </tr>
                      </thead>
                      <tbody>
                        {LIFECYCLE.map((step, index) => {
                          let progress = 'Pending';
                          if (currentIndex >= 0) {
                            if (index < currentIndex) progress = 'Passed';
                            else if (index === currentIndex) progress = 'Current';
                          }
                          const tone = progress === 'Passed' ? 'ok' : progress === 'Current' ? 'direct' : '';
                          return (
                            <tr key={step.status}>
                              <td>{index + 1}</td>
                              <td><code className="eia-mono">{step.status}</code></td>
                              <td>{step.transition}</td>
                              <td><span className={`eia-badge ${tone}`.trim()}>{progress}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {currentIndex < 0 && (
                    <p className="eia-muted">
                      Status {selected.status} is not on the forward approval path; no further
                      lifecycle action is exposed.
                    </p>
                  )}
                  <section className="eia-card" aria-label="Next approval action" style={{ marginTop: 16 }}>
                    <div className="eia-section-title" style={{ marginTop: 0 }}>
                      <h2>Next approval action</h2>
                      <span className="eia-muted">{action ? action.label : 'No action'}</span>
                    </div>
                    <p className="eia-muted" style={{ margin: 0 }}>
                      {action
                        ? `${action.label} uses POST /api/v1/payments/{id}/${action.path} and records the next lifecycle state.`
                        : `No lifecycle action is exposed for status ${selected.status}.`}
                    </p>
                  </section>
                </section>
              )}

              {tab === 'details' && (
                <section id="panel-details" role="tabpanel" aria-labelledby="tab-details">
                  <div className="eia-section-title">
                    <h2>Payment details</h2>
                    <span className="eia-muted">Fields returned by the Payment API</span>
                  </div>
                  <div className="eia-table-wrap">
                    <table className="eia-table">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailRows.map(([label, value]) => (
                          <tr key={label}>
                            <td>{label}</td>
                            <td>{value === null || value === undefined || value === '' ? '—' : value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="eia-muted">
                    Amounts are stored as numeric(19,4); currency is an ISO 4217 code and the payment
                    type follows SPEC 11.7.5.
                  </p>
                </section>
              )}
            </>
          ) : (
            <div className="eia-empty">
              <p style={{ marginTop: 0 }}>
                {loading
                  ? 'Loading the payment queue…'
                  : 'Select a payment from the queue or create a payment to start a record.'}
              </p>
              {!loading && (
                <button type="button" onClick={openCreate} aria-haspopup="dialog">
                  Create payment
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {showCreate && (
        <div
          style={OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) closeCreate();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-payment-title"
            className="eia-card"
            style={DIALOG_STYLE}
          >
            <div className="eia-record-title">
              <div>
                <h2 id="create-payment-title" style={{ margin: 0 }}>Create payment</h2>
                <p className="eia-record-subtitle">
                  Creates a DRAFT payment through POST /api/v1/payments. Amounts use ISO 4217
                  currency and the SPEC 11.7.5 payment types.
                </p>
              </div>
              <button type="button" className="eia-btn-ghost" onClick={closeCreate} disabled={saving}>
                Close
              </button>
            </div>

            <form className="eia-form-grid" onSubmit={submit} style={{ marginTop: 16 }}>
              <div className="eia-field span-2">
                <label htmlFor="create-payment-type">Payment type</label>
                <select
                  id="create-payment-type"
                  value={form.paymentType}
                  onChange={(event) => update('paymentType', event.target.value)}
                  autoFocus
                >
                  {PAYMENT_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              <div className="eia-field">
                <label htmlFor="create-amount">Amount</label>
                <input
                  id="create-amount"
                  type="number"
                  min="0.01"
                  step="0.0001"
                  value={form.amount}
                  onChange={(event) => update('amount', event.target.value)}
                  required
                />
              </div>
              <div className="eia-field">
                <label htmlFor="create-currency">Currency (ISO 4217)</label>
                <input
                  id="create-currency"
                  maxLength={3}
                  value={form.currency}
                  onChange={(event) => update('currency', event.target.value.toUpperCase())}
                  required
                />
              </div>
              <div className="eia-field span-2">
                <label htmlFor="create-payee">Payee party ID</label>
                <input
                  id="create-payee"
                  value={form.payeePartyId}
                  onChange={(event) => update('payeePartyId', event.target.value)}
                  required
                />
              </div>
              <div className="eia-field">
                <label htmlFor="create-payment-date">Payment date</label>
                <input
                  id="create-payment-date"
                  type="date"
                  value={form.paymentDate}
                  onChange={(event) => update('paymentDate', event.target.value)}
                  required
                />
              </div>
              <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="eia-btn-secondary" onClick={closeCreate} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" disabled={saving}>
                  {saving ? 'Creating…' : 'Create payment'}
                </button>
              </div>
            </form>

            {error && <p role="alert" style={{ margin: '8px 0 0' }}>{error}</p>}
          </section>
        </div>
      )}
    </main>
  );
}
