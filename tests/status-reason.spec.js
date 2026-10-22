import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PAYMENT_ID = '33333333-3333-7333-8333-333333333333';
const PAYEE_ID = '22222222-2222-7222-8222-222222222222';

function payment(overrides = {}) {
  return {
    id: PAYMENT_ID,
    tenantId: TENANT,
    paymentNumber: 'PAY-2026-0044721',
    paymentType: 'INDEMNITY',
    status: 'SUBMITTED',
    statusReason: null,
    amount: '125000.0000',
    currency: 'USD',
    payeePartyId: PAYEE_ID,
    paymentDate: '2026-10-19',
    version: 2,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-20T14:20:00Z',
    ...overrides
  };
}

function statusChanged({ aggregateVersion, occurredAt, from, to, reason, version }) {
  return {
    eventId: `aaaaaaaa-aaaa-7aaa-8aaa-${String(aggregateVersion).padStart(12, '0')}`,
    eventType: 'payment.payment.status-changed',
    eventVersion: 1,
    book: 'DIRECT',
    aggregateType: 'Payment',
    aggregateId: PAYMENT_ID,
    aggregateVersion,
    occurredAt,
    receivedAt: occurredAt,
    status: 'PROCESSED',
    payload: {
      paymentId: PAYMENT_ID,
      paymentNumber: 'PAY-2026-0044721',
      status: to,
      version,
      from,
      to,
      ...(reason ? { reason } : {})
    }
  };
}

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

/**
 * Mocks the queue, record, aggregate activity, party lookup, and documents.
 * The activity response is deliberately configurable so the tests can exercise
 * both the event-derived transition context and the payment-only fallback.
 */
async function installMocks(page, {
  record = payment(),
  events = [],
  eventsStatus = 200
} = {}) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/v1/payments') {
      await json(route, 200, [record]);
      return;
    }
    if (method === 'GET' && path === `/api/v1/payments/${record.id}`) {
      await json(route, 200, record);
      return;
    }
    if (method === 'GET' && path.startsWith('/api/v1/events/aggregate/')) {
      await json(
        route,
        eventsStatus,
        eventsStatus >= 400
          ? { code: 'EVENT_STREAM_UNAVAILABLE', message: 'Event stream unavailable' }
          : { items: events }
      );
      return;
    }
    if (method === 'GET' && path === '/api/v1/documents') {
      await json(route, 200, []);
      return;
    }
    if (method === 'GET' && path.startsWith('/api/v1/parties/')) {
      await json(route, 404, { code: 'PARTY_NOT_FOUND', message: 'Party was not found' });
      return;
    }
    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });
}

async function openPayment(page) {
  await page.goto(`/?record=${PAYMENT_ID}`);
  await expect(page.getByTestId('payment-lifecycle')).toBeVisible();
}

async function openDetails(page) {
  await page.getByRole('tab', { name: 'Payment Details' }).click();
  await expect(page.locator('#panel-details')).toBeVisible();
}

const APPROVED_TO_SUBMITTED = statusChanged({
  aggregateVersion: 5,
  occurredAt: '2026-10-20T14:20:00Z',
  from: 'APPROVED',
  to: 'SUBMITTED',
  reason: 'Bank return confirmed by treasury',
  version: 2
});

const DRAFT_TO_PENDING = statusChanged({
  aggregateVersion: 2,
  occurredAt: '2026-10-20T14:10:00Z',
  from: 'DRAFT',
  to: 'PENDING_AUTHORITY',
  version: 1
});

