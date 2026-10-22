import React, { useEffect, useRef, useState } from 'react';
import './ui.css';
import './ui-overrides.css';
import AllocationsTab from './AllocationsTab.jsx';
import EntityPicker from './EntityPicker.jsx';
import PaymentLifecycle from './PaymentLifecycle.jsx';
import { api, problemMessage } from './api.js';
import { formatMoney, shortId } from './format.js';
import {
  EXECUTION_LIFECYCLE,
  actionRequiresReason,
  confirmationCopy,
  executionLabel,
  isOffPathStatus,
  isTerminalStatus,
  lifecycleIndex,
  nextLifecycleAction,
  reasonFieldCopy,
  reasonValidationError,
  secondaryLifecycleActions,
  statusChangeEndpoint,
  statusChangePayload,
  terminalStatusLabel
} from './lifecycle.js';
import { navigate, recordHref } from './navigation.js';
import { partyEndpoint, partyRecordLabel } from './party.js';
import {
  SOURCE_REFERENCE_MAX_LENGTH,
  SOURCE_TYPES,
  hasSource,
  normalizeSourceType,
  sourceHref,
  sourceLinkLabel,
  sourceTypeLabel
} from './source.js';
import {
  PAYMENT_LINKED_TYPE,
  documentHref,
  documentNumber,
  documentRecordId,
  documentStatus,
  documentTitle,
  documentType,
  linkedDocuments,
  linkedDocumentsEndpoint
} from './documents.js';
import {
  activityEvents,
  aggregateEventsEndpoint,
  eventStatus,
  eventStatusTone,
  eventTimestamp,
  eventTypeLabel,
  payloadFacts
} from './events.js';
import { statusReasonView } from './statusReason.js';

const PARTY_SEARCH_ENDPOINT = '/api/v1/parties/search';
const QUEUE_FILTER_PLACEHOLDER = 'Filter payments by number, type, payee, or status…';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAYMENT_TYPES = [
  'INDEMNITY', 'DEFENSE_COST', 'ALAE', 'EXPENSE', 'MEDICAL',
  'STRUCTURED_SETTLEMENT', 'ANNUITY', 'LIEN_PAYMENT', 'TRUST_DEPOSIT',
  'TRUST_DISTRIBUTION', 'SUBROGATION_RECOVERY', 'SALVAGE_RECOVERY',
  'ASSUMED_RECOVERY', 'DEDUCTIBLE_REIMBURSEMENT', 'PREMIUM', 'COMMISSION',
  'BROKERAGE', 'CASH_CALL', 'TECHNICAL_ACCOUNT_SETTLEMENT',
  'SECURITY_COLLATERAL', 'REFUND', 'OFFSET', 'INTERCOMPANY', 'TAX', 'FEE'
];

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'allocations', label: 'Allocations' },
  { id: 'approval', label: 'Approval Path' },
  { id: 'details', label: 'Payment Details' },
  { id: 'activity', label: 'Activity' }
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

function initialForm(prefill = {}) {
  return {
    paymentType: 'INDEMNITY',
    amount: prefill.amount || '125000.00',
    currency: prefill.currency || 'USD',
    payeePartyId: prefill.payeePartyId || '',
    paymentDate: today(),
    sourceType: prefill.sourceType || '',
    sourceId: prefill.sourceId || '',
    sourceReference: prefill.sourceReference || '',
    sourceFromUrl: Boolean(prefill.sourceFromUrl)
  };
}

function humanize(value) {
  if (!value) return '—';
  return String(value).replace(/_/g, ' ');
}

function statusTone(status) {
  if (['SUBMITTED', 'ACCEPTED', 'PROCESSING', 'PAID', 'RECONCILED'].includes(status)) {
    return 'green';
  }
  if (
    ['REJECTED', 'FAILED', 'CANCELLED', 'STOPPED', 'RETURNED', 'REVERSED', 'VOID', 'ESCHEATED']
      .includes(status)
  ) {
    return 'red';
  }
  if (['DRAFT', 'PENDING_AUTHORITY', 'PARTIALLY_PAID'].includes(status)) return 'amber';
  return 'blue';
}

/**
 * Success notice for a status write, calling out a terminal outcome or an
 * off-path exception so the operator knows which controls remain.
 */
function statusNotice(paymentNumber, status) {
  if (isTerminalStatus(status)) {
    return `${paymentNumber} is now ${status}.`
      + ` ${terminalStatusLabel(status)}; this terminal status is off the execution happy path.`;
  }
  if (isOffPathStatus(status)) {
    return `${paymentNumber} is now ${status}.`
      + ` Status ${status} is off the execution happy path;`
      + ' the post-payment controls stay available.';
  }
  return `${paymentNumber} is now ${status}.`;
}

/**
 * The remote is mounted at the shell route (/payment) or directly at the dev
 * server root (/). Only treat the URL as payment state on those routes, so a
 * cross-link to /party or /claim is never interpreted as a payment id.
 */
function onPaymentRoute() {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' || path === '/index.html' || path.endsWith('/payment');
}

/**
 * Reads the optional source-record hand-off from the URL. Unknown source types
 * are dropped rather than carried into a payload the Payment API would reject.
 */
function readSourcePrefill(params) {
  const sourceType = normalizeSourceType(params.get('sourceType'));
  const sourceId = (params.get('sourceId') || '').trim();
  const sourceReference = (params.get('sourceReference') || '').trim();
  if (!sourceType && !sourceId && !sourceReference) {
    return { sourceType: '', sourceId: '', sourceReference: '', sourceFromUrl: false };
  }
  return { sourceType, sourceId, sourceReference, sourceFromUrl: true };
}

function readCreatePrefill(params) {
  return {
    amount: (params.get('amount') || '').trim(),
    currency: (params.get('currency') || '').trim().toUpperCase(),
    payeePartyId: (params.get('payeePartyId') || '').trim(),
    ...readSourcePrefill(params)
  };
}

function readUrlState() {
  if (typeof window === 'undefined') return { record: '', create: false, prefill: {} };
  const params = new URLSearchParams(window.location.search);
  return {
    record: (params.get('record') || '').trim(),
    create: params.get('new') === '1',
    prefill: readCreatePrefill(params)
  };
}

