/**
 * Payment activity-event helpers.
 *
 * The event-ingest service exposes the append-only event stream for one
 * aggregate. An event is a fact that *already happened*: the payment record
 * remains the source of truth for its current state, and nothing in this
 * timeline can change the amount, approval path, or status.
 *
 * `GET /api/v1/events/aggregate/{paymentId}?limit=50` returns
 * `{ items: [EventView] }`; `payload` is the event's `data` object. The list is
 * normalized and sorted here so a page is rendered newest first regardless of
 * the order the service returns.
 */
import { sourceTypeLabel } from './source.js';

export const ACTIVITY_LIMIT = 50;

/** Builds GET /api/v1/events/aggregate/{paymentId}?limit=… for one record. */
export function aggregateEventsEndpoint(paymentId, limit = ACTIVITY_LIMIT) {
  const id = String(paymentId || '').trim();
  if (!id) return '';
  return `/api/v1/events/aggregate/${encodeURIComponent(id)}?limit=${encodeURIComponent(limit)}`;
}

/**
 * Accepts the `{ items }` page (or a bare array) and returns newest-first,
 * non-null events. Ties fall back to aggregate version and event id so the
 * rendering order is deterministic even when two events share a timestamp.
 */
export function activityEvents(payload) {
  const items = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.items)
      ? payload.items
      : [];
  return items
    .filter((item) => item && typeof item === 'object')
    .slice()
    .sort(compareActivityEvents);
}

function eventTime(event) {
  const occurred = Date.parse(event && event.occurredAt);
  if (Number.isFinite(occurred)) return occurred;
  const received = Date.parse(event && event.receivedAt);
  return Number.isFinite(received) ? received : 0;
}

function numericVersion(value) {
  const version = Number(value);
  return Number.isFinite(version) ? version : -1;
}

/** Newest first; then highest aggregate version; then event id. */
export function compareActivityEvents(left, right) {
  const byTime = eventTime(right) - eventTime(left);
  if (byTime !== 0) return byTime;

  const byVersion = numericVersion(right && right.aggregateVersion)
    - numericVersion(left && left.aggregateVersion);
  if (byVersion !== 0) return byVersion;

  return String((left && left.eventId) || '').localeCompare(String((right && right.eventId) || ''));
}

function words(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function capitalize(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
}

/**
 * `payment.payment.created` -> “Payment created”;
 * `payment.payment.status-changed` -> “Payment status changed”.
 */
export function eventTypeLabel(eventType) {
  const raw = String(eventType || '').trim();
  if (!raw) return 'Payment event';
  const parts = raw.split('.').filter(Boolean);
  const verb = words(parts[parts.length - 1] || raw);
  const noun = parts.length >= 2 ? words(parts[parts.length - 2]) : '';
  return capitalize(noun ? `${noun} ${verb}` : verb) || 'Payment event';
}

export function eventStatus(event) {
  return String((event && event.status) || '').trim().toUpperCase();
}

/** Event delivery/processing status, distinct from the payment status fact. */
export function eventStatusTone(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (['PROCESSED', 'CONFIRMED', 'DELIVERED'].includes(normalized)) return 'green';
  if (['FAILED', 'DEAD_LETTERED', 'ERROR'].includes(normalized)) return 'red';
  if (['RECEIVED', 'PENDING', 'RETRYING'].includes(normalized)) return 'amber';
  return 'blue';
}

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC'
});

/** Occurred-at timestamp rendered in UTC with an accessible ISO value. */
export function eventTimestamp(event) {
  const raw = String((event && event.occurredAt) || '').trim();
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) return { iso: '', label: '—' };
  return { iso: date.toISOString(), label: `${TIMESTAMP_FORMAT.format(date)} UTC` };
}

/** The event `payload` is the envelope `data` object; tolerate a JSON string. */
export function eventPayload(event) {
  const payload = event && event.payload;
  if (!payload) return {};
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof payload === 'object' ? payload : {};
}

function readField(payload, ...names) {
  for (const name of names) {
    const value = payload[name];
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return null;
}

/** Matches the Payment workbench money rendering for payload amounts. */
export function formatEventAmount(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return '';
  const value = Number(amount);
  if (!Number.isFinite(value) || !currency) return String(amount);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * The business facts carried by this event's payload: amount, currency,
 * source type/reference, and status. Absent facts are omitted rather than
 * rendered as blanks, because not every event type carries every fact.
 */
export function payloadFacts(event) {
  const payload = eventPayload(event);
  const facts = [];

  const currency = readField(payload, 'currency');
  const amount = readField(payload, 'amount');
  if (amount !== null) {
    facts.push({
      key: 'amount',
      label: 'Amount',
      value: currency ? formatEventAmount(amount, currency) : String(amount)
    });
  }
  if (currency !== null) {
    facts.push({ key: 'currency', label: 'Currency', value: String(currency) });
  }

  const sourceType = readField(payload, 'sourceType');
  if (sourceType !== null) {
    facts.push({
      key: 'source-type',
      label: 'Source type',
      value: sourceTypeLabel(String(sourceType)) || String(sourceType)
    });
  }
  const sourceReference = readField(payload, 'sourceReference');
  if (sourceReference !== null) {
    facts.push({ key: 'source-reference', label: 'Source reference', value: String(sourceReference) });
  }

  const from = readField(payload, 'from');
  const to = readField(payload, 'to');
  const status = readField(payload, 'status');
  if (from !== null && to !== null) {
    facts.push({ key: 'status', label: 'Status', value: `${from} → ${to}` });
  } else if (status !== null) {
    facts.push({ key: 'status', label: 'Status', value: String(status) });
  }

  return facts;
}