test('shows the normalized status reason with its latest transition in details and lifecycle', async ({ page }) => {
  await installMocks(page, {
    record: payment({ statusReason: '  Bank   return\n confirmed by treasury  ' }),
    // Out of order on purpose: the view sorts newest first and picks the
    // transition that reached the current status.
    events: [DRAFT_TO_PENDING, APPROVED_TO_SUBMITTED]
  });
  await openPayment(page);

  const lifecycleReason = page.getByTestId('lifecycle-status-reason');
  await expect(lifecycleReason).toBeVisible();
  await expect(lifecycleReason).toContainText('Bank return confirmed by treasury');
  const lifecycleContext = page.getByTestId('lifecycle-status-reason-context');
  await expect(lifecycleContext).toContainText('APPROVED → SUBMITTED');
  await expect(lifecycleContext).toContainText('Oct 20, 2026, 2:20 PM UTC');
  await expect(lifecycleContext).toContainText('version 2');

  await openDetails(page);
  const row = page.getByTestId('detail-status-reason-row');
  await expect(row).toContainText('Status reason');
  await expect(row.getByTestId('detail-status-reason')).toHaveText(
    'Bank return confirmed by treasury'
  );
  await expect(row.getByTestId('detail-status-reason-context')).toHaveText(
    'Latest transition APPROVED → SUBMITTED · Oct 20, 2026, 2:20 PM UTC · version 2'
  );

  // The panel is outside the tab strip, so the lifecycle keeps the reason too.
  await expect(lifecycleReason).toContainText('Bank return confirmed by treasury');
});

test('omits the status reason when the payment has none', async ({ page }) => {
  await installMocks(page, {
    record: payment({ statusReason: null }),
    events: [statusChanged({
      aggregateVersion: 3,
      occurredAt: '2026-10-20T14:20:00Z',
      from: 'PENDING_AUTHORITY',
      to: 'SUBMITTED',
      version: 2
    })]
  });
  await openPayment(page);

  await expect(page.getByTestId('lifecycle-status-reason')).toHaveCount(0);
  await expect(page.getByTestId('lifecycle-status-reason-context')).toHaveCount(0);

  await openDetails(page);
  await expect(page.getByTestId('detail-status-reason-row')).toHaveCount(0);
  await expect(page.getByTestId('detail-status-reason')).toHaveCount(0);
  await expect(page.getByTestId('detail-status-reason-context')).toHaveCount(0);
});

test('treats a blank status reason as absent and caps the displayed reason at 200 characters', async ({ page }) => {
  await installMocks(page, {
    record: payment({ statusReason: '   \n\t  ' }),
    events: []
  });
  await openPayment(page);

  await expect(page.getByTestId('lifecycle-status-reason')).toHaveCount(0);

  // Re-open with an overlong value: the API caps the stored reason at 200
  // characters, so the view never renders an unbounded reason.
  await page.unroute('**/api/v1/**');
  await installMocks(page, {
    record: payment({ statusReason: `  ${'r'.repeat(210)}  ` }),
    events: [APPROVED_TO_SUBMITTED]
  });
  await openPayment(page);

  await expect(page.getByTestId('lifecycle-status-reason')).toContainText('r'.repeat(200));
  await expect(page.getByTestId('lifecycle-status-reason-context')).toContainText('version 2');
});

test('falls back to payment status and version when the activity feed is unavailable', async ({ page }) => {
  await installMocks(page, {
    record: payment({ statusReason: 'Manual reversal approved by treasury', status: 'PAID', version: 4 }),
    eventsStatus: 503
  });
  await openPayment(page);

  const lifecycleReason = page.getByTestId('lifecycle-status-reason');
  await expect(lifecycleReason).toContainText('Manual reversal approved by treasury');
  const context = page.getByTestId('lifecycle-status-reason-context');
  await expect(context).toContainText('Current status PAID');
  await expect(context).toContainText('version 4');
  await expect(context).toContainText('updated Oct 20, 2026, 2:20 PM UTC');

  await openDetails(page);
  await expect(page.getByTestId('detail-status-reason')).toHaveText(
    'Manual reversal approved by treasury'
  );
  await expect(page.getByTestId('detail-status-reason-context')).toContainText(
    'Current status PAID · version 4'
  );
});

test('reads the reason from the latest transition when the projection omits statusReason', async ({ page }) => {
  const legacy = payment({ status: 'SUBMITTED', version: 2 });
  delete legacy.statusReason;

  await installMocks(page, {
    record: legacy,
    events: [APPROVED_TO_SUBMITTED]
  });
  await openPayment(page);

  await expect(page.getByTestId('lifecycle-status-reason')).toContainText(
    'Bank return confirmed by treasury'
  );
  await expect(page.getByTestId('lifecycle-status-reason-context')).toContainText(
    'APPROVED → SUBMITTED'
  );

  await openDetails(page);
  await expect(page.getByTestId('detail-status-reason')).toHaveText(
    'Bank return confirmed by treasury'
  );
});
