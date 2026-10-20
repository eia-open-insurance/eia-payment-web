import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PAYEE_A = '22222222-2222-7222-8222-222222222222';
const PAYEE_B = '44444444-4444-7444-8444-444444444444';
const PARTY_ID = '99999999-9999-7999-8999-999999999999';
const CREATED_ID = '55555555-5555-7555-8555-555555555555';

const PARTY = {
  id: PARTY_ID,
  type: 'PARTY',
  label: 'PTY-2026-0001',
  secondary: 'Meridian Manufacturing · ORGANIZATION',
  status: 'ACTIVE',
  href: `/party?record=${PARTY_ID}`
};

function payment(overrides = {}) {
  return {
    id: '33333333-3333-7333-8333-333333333333',
    tenantId: TENANT,
    paymentNumber: 'PAY-2026-0044721',
    paymentType: 'INDEMNITY',
    status: 'DRAFT',
    amount: '125000.0000',
    currency: 'USD',
    payeePartyId: PAYEE_A,
    paymentDate: '2026-10-19',
    version: 0,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
    ...overrides
  };
}

const PAYMENT_A = payment();
const PAYMENT_B = payment({
  id: '44444444-4444-7444-8444-444444444444',
  paymentNumber: 'PAY-2026-0044722',
  paymentType: 'DEFENSE_COST',
  status: 'PENDING_AUTHORITY',
  amount: '4200.5000',
  payeePartyId: PAYEE_B,
  version: 1
});

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

/**
 * Mocks the payment queue and detail routes. `detail` maps an id to the record
 * returned by GET /api/v1/payments/{id}; the queue itself also resolves.
 */
