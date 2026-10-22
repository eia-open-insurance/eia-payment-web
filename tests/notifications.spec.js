import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PAYMENT_ID = '33333333-3333-7333-8333-333333333333';
const OTHER_PAYMENT_ID = '44444444-4444-7444-8444-444444444444';
const PAYEE_ID = '22222222-2222-7222-8222-222222222222';

const PAYMENT = {
  id: PAYMENT_ID,
  tenantId: TENANT,
  paymentNumber: 'PAY-2026-0044721',
  paymentType: 'INDEMNITY',
  status: 'DRAFT',
  amount: '125000.0000',
  currency: 'USD',
  payeePartyId: PAYEE_ID,
  paymentDate: '2026-10-19',
  version: 0,
  createdAt: '2026-10-19T12:00:00Z',
  updatedAt: '2026-10-19T12:00:00Z'
};

function notification(overrides = {}) {
  return {
    tenantId: TENANT,
    notificationType: 'PAYMENT_APPROVED',
    channel: 'EMAIL',
    status: 'SENT',
    recipientPartyId: PAYEE_ID,
    body: 'Payment message body',
    templateCode: null,
    templateVersion: null,
    scheduledAt: null,
    sentAt: '2026-10-20T15:00:00Z',
    sourceType: 'PAYMENT',
    sourceId: PAYMENT_ID,
    sourceReference: PAYMENT.paymentNumber,
    createdAt: '2026-10-20T15:00:00Z',
    updatedAt: '2026-10-20T15:00:00Z',
    ...overrides
  };
}

// Deliberately out of order and mixed with rows that point at another payment or
// another source type: the card must show only this payment's newest three.
const NOTIFICATION_NEWEST = notification({
  id: '77777777-7777-7777-8777-777777777771',
  notificationNumber: 'NTF-2026-0000104',
  subject: 'Payment approved',
  status: 'DELIVERED',
  createdAt: '2026-10-22T09:30:00Z'
});

const NOTIFICATION_MIDDLE = notification({
  id: '77777777-7777-7777-8777-777777777772',
  notificationNumber: 'NTF-2026-0000103',
  subject: 'Payment submitted',
  status: 'READ',
  createdAt: '2026-10-21T10:15:00Z'
});

const NOTIFICATION_OLD = notification({
  id: '77777777-7777-7777-8777-777777777773',
  notificationNumber: 'NTF-2026-0000102',
  subject: 'Approval requested',
  status: 'QUEUED',
  createdAt: '2026-10-20T14:05:00Z'
});

const NOTIFICATION_OLDEST = notification({
  id: '77777777-7777-7777-8777-777777777774',
  notificationNumber: 'NTF-2026-0000101',
  subject: 'Payment created',
  status: 'FAILED',
  createdAt: '2026-10-19T08:00:00Z'
});

const NOTIFICATION_OTHER_PAYMENT = notification({
  id: '77777777-7777-7777-8777-777777777775',
  notificationNumber: 'NTF-2026-0000105',
  subject: 'Other payment reminder',
  status: 'SENT',
  sourceId: OTHER_PAYMENT_ID,
  createdAt: '2026-10-23T08:00:00Z'
});

const NOTIFICATION_OTHER_SOURCE = notification({
  id: '77777777-7777-7777-8777-777777777776',
  notificationNumber: 'NTF-2026-0000106',
  subject: 'Policy renewal notice',
  status: 'SENT',
  sourceType: 'POLICY',
  createdAt: '2026-10-24T08:00:00Z'
});

const RELATED = [
  NOTIFICATION_OLD,
  NOTIFICATION_NEWEST,
  NOTIFICATION_OTHER_PAYMENT,
  NOTIFICATION_MIDDLE,
  NOTIFICATION_OTHER_SOURCE,
  NOTIFICATION_OLDEST
];

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: status === 200 ? 'application/json' : 'application/problem+json',
    body: JSON.stringify(body)
  });
}

/**
 * Mocks the payment queue and the payment-derived reads on the record. Every
 * related-notification request is recorded so a test can assert the exact
 * source query and headers. `gate` keeps the notification response pending so a
 * test can observe the record while the Notifications API is in flight.
 */
