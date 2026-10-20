import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PAYMENT_ID = '33333333-3333-7333-8333-333333333333';
const PAYMENT_2_ID = '44444444-4444-7444-8444-444444444444';
const PAYEE_ID = '22222222-2222-7222-8222-222222222222';
const SOURCE_ID = '55555555-5555-7555-8555-555555555555';

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

const PAYMENT_2 = {
  ...PAYMENT,
  id: PAYMENT_2_ID,
  paymentNumber: 'PAY-2026-0044722',
  status: 'SUBMITTED',
  version: 3
};

const CREATED_EVENT = {
  eventId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
  eventType: 'payment.payment.created',
  eventVersion: 1,
  book: 'DIRECT',
  aggregateType: 'Payment',
  aggregateId: PAYMENT_ID,
  aggregateVersion: 1,
  occurredAt: '2026-10-20T14:05:00Z',
  receivedAt: '2026-10-20T14:05:01Z',
  status: 'PROCESSED',
  payload: {
    paymentId: PAYMENT_ID,
    paymentNumber: PAYMENT.paymentNumber,
    paymentType: 'INDEMNITY',
    status: 'DRAFT',
    amount: '125000.0000',
    currency: 'USD',
    payeePartyId: PAYEE_ID,
    paymentDate: '2026-10-19',
    version: 0,
    sourceType: 'DIRECT_CLAIM',
    sourceId: SOURCE_ID,
    sourceReference: 'CLM-2026-0000001'
  }
};

const UPDATED_EVENT = {
  eventId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
  eventType: 'payment.payment.updated',
  eventVersion: 1,
  book: 'DIRECT',
  aggregateType: 'Payment',
  aggregateId: PAYMENT_ID,
  aggregateVersion: 2,
  occurredAt: '2026-10-20T14:10:00Z',
  receivedAt: '2026-10-20T14:10:01Z',
  status: 'PROCESSED',
  payload: {
    paymentId: PAYMENT_ID,
    paymentNumber: PAYMENT.paymentNumber,
    changedFields: ['status'],
    version: 1,
    from: 'DRAFT',
    to: 'PENDING_AUTHORITY'
  }
};

const STATUS_CHANGED_EVENT = {
  eventId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
  eventType: 'payment.payment.status-changed',
  eventVersion: 1,
  book: 'DIRECT',
  aggregateType: 'Payment',
  aggregateId: PAYMENT_ID,
  aggregateVersion: 3,
  occurredAt: '2026-10-20T14:20:00Z',
  receivedAt: '2026-10-20T14:20:01Z',
  status: 'PROCESSED',
  payload: {
    paymentId: PAYMENT_ID,
    paymentNumber: PAYMENT.paymentNumber,
    status: 'SUBMITTED',
    version: 2,
    from: 'APPROVED',
    to: 'SUBMITTED'
  }
};

const PAYMENT_2_EVENT = {
  ...CREATED_EVENT,
  eventId: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
  aggregateId: PAYMENT_2_ID,
  payload: {
    ...CREATED_EVENT.payload,
    paymentId: PAYMENT_2_ID,
    paymentNumber: PAYMENT_2.paymentNumber,
    status: 'SUBMITTED'
  }
};

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

/**
 * Mocks the payment queue, detail, party lookup, and aggregate activity feed.
 * `eventsResponses` is either a list (the last entry repeats) or a function of
 * (callIndex, url), which makes refresh and record-switch refetches explicit.
 */
async function mockPaymentApi(page, {
  payments = [PAYMENT],
  eventsResponses = [{ items: [] }],
  eventsStatus = 200,
  gate = null,
  onEvents = null
} = {}) {
  let eventsCalls = 0;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/v1/payments') {
      await json(route, 200, payments);
      return;
    }
    if (method === 'GET' && /^\/api\/v1\/events\/aggregate\/[^/]+$/.test(path)) {
      if (onEvents) onEvents(request, url, eventsCalls);
      if (gate) await gate;
      const response = typeof eventsResponses === 'function'
        ? eventsResponses(eventsCalls, url)
        : Array.isArray(eventsResponses)
          ? eventsResponses[Math.min(eventsCalls, eventsResponses.length - 1)]
          : eventsResponses;
      eventsCalls += 1;
      await json(route, eventsStatus, response);
      return;
    }
    if (method === 'GET' && path.startsWith('/api/v1/payments/')) {
      const id = path.slice('/api/v1/payments/'.length);
      const found = !id.includes('/') && payments.find((payment) => payment.id === id);
      if (found) {
        await json(route, 200, found);
        return;
      }
      await json(route, 404, { code: 'PAYMENT_NOT_FOUND', message: `Payment ${id} was not found` });
      return;
    }
    if (method === 'GET' && /^\/api\/v1\/parties\/[0-9a-f-]+$/i.test(path)) {
      await json(route, 404, { code: 'PARTY_NOT_FOUND', message: 'Party was not found' });
      return;
    }
    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });
}

