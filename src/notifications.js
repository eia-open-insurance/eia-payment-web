/**
 * Related-notification helpers.
 *
 * A notification is a delivery artifact owned by the Notifications vertical.
 * The payment record reads the notifications whose `sourceType`/`sourceId`
 * point at the selected payment and shows them as read-only context: the card
 * never creates, sends, or acknowledges a notification, and a failed lookup
 * never blocks the payment record itself.
 *
 * `GET /api/v1/notifications?sourceType=PAYMENT&sourceId=<paymentId>` returns a
 * bare JSON array ordered by `createdAt` newest first, with `id` as the
 * tie-break. The rows are filtered to the exact source id and sorted here so
 * the three-row preview is newest first even if the service order changes.
 */
import { shortId } from './format.js';

/** The source linkage Notifications stores for a message sent from this payment. */
export const NOTIFICATION_SOURCE_TYPE = 'PAYMENT';

/** The Overview shows the newest few; the count covers every linked item. */
export const RELATED_NOTIFICATION_LIMIT = 3;

/** Builds the source-scoped notification list request for one payment. */
export function paymentNotificationsEndpoint(paymentId) {
  const id = String(paymentId || '').trim();
  if (!id) return '';
  return `/api/v1/notifications?sourceType=${NOTIFICATION_SOURCE_TYPE}`
    + `&sourceId=${encodeURIComponent(id)}`;
}

/** Shell route that opens the Notifications workbench on one record. */
export function notificationRecordHref(notificationId) {
  const id = String(notificationId || '').trim();
  return id ? `/notifications?record=${encodeURIComponent(id)}` : '';
}

/**
 * View all opens the Notifications queue with the same source pair, so the
 * operator sees this payment's messages instead of an unfiltered queue.
 */
export function notificationsViewAllHref(paymentId) {
  const id = String(paymentId || '').trim();
  if (!id) return '/notifications';
  return `/notifications?sourceType=${NOTIFICATION_SOURCE_TYPE}`
    + `&sourceId=${encodeURIComponent(id)}`;
}

/** Accepts either a bare array or the `{ items }` page envelope. */
export function notificationItems(body) {
  if (Array.isArray(body)) return body;
  return body && Array.isArray(body.items) ? body.items : [];
}

/**
 * The query is already source-scoped, but Notifications is a shared service and
 * the payment record must never present another record's messages. An explicit
 * `sourceId` match is required: a row that omits the linkage cannot be proven
 * related and is dropped. A missing `sourceType` is tolerated only when the id
 * matches because the API writes the type/id pair together.
 */
export function belongsToPayment(notification, paymentId) {
  const sourceId = String(notification?.sourceId || '').trim().toLowerCase();
  const expectedId = String(paymentId || '').trim().toLowerCase();
  if (!sourceId || !expectedId || sourceId !== expectedId) return false;
  const sourceType = String(notification?.sourceType || '').trim().toUpperCase();
  return !sourceType || sourceType === NOTIFICATION_SOURCE_TYPE;
}

const NOTIFICATION_TONES = [
  ['green', ['DELIVERED', 'READ', 'ACKNOWLEDGED', 'ACTIONED']],
  ['red', ['FAILED', 'SUPPRESSED', 'EXPIRED', 'CANCELLED']],
  ['amber', ['CREATED', 'QUEUED', 'SENT']]
];

/** Delivery status tone; unknown statuses keep the default blue pill. */
export function notificationTone(status) {
  const value = String(status || '').toUpperCase();
  const match = NOTIFICATION_TONES.find(([, statuses]) => statuses.includes(value));
  return match ? match[0] : 'blue';
}

/** Renders the Notification `createdAt` instant as a stable calendar date. */
export function notificationCreatedDate(value) {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value).trim();
  const date = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return date ? date[1] : text;
}

function createdTimestamp(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

/**
 * Normalizes Notification DTOs into newest-first rows for the Overview. A row
 * without an id stays visible but unlinked instead of turning into blank noise.
 */
export function notificationRows(body, paymentId) {
  return notificationItems(body)
    .filter((notification) => belongsToPayment(notification, paymentId))
    .map((notification) => {
      const id = firstText(notification?.id, notification?.notificationId);
      const createdAt = firstText(
        notification?.createdAt,
        notification?.createdOn,
        notification?.created
      );
      const status = firstText(notification?.status).toUpperCase();
      return {
        id,
        number: firstText(
          notification?.notificationNumber,
          notification?.number,
          notification?.reference
        ) || (id ? shortId(id) : '—'),
        subject: firstText(
          notification?.subject,
          notification?.title,
          notification?.notificationType
        ),
        status,
        createdAt,
        createdAtValue: createdTimestamp(createdAt),
        href: notificationRecordHref(id)
      };
    })
    .sort((left, right) => {
      const byCreated = right.createdAtValue - left.createdAtValue;
      if (byCreated !== 0) return byCreated;
      // Notification number breaks same-instant ties so the preview is stable.
      return right.number.localeCompare(left.number);
    });
}