async function mockPaymentApi(page, {
  notificationsResponse = RELATED,
  notificationsStatus = 200,
  gate = null,
  onNotifications = null
} = {}) {
  const state = { notificationRequests: [] };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/v1/notifications') {
      const headers = request.headers();
      state.notificationRequests.push({
        method,
        path,
        sourceType: url.searchParams.get('sourceType'),
        sourceId: url.searchParams.get('sourceId'),
        tenant: headers['x-eia-tenant'] || null,
        book: headers['x-eia-book'] || null
      });
      if (onNotifications) onNotifications(request, url);
      if (gate) await gate;
      await json(route, notificationsStatus, notificationsResponse);
      return;
    }
    if (method === 'GET' && path === '/api/v1/payments') {
      await json(route, 200, [PAYMENT]);
      return;
    }
    if (method === 'GET' && path.startsWith('/api/v1/payments/')) {
      const id = path.slice('/api/v1/payments/'.length);
      if (!id.includes('/') && id === PAYMENT.id) {
        await json(route, 200, PAYMENT);
        return;
      }
      await json(route, 404, { code: 'PAYMENT_NOT_FOUND', message: `Payment ${id} was not found` });
      return;
    }
    if (method === 'GET' && path === '/api/v1/documents') {
      await json(route, 200, []);
      return;
    }
    if (method === 'GET' && path.startsWith('/api/v1/events/aggregate/')) {
      await json(route, 200, { items: [] });
      return;
    }
    if (method === 'GET' && /^\/api\/v1\/parties\/[0-9a-f-]+$/i.test(path)) {
      await json(route, 404, { code: 'PARTY_NOT_FOUND', message: 'Party was not found' });
      return;
    }
    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });

  return state;
}