async function openActivity(page) {
  await page.getByRole('tab', { name: 'Activity' }).click();
}

test('fetches the payment aggregate activity with limit and tenant header', async ({ page }) => {
  const requests = [];

  await mockPaymentApi(page, {
    eventsResponses: [{ items: [STATUS_CHANGED_EVENT, UPDATED_EVENT, CREATED_EVENT] }],
    onEvents: (request, url) => {
      requests.push({
        path: url.pathname,
        limit: url.searchParams.get('limit'),
        tenant: request.headers()['x-eia-tenant']
      });
    }
  });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openActivity(page);

  await expect(page.getByTestId('activity-count')).toHaveText('3 events');
  await expect(page.getByTestId('activity-timeline')).toBeVisible();

  // The raw event name stays visible next to its readable label.
  await expect(page.getByTestId('activity-event-label-0')).toHaveText('Payment status changed');
  await expect(page.getByTestId('activity-event-type-0')).toHaveText(
    'payment.payment.status-changed'
  );
  await expect(page.getByTestId('activity-status-0')).toHaveText('PROCESSED');
  await expect(page.getByTestId('activity-time-0')).toHaveText('Oct 20, 2026, 2:20 PM UTC');
  await expect(page.getByTestId('activity-meta-0')).toContainText('Book DIRECT');
  await expect(page.getByTestId('activity-meta-0')).toContainText('Aggregate v3');

  expect(requests).toEqual([
    {
      path: `/api/v1/events/aggregate/${PAYMENT_ID}`,
      limit: '50',
      tenant: TENANT
    }
  ]);
});

test('orders the timeline newest first even when the feed is out of order', async ({ page }) => {
  await mockPaymentApi(page, {
    // Deliberately shuffled: created, newest status change, then the update.
    eventsResponses: [{ items: [CREATED_EVENT, STATUS_CHANGED_EVENT, UPDATED_EVENT] }]
  });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openActivity(page);

  await expect(page.getByTestId('activity-event-label-0')).toHaveText('Payment status changed');
  await expect(page.getByTestId('activity-event-label-1')).toHaveText('Payment updated');
  await expect(page.getByTestId('activity-event-label-2')).toHaveText('Payment created');

  await expect(page.getByTestId('activity-time-0')).toHaveText('Oct 20, 2026, 2:20 PM UTC');
  await expect(page.getByTestId('activity-time-1')).toHaveText('Oct 20, 2026, 2:10 PM UTC');
  await expect(page.getByTestId('activity-time-2')).toHaveText('Oct 20, 2026, 2:05 PM UTC');

  // Status transitions are summarized from the payload, newest state on top.
  await expect(page.getByTestId('activity-fact-status-0')).toHaveText('APPROVED → SUBMITTED');
  await expect(page.getByTestId('activity-fact-status-1')).toHaveText('DRAFT → PENDING_AUTHORITY');
});

test('summarizes the payload facts of a created event', async ({ page }) => {
  await mockPaymentApi(page, { eventsResponses: [{ items: [CREATED_EVENT] }] });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openActivity(page);

  await expect(page.getByTestId('activity-event-label-0')).toHaveText('Payment created');
  await expect(page.getByTestId('activity-fact-amount-0')).toHaveText('$125,000.00');
  await expect(page.getByTestId('activity-fact-currency-0')).toHaveText('USD');
  await expect(page.getByTestId('activity-fact-source-type-0')).toHaveText('Direct claim');
  await expect(page.getByTestId('activity-fact-source-reference-0')).toHaveText('CLM-2026-0000001');
  await expect(page.getByTestId('activity-fact-status-0')).toHaveText('DRAFT');

  // The delivery status is separate from the payment status payload fact.
  await expect(page.getByTestId('activity-status-0')).toHaveText('PROCESSED');
});

