/**
 * Payment status reason helpers.
 *
 * The Payment API stores the optional reason supplied with a lifecycle PATCH in
 * `payment.status_reason` and returns it as the nullable top-level
 * `statusReason` (varchar(200)). The reason belongs to the latest accepted
 * status transition: a later transition without a reason clears it.
 *
 * The Payment projection does not return the `from`/`to`/`occurredAt` of that
 * transition, so the latest `payment.payment.status-changed` event from the
 * aggregate activity feed supplies the transition context. The payment record
 * remains authoritative for the reason itself; the activity event is only a
 * fallback for an older projection that omits `statusReason` entirely.
 */
import { activityEvents, eventPayload, eventTimestamp } from './events.js';

export const STATUS_REASON_MAX_LENGTH = 200;
export const STATUS_CHANGED_EVENT_TYPE = 'payment.payment.status-changed';

/**
 * Normalizes a display reason: trims, collapses internal whitespace (including
 * the newlines a pasted audit note may contain), strips control characters,
 * and caps the text at the API's 200-character limit. A null, blank, or
 * non-text value normalizes to '' so callers can treat it as absent.
 */
export function normalizeStatusReason(value) {
  if (value === null || value === undefined) return '';
  let raw = value;
  if (typeof raw === 'object') {
    raw = raw.reason ?? raw.text ?? raw.value ?? raw.statusReason ?? raw.status_reason ?? '';
  }
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, STATUS_REASON_MAX_LENGTH)
    .trim();
}

/**
 * True when the projection carries a statusReason field at all. The field is
 * nullable, so `statusReason: null` deliberately means "no current reason" and
 * must not fall back to an older event's reason.
 */
export function hasStatusReasonField(payment) {
  if (!payment || typeof payment !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(payment, 'statusReason')
    || Object.prototype.hasOwnProperty.call(payment, 'status_reason');
}

/** The payment's current status reason; '' when absent or blank. */
export function paymentStatusReason(payment) {
  if (!payment || typeof payment !== 'object') return '';
  return normalizeStatusReason(payment.statusReason ?? payment.status_reason);
}

/** The event payload `data` object; tolerate an enveloped payload. */
function eventData(event) {
  const payload = eventPayload(event);
  if (
    payload
    && typeof payload === 'object'
    && payload.data
    && typeof payload.data === 'object'
    && !Array.isArray(payload.data)
  ) {
    return payload.data;
  }
  return payload;
}

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function finiteVersion(value) {
  if (value === null || value === undefined || value === '') return null;
  const version = Number(value);
  return Number.isFinite(version) ? version : null;
}

/**
 * One `payment.payment.status-changed` event as transition context, or null
 * when the event is another type or carries no target status.
 */
export function statusTransitionFromEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const eventType = String(event.eventType || '').trim();
  if (eventType && eventType !== STATUS_CHANGED_EVENT_TYPE) return null;

  const payload = eventData(event);
  if (!payload || typeof payload !== 'object') return null;
  const from = normalizeStatus(payload.from);
  const to = normalizeStatus(payload.to || payload.status);
  if (!to) return null;

  const timestamp = eventTimestamp(event);
  return {
    eventId: String(event.eventId || ''),
    from,
    to,
    reason: normalizeStatusReason(payload.reason),
    version: finiteVersion(payload.version),
    occurredAt: timestamp.iso,
    occurredAtLabel: timestamp.label
  };
}

/**
 * The newest status-changed event that reached `currentStatus`, or null when
 * the feed has no matching transition (for example while it is still loading).
 * `activityEvents` returns newest-first, so the first match is the latest one.
 * When `paymentId` is supplied, events carrying a different aggregate id are
 * ignored so a stale feed from the previously selected payment cannot supply
 * the context. When `currentVersion` is supplied, a transition carrying a
 * different row version is treated as stale and skipped, which keeps a repeated
 * status (for example a second RETURNED) from borrowing an older transition.
 */
export function latestStatusTransition(
  events,
  currentStatus,
  paymentId = '',
  currentVersion = null
) {
  const status = normalizeStatus(currentStatus);
  const aggregateId = String(paymentId || '').trim().toLowerCase();
  const version = finiteVersion(currentVersion);
  const transitions = activityEvents(events)
    .filter((event) => (
      !aggregateId
      || !event.aggregateId
      || String(event.aggregateId).trim().toLowerCase() === aggregateId
    ))
    .map(statusTransitionFromEvent)
    .filter(Boolean);
  const matchingStatus = status
    ? transitions.filter((transition) => transition.to === status)
    : transitions;
  if (version === null) return matchingStatus[0] || null;
  return matchingStatus.find((transition) => transition.version === version)
    || matchingStatus.find((transition) => transition.version === null)
    || null;
}

/**
 * The current status reason: the payment projection when it carries the field,
 * otherwise the latest transition event's reason for an older projection.
 */
export function resolveStatusReason(payment, transition) {
  if (hasStatusReasonField(payment)) return paymentStatusReason(payment);
  return normalizeStatusReason(transition && transition.reason);
}

/**
 * Human context for the reason: the transition that produced the current
 * status, or the payment's status/version/updated timestamp when the activity
 * feed cannot supply it. Never includes a label; callers own the wording.
 */
export function statusReasonContext(payment, transition) {
  if (transition) {
    const parts = [];
    if (transition.from && transition.to) parts.push(`${transition.from} → ${transition.to}`);
    else if (transition.to) parts.push(transition.to);
    if (transition.occurredAtLabel && transition.occurredAtLabel !== '—') {
      parts.push(transition.occurredAtLabel);
    }
    if (transition.version !== null && transition.version !== undefined) {
      parts.push(`version ${transition.version}`);
    }
    return parts.join(' · ');
  }

  if (!payment || typeof payment !== 'object') return '';
  const parts = [];
  if (payment.status) parts.push(`Current status ${payment.status}`);
  if (payment.version !== null && payment.version !== undefined) {
    parts.push(`version ${payment.version}`);
  }
  if (payment.updatedAt) {
    const updated = eventTimestamp({ occurredAt: payment.updatedAt });
    if (updated.label !== '—') parts.push(`updated ${updated.label}`);
  }
  return parts.join(' · ');
}

/** Everything the views need for the current payment status reason. */
export function statusReasonView(payment, activity = []) {
  if (!payment) return { reason: '', transition: null, context: '' };
  const transition = latestStatusTransition(activity, payment.status, payment.id, payment.version);
  const reason = resolveStatusReason(payment, transition);
  return {
    reason,
    transition,
    context: reason ? statusReasonContext(payment, transition) : ''
  };
}