test('lists the newest three related notifications with count, source query, and tenant header', async ({ page }) => {
  const state = await mockPaymentApi(page);

  await page.goto(`/?record=${PAYMENT_ID}`);

  const card = page.getByTestId('notifications-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: /Related notifications/ })).toBeVisible();
  await expect(page.getByTestId('notifications-count')).toHaveText('4');
  await expect(page.getByTestId('notifications-context')).toContainText(
    'Notifications owns delivery, escalation, and acknowledgement'
  );

  const rows = page.getByTestId('notification-row');
  await expect(rows).toHaveCount(3);

  // Newest first, and the oldest linked row plus the unrelated rows stay hidden.
  await expect(rows.nth(0).getByTestId('notification-number')).toHaveText(
    NOTIFICATION_NEWEST.notificationNumber
  );
  await expect(rows.nth(1).getByTestId('notification-number')).toHaveText(
    NOTIFICATION_MIDDLE.notificationNumber
  );
  await expect(rows.nth(2).getByTestId('notification-number')).toHaveText(
    NOTIFICATION_OLD.notificationNumber
  );
  await expect(rows.filter({ hasText: NOTIFICATION_OLDEST.notificationNumber })).toHaveCount(0);
  await expect(
    rows.filter({ hasText: NOTIFICATION_OTHER_PAYMENT.notificationNumber })
  ).toHaveCount(0);
  await expect(
    rows.filter({ hasText: NOTIFICATION_OTHER_SOURCE.notificationNumber })
  ).toHaveCount(0);

  const newest = rows.filter({ hasText: NOTIFICATION_NEWEST.notificationNumber });
  await expect(newest.getByTestId('notification-subject')).toHaveText(
    NOTIFICATION_NEWEST.subject
  );
  await expect(newest.getByTestId('notification-status')).toContainText('DELIVERED');
  await expect(newest.getByTestId('notification-status').locator('.eia-pill')).toHaveClass(/green/);
  await expect(newest.getByTestId('notification-created')).toHaveText('2026-10-22');
  await expect(newest.getByRole('link')).toHaveAttribute(
    'href',
    `/notifications?record=${NOTIFICATION_NEWEST.id}`
  );

  await expect(page.getByTestId('notifications-more')).toHaveText(
    'Showing the 3 newest of 4 linked notifications.'
  );
  await expect(page.getByTestId('notifications-view-all')).toHaveAttribute(
    'href',
    `/notifications?sourceType=PAYMENT&sourceId=${PAYMENT_ID}`
  );
  await expect(page.getByTestId('notifications-view-all-row')).toContainText(
    'opens the Notifications queue filtered to this payment'
  );

  // The card still leaves the payment record and its existing Overview intact.
  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('summary-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('documents-card')).toBeVisible();

  expect(state.notificationRequests).toEqual([
    {
      method: 'GET',
      path: '/api/v1/notifications',
      sourceType: 'PAYMENT',
      sourceId: PAYMENT_ID,
      tenant: TENANT,
      book: null
    }
  ]);
});

test('accepts the {items} page envelope and renders a single notification', async ({ page }) => {
  await mockPaymentApi(page, { notificationsResponse: { items: [NOTIFICATION_OLD] } });

  await page.goto(`/?record=${PAYMENT_ID}`);

  await expect(page.getByTestId('notifications-count')).toHaveText('1');
  await expect(page.getByTestId('notification-row')).toHaveCount(1);
  await expect(page.getByTestId('notification-number')).toHaveText(
    NOTIFICATION_OLD.notificationNumber
  );
  await expect(page.getByTestId('notification-created')).toHaveText('2026-10-20');
  await expect(page.getByTestId('notifications-more')).toHaveCount(0);
});

test('shows the empty state when no notification is linked to the payment', async ({ page }) => {
  await mockPaymentApi(page, { notificationsResponse: [] });

  await page.goto(`/?record=${PAYMENT_ID}`);

  await expect(page.getByTestId('notifications-count')).toHaveText('0');
  await expect(page.getByTestId('notifications-empty')).toHaveText(
    'No notifications are linked to this payment yet.'
  );
  await expect(page.getByTestId('notification-row')).toHaveCount(0);
  await expect(page.getByTestId('notifications-table')).toHaveCount(0);
  await expect(page.getByTestId('notifications-view-all')).toBeVisible();
  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
});

test('contains a notifications failure inside the card without disturbing the record', async ({ page }) => {
  await mockPaymentApi(page, {
    notificationsStatus: 503,
    notificationsResponse: {
      code: 'EIA-NTF-5030',
      message: 'Notification service is unavailable'
    }
  });

  await page.goto(`/?record=${PAYMENT_ID}`);

  const error = page.getByTestId('notifications-error');
  await expect(error).toContainText('EIA-NTF-5030: Notification service is unavailable');
  await expect(error).toContainText('Related notifications could not be loaded');
  await expect(error).toContainText('The payment record is unaffected.');
  await expect(page.getByTestId('notifications-count')).toHaveText('—');
  await expect(page.getByTestId('notification-row')).toHaveCount(0);
  await expect(page.getByTestId('notifications-view-all')).toBeVisible();

  // The failure never becomes a page-level alert or replaces the record.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('summary-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('documents-card')).toBeVisible();
});

test('renders the payment while a slow Notifications API is still in flight', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  await mockPaymentApi(page, { gate });

  await page.goto(`/?record=${PAYMENT_ID}`);

  // The record and its existing cards are usable before notifications resolve.
  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('notifications-loading')).toHaveText(
    'Loading related notifications…'
  );
  await expect(page.getByTestId('notifications-count')).toHaveText('…');

  release();

  await expect(page.getByTestId('notifications-count')).toHaveText('4');
  await expect(page.getByTestId('notification-row')).toHaveCount(3);
});

test('links each notification to its record and view all to the filtered queue', async ({ page }) => {
  await mockPaymentApi(page);

  await page.goto(`/?record=${PAYMENT_ID}`);

  await page.getByTestId(`notification-link-${NOTIFICATION_NEWEST.id}`).click();
  await expect(page).toHaveURL(
    new RegExp(`/notifications\\?record=${NOTIFICATION_NEWEST.id}$`)
  );

  await page.goto('/');
  await page.getByTestId('notifications-view-all').click();
  await expect(page).toHaveURL(
    new RegExp(`/notifications\\?sourceType=PAYMENT&sourceId=${PAYMENT_ID}$`)
  );
});
