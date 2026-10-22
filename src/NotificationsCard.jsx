import React, { useEffect, useState } from 'react';
import { api, problemMessage } from './api.js';
import { navigate } from './navigation.js';
import {
  RELATED_NOTIFICATION_LIMIT,
  notificationCreatedDate,
  notificationRows,
  notificationTone,
  notificationsViewAllHref,
  paymentNotificationsEndpoint
} from './notifications.js';

/**
 * Notifications are a read-only projection on the payment: they are delivered
 * because the payment changed, but Notifications owns routing, delivery,
 * escalation, and acknowledgement. The lookup is independent of the payment
 * load, so a slow or failing Notifications service never blocks the record.
 */

function openNotification(event) {
  const href = event.currentTarget.getAttribute('href');
  if (!href) return;
  if (
    event.defaultPrevented
    || event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
  ) {
    return;
  }
  event.preventDefault();
  navigate(href);
}

export default function NotificationsCard({ paymentId = '', refreshToken = 0 }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(Boolean(paymentId));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!paymentId) {
      setItems([]);
      setError('');
      setLoading(false);
      return undefined;
    }

    let alive = true;
    setItems([]);
    setError('');
    setLoading(true);

    api(paymentNotificationsEndpoint(paymentId))
      .then(({ response, body }) => {
        if (!alive) return;
        if (!response.ok) {
          setItems([]);
          setError(problemMessage(body, `Notifications request failed: ${response.status}`));
          setLoading(false);
          return;
        }
        setItems(notificationRows(body, paymentId));
        setError('');
        setLoading(false);
      })
      .catch((cause) => {
        if (!alive) return;
        setItems([]);
        setError(cause.message || 'the Notifications service could not be reached');
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [paymentId, refreshToken]);

  const newest = items.slice(0, RELATED_NOTIFICATION_LIMIT);
  const count = loading ? '…' : error ? '—' : String(items.length);
  const viewAllHref = notificationsViewAllHref(paymentId);

  return (
    <section
      className="eia-card"
      aria-label="Related notifications"
      data-testid="notifications-card"
      style={{ marginTop: 14 }}
    >
      <div className="eia-section-title" style={{ marginTop: 0 }}>
        <h3>Related notifications</h3>
        <span className="eia-muted" data-testid="notifications-count">{count}</span>
      </div>
      <p className="eia-muted" data-testid="notifications-context" style={{ marginTop: 4 }}>
        Notifications sent because this payment changed. The payment carries the source link;
        Notifications owns delivery, escalation, and acknowledgement.
      </p>

      {loading && (
        <p className="eia-muted" data-testid="notifications-loading">
          Loading related notifications…
        </p>
      )}

      {!loading && error && (
        <p className="eia-muted" data-testid="notifications-error">
          Related notifications could not be loaded ({error}). The payment record is unaffected.
        </p>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="eia-muted" data-testid="notifications-empty">
          No notifications are linked to this payment yet.
        </p>
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <div
            className="eia-table-wrap"
            data-testid="notifications-table"
            style={{ marginTop: 10 }}
          >
            <table className="eia-table" aria-label="Related notifications">
              <thead>
                <tr>
                  <th>Notification</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {newest.map((notification, index) => (
                  <tr
                    key={notification.id || `${notification.number}-${index}`}
                    data-testid="notification-row"
                  >
                    <td className="eia-mono" data-testid="notification-number">
                      {notification.href ? (
                        <a
                          href={notification.href}
                          onClick={openNotification}
                          data-testid={notification.id
                            ? `notification-link-${notification.id}`
                            : undefined}
                          title={`Open notification ${notification.number}`}
                        >
                          {notification.number}
                        </a>
                      ) : notification.number}
                    </td>
                    <td data-testid="notification-subject">{notification.subject || '—'}</td>
                    <td data-testid="notification-status">
                      <span className={`eia-pill ${notificationTone(notification.status)}`}>
                        {notification.status || '—'}
                      </span>
                    </td>
                    <td data-testid="notification-created">
                      <time
                        dateTime={notification.createdAt || undefined}
                        title={notification.createdAt || undefined}
                      >
                        {notificationCreatedDate(notification.createdAt)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.length > newest.length && (
            <p className="eia-muted" data-testid="notifications-more" style={{ margin: '6px 0 0' }}>
              Showing the {newest.length} newest of {items.length} linked notifications.
            </p>
          )}
        </>
      )}

      <p
        className="eia-muted"
        data-testid="notifications-view-all-row"
        style={{ margin: '10px 0 0', fontSize: 12 }}
      >
        <a href={viewAllHref} onClick={openNotification} data-testid="notifications-view-all">
          View all notifications
        </a>{' '}
        — opens the Notifications queue filtered to this payment.
      </p>
    </section>
  );
}
