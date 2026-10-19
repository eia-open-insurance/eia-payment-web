import React, { useEffect, useState } from 'react';

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

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function readError(response) {
  let detail = `HTTP ${response.status}`;
  try {
    const body = await response.json();
    if (body && body.code) {
      detail = `${body.code}: ${body.message || 'request rejected'}`;
    }
  } catch (ignored) {
    // Keep the status-only message when the body is not JSON.
  }
  return detail;
}

export default function App() {
  const [payments, setPayments] = useState([]);
  const [form, setForm] = useState({
    paymentType: 'INDEMNITY',
    amount: '125000.00',
    currency: 'USD',
    payeePartyId: DEMO_PAYEE,
    paymentDate: today()
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch('/api/v1/payments', {
      headers: { 'X-EIA-Tenant': TENANT }
    });
    if (!response.ok) throw new Error(await readError(response));
    setPayments(await response.json());
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EIA-Tenant': TENANT },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error(await readError(response));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function advance(payment, action) {
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/payments/${payment.id}/${action.path}`, {
        method: 'POST',
        headers: { 'X-EIA-Tenant': TENANT }
      });
      if (!response.ok) throw new Error(await readError(response));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1>Payment</h1>
      <p>
        Payment authority, approval, and issuance. Execution stays blocked until the payment is
        approved; amounts use ISO 4217 currency and the SPEC 11.7.5 payment types.
      </p>
      {error && <p role="alert" style={{ color: '#b00020' }}>{error}</p>}

      <form onSubmit={submit} style={{ display: 'grid', gap: 8, marginBottom: 24, maxWidth: 520 }}>
        <label>
          Payment type
          <select
            value={form.paymentType}
            onChange={(e) => setForm({ ...form, paymentType: e.target.value })}
          >
            {PAYMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>
          Amount
          <input
            type="number"
            min="0.01"
            step="0.0001"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
        </label>
        <label>
          Currency (ISO 4217)
          <input
            maxLength={3}
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
            required
          />
        </label>
        <label>
          Payee party id
          <input
            value={form.payeePartyId}
            onChange={(e) => setForm({ ...form, payeePartyId: e.target.value })}
            required
          />
        </label>
        <label>
          Payment date
          <input
            type="date"
            value={form.paymentDate}
            onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
            required
          />
        </label>
        <button type="submit" disabled={busy}>Create payment</button>
      </form>

      <table width="100%" cellPadding="8" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">Number</th>
            <th align="left">Type</th>
            <th align="left">Amount</th>
            <th align="left">Payee</th>
            <th align="left">Date</th>
            <th align="left">Status</th>
            <th align="left">Action</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => {
            const action = NEXT_ACTION[payment.status];
            return (
              <tr key={payment.id} style={{ borderTop: '1px solid #ddd' }}>
                <td>{payment.paymentNumber}</td>
                <td>{payment.paymentType}</td>
                <td>{payment.currency} {payment.amount}</td>
                <td>{payment.payeePartyId}</td>
                <td>{payment.paymentDate}</td>
                <td>{payment.status}</td>
                <td>
                  {action
                    ? <button type="button" disabled={busy} onClick={() => advance(payment, action)}>{action.label}</button>
                    : '—'}
                </td>
              </tr>
            );
          })}
          {payments.length === 0 && (
            <tr><td colSpan="7">No payments yet.</td></tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