async function mockPayments(page, { queue = [], detail = {}, onDetail, onCreate } = {}) {
  let rows = [...queue];

  await page.route('**/api/v1/payments**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/payments') {
      await json(route, 200, rows);
      return;
    }
    if (method === 'GET' && url.pathname.startsWith('/api/v1/payments/')) {
      const id = url.pathname.slice('/api/v1/payments/'.length);
      if (onDetail) onDetail(request, url);
      if (!id.includes('/') && detail[id]) {
        await json(route, 200, detail[id]);
        return;
      }
      const queued = rows.find((row) => row.id === id);
      if (!id.includes('/') && queued) {
        await json(route, 200, queued);
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          status: 404,
          code: 'PAYMENT_NOT_FOUND',
          message: `Payment ${id} was not found`
        })
      });
      return;
    }
    if (method === 'POST' && url.pathname === '/api/v1/payments') {
      const payload = request.postDataJSON();
      const created = payment({
        id: CREATED_ID,
        paymentNumber: 'PAY-2026-0044723',
        paymentType: payload.paymentType,
        amount: '250000.0000',
        currency: payload.currency,
        payeePartyId: payload.payeePartyId,
        paymentDate: payload.paymentDate,
        status: 'DRAFT',
        version: 0
      });
      rows = [created, ...rows];
      if (onCreate) onCreate({ payload, headers: request.headers(), created });
      await json(route, 201, created);
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected ${method} ${url.pathname}` });
  });

  return {
    rows: () => rows
  };
}

test('?record= selects the requested payment outside the queue and popstate re-applies it', async ({ page }) => {
  const detailRequests = [];
  await mockPayments(page, {
    queue: [PAYMENT_A],
    detail: { [PAYMENT_B.id]: PAYMENT_B },
    onDetail: (request, url) => {
      const id = url.pathname.slice('/api/v1/payments/'.length);
      if (id === PAYMENT_B.id) {
        detailRequests.push({ method: request.method(), tenant: request.headers()['x-eia-tenant'] });
      }
    }
  });

  await page.goto(`/?record=${PAYMENT_B.id}`);

  await expect(page.getByRole('heading', { name: PAYMENT_B.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: `Open record ${PAYMENT_B.paymentNumber}` })).toBeVisible();
  await expect(page.getByRole('button', { name: `Open record ${PAYMENT_A.paymentNumber}` })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('PENDING_AUTHORITY');
  await expect(page).toHaveURL(new RegExp(`record=${PAYMENT_B.id}`));
  expect(detailRequests).toContainEqual({ method: 'GET', tenant: TENANT });

  await page.evaluate((id) => {
    const url = new URL(window.location.href);
    url.searchParams.set('record', id);
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, PAYMENT_A.id);

  await expect(page.getByRole('heading', { name: PAYMENT_A.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');

  await page.getByRole('button', { name: `Open record ${PAYMENT_B.paymentNumber}` }).click();
  await expect(page).toHaveURL(new RegExp(`record=${PAYMENT_B.id}`));
});

test('?new=1 opens the Create payment dialog', async ({ page }) => {
  await mockPayments(page, { queue: [PAYMENT_A] });

  await page.goto('/?new=1');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Create payment' })).toBeVisible();
  await expect(page).toHaveURL(/new=1/);

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/new=1/);
});

test('filters the payment queue by number, type, payee, and status', async ({ page }) => {
  await mockPayments(page, {
    queue: [PAYMENT_A, PAYMENT_B],
    detail: { [PAYMENT_A.id]: PAYMENT_A, [PAYMENT_B.id]: PAYMENT_B }
  });

  await page.goto('/');

  const filter = page.getByPlaceholder('Filter payments by number, type, payee, or status…');
  const rowA = page.getByRole('button', { name: `Open record ${PAYMENT_A.paymentNumber}` });
  const rowB = page.getByRole('button', { name: `Open record ${PAYMENT_B.paymentNumber}` });

  await expect(rowA).toBeVisible();
  await expect(rowB).toBeVisible();

  for (const term of ['DEFENSE_COST', 'PENDING_AUTHORITY', PAYMENT_B.paymentNumber, '44444444']) {
    await filter.fill(term);
    await expect(rowB).toBeVisible();
    await expect(rowA).toHaveCount(0);
  }

  await filter.fill(PAYMENT_A.paymentNumber);
  await expect(rowA).toBeVisible();
  await expect(rowB).toHaveCount(0);
  await expect(page.getByTestId('payment-queue-count')).toHaveText('1 of 2');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(rowA).toBeVisible();
  await expect(rowB).toBeVisible();
  await expect(page.getByTestId('payment-queue-count')).toHaveText('2');
});

test('payee picker searches parties, shows the label, links the party, and submits the UUID', async ({ page }) => {
  const pickerRequests = [];
  let createdPayload = null;
  let createdHeaders = null;

  await mockPayments(page, {
    queue: [PAYMENT_A],
    detail: { [PAYMENT_A.id]: PAYMENT_A },
    onCreate: ({ payload, headers }) => {
      createdPayload = payload;
      createdHeaders = headers;
    }
  });
  await page.route('**/api/v1/parties/search**', async (route) => {
    const url = new URL(route.request().url());
    pickerRequests.push({
      q: url.searchParams.get('q'),
      limit: url.searchParams.get('limit'),
      tenant: route.request().headers()['x-eia-tenant']
    });
    await json(route, 200, { query: 'Meridian', limit: 8, items: [PARTY] });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Create payment' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Payment type').selectOption('EXPENSE');
  await dialog.getByLabel('Amount').fill('250000');
  await dialog.getByPlaceholder('Search party number or name…').fill('Meridian');
  await dialog.getByRole('button', { name: /PTY-2026-0001/ }).click();

  await expect(dialog.getByText('PTY-2026-0001', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Meridian Manufacturing · ORGANIZATION')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open party record' })).toHaveAttribute(
    'href',
    `/party?record=${PARTY_ID}`
  );
  await dialog.getByLabel('Payment date').fill('2026-11-01');
  await dialog.getByRole('button', { name: 'Create payment' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'PAY-2026-0044723', level: 2 })).toBeVisible();

  expect(pickerRequests).toEqual([{ q: 'Meridian', limit: '8', tenant: TENANT }]);
  expect(createdHeaders['x-eia-tenant']).toBe(TENANT);
  expect(createdPayload).toEqual({
    paymentType: 'EXPENSE',
    amount: '250000',
    currency: 'USD',
    payeePartyId: PARTY_ID,
    paymentDate: '2026-11-01'
  });

  const summaryPayee = page.getByTestId('summary-payee');
  await expect(summaryPayee).toContainText('PTY-2026-0001');
  await expect(summaryPayee.getByRole('link')).toHaveAttribute('href', `/party?record=${PARTY_ID}`);
  await expect(page).toHaveURL(new RegExp(`record=${CREATED_ID}`));
});

test('context panel explains the disbursement boundary and cross-links the payee', async ({ page }) => {
  await mockPayments(page, {
    queue: [PAYMENT_A],
    detail: { [PAYMENT_A.id]: PAYMENT_A }
  });

  await page.goto('/');

  const context = page.getByTestId('payment-context');
  await expect(context).toBeVisible();
  await expect(context.getByRole('heading', { name: 'Why this matters' })).toBeVisible();
  await expect(context).toContainText(/disbursement leg/i);
  await expect(context).toContainText(/approval controls execution/i);
  await expect(context).toContainText(/source claim or policy is not present in this API slice/i);
  await expect(context.getByRole('link', { name: 'Payee party record' })).toHaveAttribute(
    'href',
    `/party?record=${PAYEE_A}`
  );

  await expect(page.getByTestId('summary-payee-link')).toHaveAttribute(
    'href',
    `/party?record=${PAYEE_A}`
  );
  await expect(page.getByTestId('record-payee-link')).toHaveAttribute(
    'href',
    `/party?record=${PAYEE_A}`
  );
  await expect(page.getByTestId('details-payee-link')).toHaveAttribute(
    'href',
    `/party?record=${PAYEE_A}`
  );

  await page.getByRole('tab', { name: 'Payment Details' }).click();
  await expect(page.getByTestId('detail-row-payee-link')).toHaveAttribute(
    'href',
    `/party?record=${PAYEE_A}`
  );
});

test('resolves the payee name · party number in the header, summary, Overview, and context panel', async ({ page }) => {
  const partyRequests = [];

  await mockPayments(page, {
    queue: [PAYMENT_A],
    detail: { [PAYMENT_A.id]: PAYMENT_A }
  });
  await page.route(/\/api\/v1\/parties\/[0-9a-f-]+$/i, async (route) => {
    const url = new URL(route.request().url());
    partyRequests.push({
      id: url.pathname.split('/').pop(),
      tenant: route.request().headers()['x-eia-tenant']
    });
    await json(route, 200, {
      id: PAYEE_A,
      tenantId: TENANT,
      partyNumber: 'PTY-000000001',
      partyType: 'ORGANIZATION',
      displayName: 'Acme Manufacturing',
      legalName: 'Acme Manufacturing, Inc.',
      status: 'ACTIVE'
    });
  });

  await page.goto('/');

  const label = 'Acme Manufacturing · PTY-000000001';
  const href = `/party?record=${PAYEE_A}`;

  await expect(page.getByTestId('record-payee-link')).toHaveText(label);
  await expect(page.getByTestId('record-payee-link')).toHaveAttribute('href', href);
  await expect(page.getByTestId('summary-payee-link')).toHaveText(label);
  await expect(page.getByTestId('summary-payee-link')).toHaveAttribute('href', href);
  await expect(page.getByTestId('details-payee-link')).toHaveText(label);
  await expect(page.getByTestId('details-payee-link')).toHaveAttribute('href', href);
  await expect(page.getByTestId('context-payee-link')).toContainText(label);
  await expect(page.getByTestId('context-payee-link')).toHaveAttribute('href', href);

  expect(partyRequests).toEqual([{ id: PAYEE_A, tenant: TENANT }]);
});

test('falls back to the short payee UUID when the Party API returns 404', async ({ page }) => {
  await mockPayments(page, {
    queue: [PAYMENT_A],
    detail: { [PAYMENT_A.id]: PAYMENT_A }
  });
  await page.route(/\/api\/v1\/parties\/[0-9a-f-]+$/i, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        status: 404,
        code: 'PARTY_NOT_FOUND',
        message: 'Party was not found'
      })
    });
  });

  await page.goto('/');

  // The payment record is rendered before and independent of party resolution.
  await expect(page.getByRole('heading', { name: PAYMENT_A.paymentNumber, level: 2 })).toBeVisible();

  const short = '22222222…';
  await expect(page.getByTestId('record-payee-link')).toHaveText(short);
  await expect(page.getByTestId('summary-payee-link')).toHaveText(short);
  await expect(page.getByTestId('details-payee-link')).toHaveText(short);
  await expect(page.getByTestId('context-payee-link')).toContainText(short);
  await expect(page.getByTestId('record-payee-link')).toHaveAttribute(
    'href',
    `/party?record=${PAYEE_A}`
  );
  await expect(page.getByTestId('context-payee-link')).toHaveAttribute(
    'href',
    `/party?record=${PAYEE_A}`
  );
});