/** Writes ?record/?new without dispatching popstate; state already matches. */
function writeUrl({ record = '', create = false } = {}) {
  if (typeof window === 'undefined' || !onPaymentRoute()) return;
  const params = new URLSearchParams();
  if (record) params.set('record', record);
  if (create) params.set('new', '1');
  const query = params.toString();
  const target = `${window.location.pathname}${query ? `?${query}` : ''}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (target === current) return;
  try {
    window.history.pushState({}, '', target);
  } catch {
    // URL state is an enhancement; record selection still works without it.
  }
}

function partyLabel(parties, partyId) {
  return partyId && parties[partyId] ? parties[partyId].label : '';
}

function partySecondary(parties, partyId) {
  return partyId && parties[partyId] ? parties[partyId].secondary : '';
}

function openLink(event) {
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href'));
}

function PartyLink({ partyId, label, testId, title }) {
  if (!partyId) return <span>—</span>;
  const href = recordHref('party', partyId);
  return (
    <a
      href={href}
      data-testid={testId}
      title={title || `Open party ${partyId}`}
      onClick={openLink}
    >
      {label || shortId(partyId)}
    </a>
  );
}

function paymentMatchesFilter(payment, needle, parties, details = {}) {
  const party = payment.payeePartyId ? parties[payment.payeePartyId] : null;
  return [
    payment.paymentNumber,
    payment.paymentType,
    humanize(payment.paymentType),
    payment.payeePartyId,
    details[payment.payeePartyId],
    party?.label,
    party?.secondary,
    payment.status,
    payment.sourceType,
    humanize(payment.sourceType),
    payment.sourceId,
    payment.sourceReference
  ].some((value) => String(value || '').toLowerCase().includes(needle));
}

/**
 * Mirrors the Payment API source-linkage rules so a hand-off fails fast in the
 * dialog: a classified source needs both a type and a UUID; OTHER may carry
 * only its human reference.
 */
function validateSourceFields(form) {
  const issues = [];
  const sourceType = normalizeSourceType(form.sourceType);
  const sourceId = form.sourceId.trim();
  const sourceReference = form.sourceReference.trim();
  if (!sourceType && sourceId) {
    issues.push('Select a source type before entering a source record id.');
  }
  if (sourceType && sourceType !== 'OTHER' && !sourceId) {
    issues.push(`Enter the source record id for the ${sourceTypeLabel(sourceType)} source.`);
  }
  if (sourceId && !UUID_PATTERN.test(sourceId)) {
    issues.push('Source record id must be a UUID.');
  }
  if (sourceReference.length > SOURCE_REFERENCE_MAX_LENGTH) {
    issues.push(`Source reference must be ${SOURCE_REFERENCE_MAX_LENGTH} characters or fewer.`);
  }
  return issues;
}

/** Adds the source pair to a create payload only when one was supplied. */
function sourcePayload(form) {
  const sourceType = normalizeSourceType(form.sourceType);
  const sourceId = form.sourceId.trim();
  const sourceReference = form.sourceReference.trim();
  if (!sourceType && !sourceId && !sourceReference) return null;
  const payload = {};
  if (sourceType) payload.sourceType = sourceType;
  if (sourceId) payload.sourceId = sourceId;
  if (sourceReference) payload.sourceReference = sourceReference;
  return payload;
}

export default function App() {
  const [payments, setPayments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [tab, setTab] = useState('overview');
  const [showCreate, setShowCreate] = useState(false);
  const [queueFilter, setQueueFilter] = useState('');
  const [payeeParties, setPayeeParties] = useState({});
  const [partyDetails, setPartyDetails] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [detailNonce, setDetailNonce] = useState(0);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionReason, setActionReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [conflict, setConflict] = useState('');
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState('');
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [activityNonce, setActivityNonce] = useState(0);

  const paymentsRef = useRef([]);
  const selectedRef = useRef(null);
  const showCreateRef = useRef(false);
  const applyingUrlRef = useRef(false);

  useEffect(() => {
    paymentsRef.current = payments;
  }, [payments]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    showCreateRef.current = showCreate;
  }, [showCreate]);

  async function load(options = {}) {
    if (!options.silent) {
      setError('');
      setLoading(true);
    }
    try {
      const { response, body } = await api('/api/v1/payments');
      if (!response.ok) {
        setError(problemMessage(body, `Load failed: ${response.status}`));
        return [];
      }
      const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
      setPayments(items);
      setSelected((current) => {
        const match = current ? items.find((payment) => payment.id === current.id) : null;
        if (match) return match;
        if (options.selectFirst === false) return current;
        return items[0] || null;
      });
      return items;
    } catch (cause) {
      setError(cause.message);
      return [];
    } finally {
      if (!options.silent) setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    const initial = readUrlState();
    load({ selectFirst: !initial.record && !initial.create })
      .then((items) => {
        if (!alive) return undefined;
        return applyUrlState(items, { initial: true });
      })
      .catch((cause) => {
        if (alive) setError(cause.message);
      });

    const onPopState = () => {
      applyUrlState(paymentsRef.current).catch((cause) => setError(cause.message));
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      alive = false;
      window.removeEventListener('popstate', onPopState);
    };
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

  const selectedPayeePartyId = selected?.payeePartyId || '';

  /**
   * Resolves the payee through the Party API once the payment record is
   * already rendered. A 404 or an unreachable Party service never blocks the
   * record: every cross-link falls back to the short UUID.
   */
  useEffect(() => {
    if (!selectedPayeePartyId) return undefined;
    let alive = true;
    api(partyEndpoint(selectedPayeePartyId))
      .then(({ response, body }) => {
        if (!alive || !response.ok || !body) return;
        const label = partyRecordLabel(body);
        if (!label) return;
        setPartyDetails((current) => (
          current[selectedPayeePartyId] === label
            ? current
            : { ...current, [selectedPayeePartyId]: label }
        ));
      })
      .catch(() => {
        // Party lookup is an enhancement; the payment still renders.
      });
    return () => {
      alive = false;
    };
  }, [selectedPayeePartyId]);

  /**
   * Linked documents for the selected payment. The request starts after the
   * payment record is already on screen and owns its own loading/error state:
   * a slow or unavailable Document service never blocks the record.
   */
  useEffect(() => {
    if (!selected?.id) {
      setDocuments([]);
      setDocumentsError('');
      setDocumentsLoading(false);
      return undefined;
    }
    let alive = true;
    setDocuments([]);
    setDocumentsError('');
    setDocumentsLoading(true);
    api(linkedDocumentsEndpoint(PAYMENT_LINKED_TYPE, selected.id))
      .then(({ response, body }) => {
        if (!alive) return;
        if (!response.ok) {
          setDocuments([]);
          setDocumentsError(problemMessage(body, `Documents request failed: ${response.status}`));
          setDocumentsLoading(false);
          return;
        }
        setDocuments(linkedDocuments(body));
        setDocumentsError('');
        setDocumentsLoading(false);
      })
      .catch((cause) => {
        if (!alive) return;
        setDocuments([]);
        setDocumentsError(cause.message);
        setDocumentsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected?.id, detailNonce]);

  /**
   * Activity for the selected payment. Events are fetched when the record is
   * selected and refetched after every lifecycle write or explicit refresh.
   * The request owns its loading/error state so an unavailable event stream
   * never blocks the payment record.
   */
  useEffect(() => {
    if (!selected?.id) {
      setActivity([]);
      setActivityError('');
      setActivityLoading(false);
      return undefined;
    }
    let alive = true;
    setActivity([]);
    setActivityError('');
    setActivityLoading(true);
    api(aggregateEventsEndpoint(selected.id))
      .then(({ response, body }) => {
        if (!alive) return;
        if (!response.ok) {
          setActivity([]);
          setActivityError(problemMessage(body, `Activity request failed: ${response.status}`));
          setActivityLoading(false);
          return;
        }
        setActivity(activityEvents(body));
        setActivityError('');
        setActivityLoading(false);
      })
      .catch((cause) => {
        if (!alive) return;
        setActivity([]);
        setActivityError(cause.message);
        setActivityLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected?.id, detailNonce, activityNonce]);

  const createPayeePartyId = showCreate ? form.payeePartyId : '';

  /**
   * A hand-off can prefill payeePartyId without a label. Resolve it through the
   * Party API so the picker shows the party record instead of a bare UUID; if
   * resolution fails the UUID remains usable.
   */
  useEffect(() => {
    if (!createPayeePartyId || partyLabel(payeeParties, createPayeePartyId)) return undefined;
    let alive = true;
    api(partyEndpoint(createPayeePartyId))
      .then(({ response, body }) => {
        if (!alive || !response.ok || !body) return;
        const label = partyRecordLabel(body);
        if (!label) return;
        setPayeeParties((current) => (
          current[createPayeePartyId]
            ? current
            : { ...current, [createPayeePartyId]: { label, secondary: '' } }
        ));
      })
      .catch(() => {
        // The picker keeps the raw UUID when the Party API cannot resolve it.
      });
    return () => {
      alive = false;
    };
  }, [createPayeePartyId, payeeParties]);

  useEffect(() => {
    if (!showCreate) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) {
        setShowCreate(false);
        setError('');
        writeUrl({ record: selectedRef.current?.id || '' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showCreate, saving]);

  useEffect(() => {
    if (!pendingAction) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busyId) {
        setPendingAction(null);
        setActionReason('');
        setActionError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingAction, busyId]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function clearSource() {
    setForm((current) => ({
      ...current,
      sourceType: '',
      sourceId: '',
      sourceReference: ''
    }));
  }

  function rememberParty(item) {
    if (!item?.id) return;
    setPayeeParties((current) => ({
      ...current,
      [item.id]: {
        label: item.label || item.id,
        secondary: item.secondary || ''
      }
    }));
  }

  function openCreate() {
    setForm(initialForm());
    setError('');
    setNotice('');
    setShowCreate(true);
    writeUrl({ create: true });
  }

  function closeCreate() {
    if (saving) return;
    setShowCreate(false);
    setError('');
    writeUrl({ record: selectedRef.current?.id || '' });
  }

  function selectPayment(payment, options = {}) {
    if (!payment) return;
    const currentId = selectedRef.current?.id;
    setSelected(payment);
    if (payment.id !== currentId) setTab('overview');
    setError('');
    setNotice('');
    setConflict('');
    setPendingAction(null);
    setActionReason('');
    setActionError('');
    if (payment.id !== currentId) setDetailNonce((value) => value + 1);
    if (!options.fromUrl) writeUrl({ record: payment.id });
  }

  /**
   * Applies ?record=, ?new=1, and the create hand-off prefill. A record already
   * in the queue is selected immediately; otherwise the detail endpoint is
   * queried and the payment is inserted at the top of the queue. Popstate
   * re-runs the same logic.
   */
  async function applyUrlState(rows, { initial = false } = {}) {
    if (!onPaymentRoute()) return;
    const { record, create, prefill } = readUrlState();

    if (create) {
      if (!showCreateRef.current) {
        setForm(initialForm(prefill));
        setError('');
      }
      setShowCreate(true);
      return;
    }

    if (!record) {
      if (!initial) {
        setShowCreate(false);
        setSelected(null);
        setTab('overview');
        setError('');
        setNotice('');
      }
      return;
    }

    setShowCreate(false);
    const queue = Array.isArray(rows) && rows.length > 0 ? rows : paymentsRef.current;
    const known = queue.find((payment) => payment.id === record || payment.paymentNumber === record);
    if (known) {
      selectPayment(known, { fromUrl: true });
      return;
    }

    if (!UUID_PATTERN.test(record)) {
      setError(`Payment “${record}” was not found in the payment queue.`);
      return;
    }
    if (applyingUrlRef.current) return;

    applyingUrlRef.current = true;
    try {
      const { response, body } = await api(`/api/v1/payments/${encodeURIComponent(record)}`);
      if (!response.ok) {
        setError(problemMessage(body, `Load failed: ${response.status}`));
        return;
      }
      if (body?.id) {
        setPayments((current) => (
          current.some((payment) => payment.id === body.id) ? current : [body, ...current]
        ));
        setSelected(body);
        setTab('overview');
        setError('');
        setNotice('');
      }
    } catch (cause) {
      setError(`Payment ${record} could not be loaded: ${cause.message}`);
    } finally {
      applyingUrlRef.current = false;
    }
  }

  async function refreshWorkspace() {
    setError('');
    setNotice('');
    setConflict('');
    await load();
    if (selected?.id) setDetailNonce((value) => value + 1);
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const sourceIssues = validateSourceFields(form);
    if (sourceIssues.length > 0) {
      setError(sourceIssues.join(' '));
      return;
    }
    if (!form.payeePartyId) {
      setError('Select a payee party before creating the payment.');
      return;
    }
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
      const source = sourcePayload(form);
      if (source) Object.assign(payload, source);
      const { response, body } = await api('/api/v1/payments', { method: 'POST', body: payload });
      if (!response.ok) {
        setError(problemMessage(body, `Create failed: ${response.status}`));
        return;
      }
      setShowCreate(false);
      setForm(initialForm());
      setTab('overview');
      setNotice(`Created ${body?.paymentNumber || 'payment'}.`);
      await load({ silent: true, selectFirst: false });
      if (body?.id) {
        setSelected(body);
        setDetailNonce((value) => value + 1);
        writeUrl({ record: body.id });
      } else {
        writeUrl({});
      }
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSaving(false);
    }
  }

  /** Replaces the selected payment and its queue row with an authoritative read. */
  function applyPaymentRead(payment) {
    if (!payment?.id) return;
    setPayments((current) => {
      let found = false;
      const next = current.map((entry) => {
        if (entry.id !== payment.id) return entry;
        found = true;
        return payment;
      });
      return found ? next : [payment, ...current];
    });
    setSelected((current) => (current?.id === payment.id ? payment : current));
  }

  /**
   * Reloads one payment by id and mirrors it into the queue. Used for the 409
   * path (and as a fallback when a status write returns no body); it never sets
   * the page-level error so the conflict can be contained in the lifecycle
   * action bar.
   */
  async function reloadPayment(paymentId) {
    try {
      const { response, body } = await api(`/api/v1/payments/${encodeURIComponent(paymentId)}`);
      if (!response.ok) {
        return {
          ok: false,
          error: problemMessage(body, `Reload failed: ${response.status}`)
        };
      }
      if (!body?.id) return { ok: false, error: 'the server returned no payment' };
      applyPaymentRead(body);
      return { ok: true, payment: body };
    } catch (cause) {
      return { ok: false, error: cause.message };
    }
  }

  /**
   * Sends one PATCH /api/v1/payments/{id}/status. A 409 means another request
   * changed the payment first: the conflict stays inside the lifecycle panel
   * and the authoritative record is reloaded so the next action uses the new
   * version instead of the stale one.
   */
  async function performAction(payment, action, reason, { fromDialog = false } = {}) {
    if (!payment || !action || busyId) return;
    const reasonError = reasonValidationError(action, reason);
    if (reasonError) {
      if (fromDialog) setActionError(reasonError);
      else setError(reasonError);
      return;
    }
    setBusyId(payment.id);
    setError('');
    setNotice('');
    setConflict('');
    if (fromDialog) setActionError('');

    try {
      const { response, body } = await api(statusChangeEndpoint(payment.id), {
        method: 'PATCH',
        body: statusChangePayload(payment, action, reason)
      });

      if (response.status === 409) {
        const message = problemMessage(
          body,
          `The payment changed since version ${payment.version}.`
        );
        const reload = await reloadPayment(payment.id);
        setPendingAction(null);
        setActionReason('');
        setActionError('');
        setConflict(
          reload.ok
            ? `${message} The latest payment was reloaded; review the current status before retrying.`
            : `${message} The latest payment could not be reloaded (${reload.error}). Reload the payment before retrying.`
        );
        setActivityNonce((value) => value + 1);
        return;
      }

      if (!response.ok) {
        const message = problemMessage(body, `Status change failed: ${response.status}`);
        if (fromDialog) setActionError(message);
        else setError(message);
        return;
      }

      const updated = body && typeof body === 'object' && body.id ? body : null;
      if (updated) {
        applyPaymentRead(updated);
        setNotice(statusNotice(
          updated.paymentNumber || payment.paymentNumber,
          updated.status || action.to
        ));
      } else {
        const reload = await reloadPayment(payment.id);
        if (reload.ok) {
          setNotice(statusNotice(
            payment.paymentNumber,
            reload.payment.status || action.to
          ));
        } else {
          setError(`The payment was updated but could not be reloaded (${reload.error}).`);
        }
      }
      setPendingAction(null);
      setActionReason('');
      setActionError('');
      // A lifecycle write appends activity; refresh the event timeline without
      // re-reading the payment (the PATCH response is already authoritative).
      setActivityNonce((value) => value + 1);
    } catch (cause) {
      if (fromDialog) setActionError(cause.message);
      else setError(cause.message);
    } finally {
      setBusyId(null);
    }
  }

  /** Opens the confirmation dialog for Mark paid/Reconcile, else acts at once. */
  function startAction(action) {
    if (!selected || !action || busyId) return;
    setError('');
    setNotice('');
    setConflict('');
    setActionError('');
    if (action.confirm) {
      setPendingAction(action);
      setActionReason('');
      return;
    }
    performAction(selected, action, '');
  }

  function closeActionDialog() {
    if (busyId) return;
    setPendingAction(null);
    setActionReason('');
    setActionError('');
  }

  function confirmAction(event) {
    event.preventDefault();
    if (!selected || !pendingAction || busyId) return;
    const reasonError = reasonValidationError(pendingAction, actionReason);
    if (reasonError) {
      setActionError(reasonError);
      return;
    }
    performAction(selected, pendingAction, actionReason, { fromDialog: true });
  }

  async function reloadFromConflict() {
    if (!selected?.id || busyId) return;
    setBusyId(selected.id);
    const reload = await reloadPayment(selected.id);
    setBusyId(null);
    if (reload.ok) {
      setConflict('');
      setNotice(`Reloaded ${selected.paymentNumber}; current status ${reload.payment.status}.`);
      setActivityNonce((value) => value + 1);
    } else {
      setConflict(`The payment could not be reloaded (${reload.error}). Try again.`);
    }
  }

  const action = selected ? nextLifecycleAction(selected.status) : null;
  const secondaryActions = selected ? secondaryLifecycleActions(selected.status) : [];
  const currentIndex = selected ? lifecycleIndex(selected.status) : -1;
  const selectedStatusReason = selected
    ? statusReasonView(selected, activity)
    : { reason: '', transition: null, context: '' };
  const confirmCopy = pendingAction ? confirmationCopy(pendingAction) : null;
  const pendingReasonRequired = pendingAction ? actionRequiresReason(pendingAction) : false;
  const pendingReasonCopy = pendingAction ? reasonFieldCopy(pendingAction) : null;
  const selectedPayeeLabel = partyLabel(payeeParties, selected?.payeePartyId);
  const selectedPayeeSecondary = partySecondary(payeeParties, selected?.payeePartyId);
  const selectedPayeeText = (selected?.payeePartyId && partyDetails[selected.payeePartyId])
    || selectedPayeeLabel
    || '';
  const selectedSourceHref = selected ? sourceHref(selected) : '';
  const selectedSourceReference = selected
    ? selected.sourceReference || shortId(selected.sourceId)
    : '';
  const formPayeeSecondary = partySecondary(payeeParties, form.payeePartyId);
  const formSourceType = normalizeSourceType(form.sourceType);
  const formSourceId = form.sourceId.trim();
  const formSourceReference = form.sourceReference.trim();
  const formHasSource = Boolean(formSourceType || formSourceId || formSourceReference);
  const formSourceHref = sourceHref({ sourceType: formSourceType, sourceId: formSourceId });
  const formSourceLabel = sourceTypeLabel(formSourceType)
    || (formHasSource ? 'Other source' : '');
  const normalizedQueueFilter = queueFilter.trim().toLowerCase();
  const filterActive = normalizedQueueFilter.length > 0;
  const visiblePayments = filterActive
    ? payments.filter((payment) => (
        paymentMatchesFilter(payment, normalizedQueueFilter, payeeParties, partyDetails)
      ))
    : payments;
  const detailRows = selected
    ? [
        ['Payment ID', selected.id],
        ['Tenant', selected.tenantId],
        ['Payment number', selected.paymentNumber],
        ['Payment type', selected.paymentType],
        ['Status', selected.status],
        ...(selectedStatusReason.reason ? [['Status reason', selectedStatusReason.reason]] : []),
        ['Amount', selected.amount],
        ['Currency', selected.currency],
        ['Payee party', selected.payeePartyId],
        ['Source type', selected.sourceType],
        ['Source reference', selected.sourceReference],
        ['Source id', selected.sourceId],
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
            Payment authority, approval, execution, and reconciliation. The payment owns its
            lifecycle from DRAFT to RECONCILED; claim and policy links are evidence only. Amounts
            use ISO 4217 currency and the SPEC 11.7.5 payment types.
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
        <div style={{ minWidth: 0 }}>
          <div className="eia-queue-search" role="search" aria-label="Filter the payment queue">
            <div className="eia-search-box">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3.4-3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={queueFilter}
                onChange={(event) => setQueueFilter(event.target.value)}
                placeholder={QUEUE_FILTER_PLACEHOLDER}
                aria-label="Filter payments by number, type, payee, or status"
                autoComplete="off"
                data-testid="payment-filter"
              />
              {filterActive && (
                <button
                  type="button"
                  className="eia-queue-clear"
                  onClick={() => setQueueFilter('')}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <aside className="eia-record-list" aria-label="Payment queue">
            <div className="eia-record-list-head">
              <strong>Payment queue</strong>
              <span className="eia-muted" data-testid="payment-queue-count">
                {loading
                  ? '…'
                  : filterActive
                    ? `${visiblePayments.length} of ${payments.length}`
                    : payments.length}
              </span>
            </div>
            {visiblePayments.map((payment) => {
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
                    Payee{' '}
                    {partyDetails[payment.payeePartyId]
                      || partyLabel(payeeParties, payment.payeePartyId)
                      || shortId(payment.payeePartyId)}
                    {' · '}
                    {payment.paymentDate || '—'}
                  </span>
                  {hasSource(payment) && (
                    <span
                      className="record-secondary"
                      data-testid={`queue-source-${payment.id}`}
                    >
                      Source {payment.sourceReference || shortId(payment.sourceId)}
                      {payment.sourceType ? ` · ${sourceTypeLabel(payment.sourceType)}` : ''}
                    </span>
                  )}
                  <span>
                    <span className={`eia-pill ${statusTone(payment.status)}`}>{payment.status}</span>
                  </span>
                </button>
              );
            })}
            {!loading && payments.length > 0 && visiblePayments.length === 0 && (
              <div className="empty">
                No payments match “{queueFilter.trim()}”. Clear the filter to see the full queue.
              </div>
            )}
            {!loading && payments.length === 0 && (
              <div className="empty">No payments yet. Use Create payment to open the first record.</div>
            )}
            {loading && payments.length === 0 && <div className="empty">Loading payments…</div>}
          </aside>
        </div>

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
                    Payee{' '}
                    {selected.payeePartyId ? (
                      <PartyLink
                        partyId={selected.payeePartyId}
                        label={selectedPayeeText}
                        testId="record-payee-link"
                      />
                    ) : '—'}
                    {' · '}
                    Payment date {selected.paymentDate || '—'}
                  </p>
                  {hasSource(selected) && (
                    <p className="eia-record-subtitle" data-testid="record-source">
                      Source{' '}
                      {selectedSourceHref ? (
                        <a
                          href={selectedSourceHref}
                          data-testid="record-source-link"
                          onClick={openLink}
                        >
                          {selectedSourceReference || '—'}
                        </a>
                      ) : (selectedSourceReference || '—')}
                      {selected.sourceType
                        ? ` · ${sourceTypeLabel(selected.sourceType)}`
                        : ''}
                    </p>
                  )}
                </div>
              </div>

              <PaymentLifecycle
                payment={selected}
                activity={activity}
                busy={busyId === selected.id}
                conflict={conflict}
                onAction={startAction}
                onReload={reloadFromConflict}
              />

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
                    {selected.payeePartyId ? (
                      <PartyLink
                        partyId={selected.payeePartyId}
                        label={selectedPayeeText}
                        testId="summary-payee-link"
                        title={selectedPayeeSecondary || `Open party ${selected.payeePartyId}`}
                      />
                    ) : '—'}
                  </div>
                  <div className="eia-metric-label">
                    {selectedPayeeText ? 'party record' : 'party reference'}
                  </div>
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
                        <dd>
                          {selected.payeePartyId ? (
                            <>
                              <PartyLink
                                partyId={selected.payeePartyId}
                                label={selectedPayeeText}
                                testId="details-payee-link"
                              />
                              {selectedPayeeSecondary ? (
                                <span className="eia-muted"> · {selectedPayeeSecondary}</span>
                              ) : null}
                            </>
                          ) : '—'}
                        </dd>
                        <dt>Source record</dt>
                        <dd data-testid="overview-source">
                          {hasSource(selected) ? (
                            <>
                              {selectedSourceHref ? (
                                <a
                                  href={selectedSourceHref}
                                  data-testid="overview-source-link"
                                  onClick={openLink}
                                >
                                  {selectedSourceReference || '—'}
                                </a>
                              ) : (selectedSourceReference || '—')}
                              {selected.sourceType ? (
                                <span className="eia-muted">
                                  {' '}· {sourceTypeLabel(selected.sourceType)}
                                </span>
                              ) : null}
                            </>
                          ) : '—'}
                        </dd>
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
                        <dd>
                          {action
                            ? action.label
                            : secondaryActions.length > 0
                              ? secondaryActions.map((entry) => entry.label).join(' / ')
                              : '—'}
                        </dd>
                        <dt>Execution</dt>
                        <dd>{executionLabel(selected.status)}</dd>
                        <dt>Created</dt>
                        <dd>{selected.createdAt || '—'}</dd>
                        <dt>Updated</dt>
                        <dd>{selected.updatedAt || '—'}</dd>
                      </dl>
                      <p className="eia-muted" style={{ marginBottom: 0 }}>
                        Execution stays blocked until the payment has passed approval. The payment
                        record owns every later execution step through reconciliation, and claim or
                        policy links are evidence only — they never advance the status.
                      </p>
                    </section>
                  </div>

                  <section
                    className="eia-context-panel"
                    aria-label="Why this matters"
                    data-testid="payment-context"
                  >
                    <h4>Why this matters</h4>
                    <p>
                      A payment is the disbursement leg of the claim or policy lifecycle: it records
                      the amount, currency, payee party, and value date that leave the insurer.
                      The payment itself owns its execution lifecycle — DRAFT through
                      PENDING_AUTHORITY, AUTHORIZED, APPROVED, SCHEDULED, SUBMITTED, ACCEPTED,
                      PROCESSING, PAID, and RECONCILED — including scheduling, sending to
                      SAP/bank, acceptance, processing, settlement, and reconciliation. Claim and
                      policy links are evidence of what is being paid and supply the reserve,
                      settlement, and coverage context upstream, but they never advance or control
                      the payment status. Approval gates execution; every later step writes one
                      status transition on this payment using its current version, and Mark paid
                      and Reconcile require explicit confirmation.
                    </p>
                    <div className="links">
                      {selected.payeePartyId && (
                        <a
                          href={recordHref('party', selected.payeePartyId)}
                          data-testid="context-payee-link"
                          onClick={openLink}
                        >
                          Payee party record · {selectedPayeeText || shortId(selected.payeePartyId)}
                        </a>
                      )}
                      {selectedSourceHref && (
                        <a
                          href={selectedSourceHref}
                          data-testid="context-source-link"
                          onClick={openLink}
                        >
                          Source {sourceTypeLabel(selected.sourceType) || 'record'} ·{' '}
                          {selectedSourceReference || '—'}
                        </a>
                      )}
                    </div>
                  </section>

                  <section
                    className="eia-card"
                    id="linked-documents"
                    aria-label="Documents"
                    data-testid="documents-card"
                    style={{ marginTop: 14 }}
                  >
                    <div className="eia-section-title" style={{ marginTop: 0 }}>
                      <h3>Documents</h3>
                      <span className="eia-muted" data-testid="documents-count">
                        {documentsLoading
                          ? '…'
                          : documentsError
                            ? '—'
                            : `${documents.length} document${documents.length === 1 ? '' : 's'}`}
                      </span>
                    </div>
                    <p className="eia-muted" style={{ marginTop: 4 }}>
                      Documents are evidence, not business facts: they record what was filed
                      against this payment, but they never change its amount, approval path, or
                      status.
                    </p>
                    {documentsLoading && (
                      <p className="eia-muted" data-testid="documents-loading">
                        Loading linked documents…
                      </p>
                    )}
                    {!documentsLoading && documentsError && (
                      <p className="eia-muted" data-testid="documents-error">
                        Linked documents could not be loaded ({documentsError}). The payment
                        record is unaffected.
                      </p>
                    )}
                    {!documentsLoading && !documentsError && documents.length === 0 && (
                      <p className="eia-muted" data-testid="documents-empty">
                        No documents are linked to this payment yet.
                      </p>
                    )}
                    {!documentsLoading && !documentsError && documents.length > 0 && (
                      <div className="eia-table-wrap" data-testid="documents-table">
                        <table className="eia-table" aria-label="Linked documents">
                          <thead>
                            <tr>
                              <th>Document</th>
                              <th>Title</th>
                              <th>Type</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {documents.map((row, index) => {
                              const href = documentHref(row);
                              const number = documentNumber(row) || shortId(documentRecordId(row));
                              return (
                                <tr key={documentRecordId(row) || `document-${index}`}>
                                  <td>
                                    {href ? (
                                      <a
                                        href={href}
                                        data-testid={`document-link-${index}`}
                                        onClick={openLink}
                                      >
                                        {number}
                                      </a>
                                    ) : number}
                                  </td>
                                  <td>{documentTitle(row) || '—'}</td>
                                  <td>{documentType(row) || '—'}</td>
                                  <td>{documentStatus(row) || '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </section>
              )}

              {tab === 'allocations' && (
                <section id="panel-allocations" role="tabpanel" aria-labelledby="tab-allocations">
                  <AllocationsTab
                    payment={selected}
                    onChanged={() => setDetailNonce((value) => value + 1)}
                  />
                </section>
              )}

              {tab === 'approval' && (
                <section id="panel-approval" role="tabpanel" aria-labelledby="tab-approval">
                  <div className="eia-section-title">
                    <h2>Approval path</h2>
                    <span className="eia-muted">Current status {selected.status}</span>
                  </div>
                  <p className="eia-muted" style={{ marginTop: 0 }}>
                    The Payment API owns the full execution path. Every step below is one
                    PATCH /api/v1/payments/{'{id}'}/status with a target status, the payment's
                    expectedVersion, and an optional reason. Mark paid, Reconcile, and every
                    secondary action require confirmation before the write; Return, Reverse,
                    Escheat, Void, and Stop also require a reason.
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
                        {EXECUTION_LIFECYCLE.map((step, index) => {
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
                      Status {selected.status} is {isTerminalStatus(selected.status)
                        ? 'terminal and off the forward execution path; the forward lifecycle is closed.'
                        : 'off the forward execution path; the post-payment controls can recover or close it.'}
                      {secondaryActions.length > 0
                        ? ` Available: ${secondaryActions.map((entry) => entry.label).join(' / ')}.`
                        : ' No further lifecycle action is exposed.'}
                    </p>
                  )}
                  <section
                    className="eia-card"
                    aria-label="Next lifecycle action"
                    data-testid="approval-next-action"
                    style={{ marginTop: 16 }}
                  >
                    <div className="eia-section-title" style={{ marginTop: 0 }}>
                      <h2>Next lifecycle action</h2>
                      <span className="eia-muted">
                        {action
                          ? action.label
                          : secondaryActions.length > 0
                            ? 'Secondary action available'
                            : 'No action'}
                      </span>
                    </div>
                    <p className="eia-muted" style={{ margin: 0 }}>
                      {action
                        ? `${action.label} sends PATCH /api/v1/payments/{id}/status with status `
                          + `${action.to} and expectedVersion ${selected.version}`
                          + `${action.confirm ? ', after confirmation' : ''}.`
                        : `No forward lifecycle action is exposed for status ${selected.status}.`}
                      {secondaryActions.length > 0
                        ? ` Secondary actions: ${secondaryActions.map((entry) => (
                          `${entry.label} → ${entry.to}${entry.reasonRequired ? ' (reason required)' : ' (reason optional)'}`
                        )).join('; ')}. Each is confirmed and sends one versioned PATCH.`
                        : ''}
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
                          <tr
                            key={label}
                            data-testid={label === 'Status reason'
                              ? 'detail-status-reason-row'
                              : undefined}
                          >
                            <td>{label}</td>
                            <td>
                              {label === 'Payee party' && value ? (
                                <PartyLink
                                  partyId={value}
                                  label={selectedPayeeText}
                                  testId="detail-row-payee-link"
                                />
                              ) : label === 'Status reason' ? (
                                <div>
                                  <span data-testid="detail-status-reason">{value}</span>
                                  {selectedStatusReason.context ? (
                                    <span
                                      className="eia-status-reason-context eia-muted"
                                      data-testid="detail-status-reason-context"
                                    >
                                      Latest transition {selectedStatusReason.context}
                                    </span>
                                  ) : null}
                                </div>
                              ) : (value === null || value === undefined || value === '' ? '—' : value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="eia-muted">
                    Amounts are stored as numeric(19,4); currency is an ISO 4217 code and the payment
                    type follows SPEC 11.7.5. The status reason is the optional reason recorded with
                    the latest status transition; a later transition without a reason clears it.
                  </p>
                </section>
              )}

              {tab === 'activity' && (
                <section id="panel-activity" role="tabpanel" aria-labelledby="tab-activity">
                  <div className="eia-section-title">
                    <h2>Activity</h2>
                    <button
                      type="button"
                      className="eia-btn-secondary"
                      data-testid="activity-refresh"
                      onClick={() => setActivityNonce((value) => value + 1)}
                      disabled={activityLoading}
                    >
                      {activityLoading ? 'Refreshing…' : 'Refresh activity'}
                    </button>
                  </div>
                  <p className="eia-muted" data-testid="activity-context" style={{ marginTop: 0 }}>
                    Activity is derived from the append-only payment event stream. Events are
                    immutable facts: a recorded event is never edited or deleted here. The payment
                    record is the source of truth for current state; event payloads show what was
                    true when the fact occurred. Newest events appear first.
                  </p>

                  <section
                    className="eia-card"
                    aria-label="Payment activity"
                    data-testid="activity-card"
                  >
                    <div className="eia-section-title" style={{ marginTop: 0 }}>
                      <h3>Event timeline</h3>
                      <span className="eia-muted" data-testid="activity-count">
                        {activityLoading
                          ? '…'
                          : activityError
                            ? '—'
                            : `${activity.length} event${activity.length === 1 ? '' : 's'}`}
                      </span>
                    </div>

                    {activityLoading && (
                      <p className="eia-muted" data-testid="activity-loading">
                        Loading payment activity…
                      </p>
                    )}
                    {!activityLoading && activityError && (
                      <p className="eia-muted" data-testid="activity-error">
                        Payment activity could not be loaded ({activityError}). The payment record
                        is unaffected.
                      </p>
                    )}
                    {!activityLoading && !activityError && activity.length === 0 && (
                      <p className="eia-muted" data-testid="activity-empty">
                        No events have been recorded for this payment yet.
                      </p>
                    )}
                    {!activityLoading && !activityError && activity.length > 0 && (
                      <ol
                        className="eia-timeline"
                        data-testid="activity-timeline"
                        aria-label="Payment activity timeline"
                      >
                        {activity.map((event, index) => {
                          const timestamp = eventTimestamp(event);
                          const facts = payloadFacts(event);
                          const status = eventStatus(event);
                          const meta = [
                            event.book ? `Book ${event.book}` : '',
                            event.aggregateVersion !== undefined
                              ? `Aggregate v${event.aggregateVersion}`
                              : '',
                            event.eventVersion !== undefined ? `Event v${event.eventVersion}` : '',
                            event.receivedAt ? `Received ${event.receivedAt}` : ''
                          ].filter(Boolean).join(' · ');
                          return (
                            <li
                              key={event.eventId || `${event.aggregateVersion}-${index}`}
                              className="eia-timeline-item"
                              data-testid={`activity-row-${index}`}
                              data-event-id={event.eventId || undefined}
                            >
                              <div className="eia-timeline-head">
                                <b data-testid={`activity-event-label-${index}`}>
                                  {eventTypeLabel(event.eventType)}
                                </b>
                                <code
                                  className="eia-mono"
                                  data-testid={`activity-event-type-${index}`}
                                >
                                  {event.eventType || '—'}
                                </code>
                                <span
                                  className={`eia-pill ${eventStatusTone(status)}`}
                                  data-testid={`activity-status-${index}`}
                                >
                                  {status || '—'}
                                </span>
                                <time
                                  className="eia-timeline-meta"
                                  dateTime={timestamp.iso || undefined}
                                  data-testid={`activity-time-${index}`}
                                >
                                  {timestamp.label}
                                </time>
                              </div>
                              {meta && (
                                <p className="eia-activity-meta" data-testid={`activity-meta-${index}`}>
                                  {meta}
                                </p>
                              )}
                              {facts.length > 0 ? (
                                <dl
                                  className="eia-activity-facts"
                                  data-testid={`activity-facts-${index}`}
                                >
                                  {facts.map((fact) => (
                                    <div className="eia-activity-fact" key={fact.key}>
                                      <dt>{fact.label}</dt>
                                      <dd data-testid={`activity-fact-${fact.key}-${index}`}>
                                        {fact.value}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                              ) : (
                                <p
                                  className="eia-activity-meta"
                                  data-testid={`activity-facts-empty-${index}`}
                                >
                                  No amount, currency, source, or status facts in this event
                                  payload.
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </section>
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

      {pendingAction && selected && confirmCopy && (
        <div
          style={OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busyId) closeActionDialog();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-action-title"
            className="eia-card"
            style={DIALOG_STYLE}
            data-testid="payment-action-dialog"
          >
            <div className="eia-record-title">
              <div>
                <h2 id="payment-action-title" style={{ margin: 0 }}>{confirmCopy.title}</h2>
                <p className="eia-record-subtitle">
                  {selected.paymentNumber} · {formatMoney(selected.amount, selected.currency)}
                  {' · '}
                  {selected.status} → {pendingAction.to}
                </p>
              </div>
              <button
                type="button"
                className="eia-btn-ghost"
                onClick={closeActionDialog}
                disabled={busyId === selected.id}
              >
                Close
              </button>
            </div>

            <p className="eia-muted" data-testid="lifecycle-confirm-description">
              {confirmCopy.description}
            </p>

            <dl className="eia-kv">
              <dt>Status change</dt>
              <dd>{selected.status} → {pendingAction.to}</dd>
              <dt>Expected version</dt>
              <dd data-testid="lifecycle-expected-version">{selected.version ?? '—'}</dd>
              <dt>Reason</dt>
              <dd data-testid="lifecycle-reason-requirement">
                {pendingReasonRequired ? 'Required' : 'Optional'}
              </dd>
            </dl>

            <form
              onSubmit={confirmAction}
              style={{ marginTop: 16 }}
              data-testid="lifecycle-confirm-form"
              noValidate
            >
              <div className="eia-field">
                <label htmlFor="lifecycle-reason">{pendingReasonCopy.label}</label>
                <textarea
                  id="lifecycle-reason"
                  data-testid="lifecycle-reason"
                  value={actionReason}
                  onChange={(event) => {
                    setActionReason(event.target.value);
                    if (actionError) setActionError('');
                  }}
                  placeholder={pendingReasonCopy.placeholder}
                  rows={3}
                  maxLength={200}
                  required={pendingReasonRequired}
                  aria-required={pendingReasonRequired}
                  aria-describedby="lifecycle-reason-hint"
                  disabled={busyId === selected.id}
                  autoFocus
                />
                <span
                  className="eia-muted"
                  id="lifecycle-reason-hint"
                  data-testid="lifecycle-reason-hint"
                >
                  {pendingReasonCopy.hint}
                </span>
              </div>

              {actionError && (
                <p role="alert" data-testid="lifecycle-action-error" style={{ margin: '10px 0 0' }}>
                  {actionError}
                </p>
              )}

              <div className="eia-actions" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeActionDialog}
                  disabled={busyId === selected.id}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="lifecycle-confirm-submit"
                  disabled={busyId === selected.id}
                >
                  {busyId === selected.id
                    ? 'Working…'
                    : `Confirm ${pendingAction.label}`}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

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

            <form onSubmit={submit} style={{ marginTop: 16 }} data-testid="create-payment-form">
              {form.sourceFromUrl && formHasSource && (
                <section
                  className="eia-source-card"
                  aria-label="Source record"
                  data-testid="create-source-card"
                >
                  <div className="eia-source-card-head">
                    <h3>Source record</h3>
                    <button
                      type="button"
                      className="eia-btn-ghost"
                      onClick={clearSource}
                      disabled={saving}
                      data-testid="clear-source"
                    >
                      Clear source
                    </button>
                  </div>
                  <dl className="eia-kv" style={{ marginTop: 8 }}>
                    <dt>Type</dt>
                    <dd data-testid="create-source-type">
                      {formSourceLabel || '—'}
                      {formSourceType ? (
                        <span className="eia-muted"> ({formSourceType})</span>
                      ) : null}
                    </dd>
                    <dt>Reference</dt>
                    <dd data-testid="create-source-reference">
                      {formSourceReference || '—'}
                    </dd>
                    <dt>Record</dt>
                    <dd>
                      {formSourceHref ? (
                        <a
                          href={formSourceHref}
                          data-testid="create-source-link"
                          onClick={openLink}
                        >
                          {sourceLinkLabel({ sourceType: formSourceType })}
                        </a>
                      ) : (
                        <span className="eia-muted">
                          No linked record for this source type.
                        </span>
                      )}
                    </dd>
                  </dl>
                  <p className="eia-muted" style={{ margin: '8px 0 0' }}>
                    The source record controls what is being paid; this payment is only the
                    disbursement leg. Clearing the source removes the hand-off from the create
                    request.
                  </p>
                </section>
              )}

              {!form.sourceFromUrl && (
                <section
                  className="eia-source-card"
                  aria-label="Optional source record"
                  data-testid="manual-source"
                >
                  <div className="eia-source-card-head">
                    <h3>Source record (optional)</h3>
                    {formHasSource && (
                      <button
                        type="button"
                        className="eia-btn-ghost"
                        onClick={clearSource}
                        disabled={saving}
                        data-testid="clear-manual-source"
                      >
                        Clear source
                      </button>
                    )}
                  </div>
                  <p className="eia-muted" style={{ margin: '0 0 8px' }}>
                    Link this payment to the claim, policy, or other obligation it disburses. A
                    classified source needs both a type and a record id; OTHER may carry just a
                    human reference.
                  </p>
                  <div className="eia-form-grid">
                    <div className="eia-field">
                      <label htmlFor="create-source-type">Source type</label>
                      <select
                        id="create-source-type"
                        value={form.sourceType}
                        onChange={(event) => update('sourceType', event.target.value)}
                        disabled={saving}
                      >
                        <option value="">No source</option>
                        {SOURCE_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {sourceTypeLabel(type)} ({type})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="eia-field span-2">
                      <label htmlFor="create-source-id">Source record id</label>
                      <input
                        id="create-source-id"
                        value={form.sourceId}
                        onChange={(event) => update('sourceId', event.target.value)}
                        placeholder="UUID of the claim or policy record"
                        autoComplete="off"
                        disabled={saving}
                      />
                    </div>
                    <div className="eia-field span-3">
                      <label htmlFor="create-source-reference">Source reference</label>
                      <input
                        id="create-source-reference"
                        maxLength={SOURCE_REFERENCE_MAX_LENGTH}
                        value={form.sourceReference}
                        onChange={(event) => update('sourceReference', event.target.value)}
                        placeholder="CLM-2026-0000001 or POL-2026-0000001"
                        autoComplete="off"
                        disabled={saving}
                      />
                    </div>
                  </div>
                </section>
              )}

              {formHasSource && (
                <>
                  <input
                    type="hidden"
                    name="sourceType"
                    value={formSourceType}
                    data-testid="source-type-hidden"
                  />
                  <input
                    type="hidden"
                    name="sourceId"
                    value={formSourceId}
                    data-testid="source-id-hidden"
                  />
                  <input
                    type="hidden"
                    name="sourceReference"
                    value={formSourceReference}
                    data-testid="source-reference-hidden"
                  />
                </>
              )}

              <div className="eia-form-grid">
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
                  <label>Payee party</label>
                  <EntityPicker
                    endpoint={PARTY_SEARCH_ENDPOINT}
                    value={form.payeePartyId}
                    valueLabel={partyLabel(payeeParties, form.payeePartyId)}
                    onChange={(id, item) => {
                      update('payeePartyId', id || '');
                      if (item) rememberParty(item);
                    }}
                    placeholder="Search party number or name…"
                    disabled={saving}
                  />
                  {form.payeePartyId && (
                    <span className="eia-picker-hint">
                      {formPayeeSecondary || 'Party selected'} ·{' '}
                      <a
                        href={recordHref('party', form.payeePartyId)}
                        data-testid="payee-picker-link"
                        onClick={openLink}
                      >
                        Open party record
                      </a>
                    </span>
                  )}
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
              </div>
            </form>

            {error && <p role="alert" style={{ margin: '8px 0 0' }}>{error}</p>}
          </section>
        </div>
      )}
    </main>
  );
}