test('renders the empty state and the event-derived context note', async ({ page }) => {
  await mockPaymentApi(page, { eventsResponses: [{ items: [] }] });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openActivity(page);

  await expect(page.getByTestId('activity-card')).toBeVisible();
  await expect(page.getByTestId('activity-count')).toHaveText('0 events');
  await expect(page.getByTestId('activity-empty')).toHaveText(
    'No events have been recorded for this payment yet.'
  );
  await expect(page.getByTestId('activity-timeline')).toHaveCount(0);

  const context = page.getByTestId('activity-context');
  await expect(context).toContainText('derived from the append-only payment event stream');
  await expect(context).toContainText('The payment record is the source of truth');

  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
});

test('contains a 503 activity failure inside the card without disturbing the record', async ({ page }) => {
  await mockPaymentApi(page, {
    eventsStatus: 503,
    eventsResponses: {
      code: 'EVENT_STREAM_UNAVAILABLE',
      message: 'Event stream unavailable'
    }
  });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openActivity(page);

  const error = page.getByTestId('activity-error');
  await expect(error).toContainText('EVENT_STREAM_UNAVAILABLE: Event stream unavailable');
  await expect(error).toContainText('The payment record is unaffected.');
  await expect(page.getByTestId('activity-count')).toHaveText('—');
  await expect(page.getByTestId('activity-timeline')).toHaveCount(0);

  // The event failure never becomes a page-level alert or replaces the record.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('summary-amount')).toHaveText('$125,000.00');
});

test('renders the payment while a slow activity feed is still in flight', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  await mockPaymentApi(page, {
    eventsResponses: [{ items: [CREATED_EVENT] }],
    gate
  });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openActivity(page);

  // The record and its existing cards are usable before activity resolves.
  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('summary-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('activity-loading')).toHaveText('Loading payment activity…');
  await expect(page.getByTestId('activity-count')).toHaveText('…');

  release();

  await expect(page.getByTestId('activity-count')).toHaveText('1 event');
  await expect(page.getByTestId('activity-timeline')).toBeVisible();
});

test('refetches activity from the refresh control', async ({ page }) => {
  const requests = [];

  await mockPaymentApi(page, {
    eventsResponses: [
      { items: [CREATED_EVENT] },
      { items: [STATUS_CHANGED_EVENT, CREATED_EVENT] }
    ],
    onEvents: (_request, url, callIndex) => {
      requests.push({ limit: url.searchParams.get('limit'), callIndex });
    }
  });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openActivity(page);

  await expect(page.getByTestId('activity-count')).toHaveText('1 event');
  await expect(page.getByTestId('activity-event-label-0')).toHaveText('Payment created');

  await page.getByTestId('activity-refresh').click();

  await expect(page.getByTestId('activity-count')).toHaveText('2 events');
  await expect(page.getByTestId('activity-event-label-0')).toHaveText('Payment status changed');
  await expect(page.getByTestId('activity-refresh')).toBeEnabled();

  expect(requests.map((request) => request.limit)).toEqual(['50', '50']);
  expect(requests.length).toBe(2);
});

test('refetches activity when another payment is selected', async ({ page }) => {
  const requestedIds = [];

  await mockPaymentApi(page, {
    payments: [PAYMENT, PAYMENT_2],
    eventsResponses: (_callIndex, url) => {
      const id = url.pathname.split('/').pop();
      return { items: [id === PAYMENT_2_ID ? PAYMENT_2_EVENT : CREATED_EVENT] };
    },
    onEvents: (_request, url) => {
      requestedIds.push(url.pathname.split('/').pop());
    }
  });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();

  await page.getByRole('button', { name: `Open record ${PAYMENT_2.paymentNumber}` }).click();
  await expect(page.getByRole('heading', { name: PAYMENT_2.paymentNumber, level: 2 })).toBeVisible();

  await openActivity(page);

  await expect(page.getByTestId('activity-count')).toHaveText('1 event');
  await expect(page.getByTestId('activity-fact-status-0')).toHaveText('SUBMITTED');
  expect(requestedIds).toEqual([PAYMENT_ID, PAYMENT_2_ID]);
});
