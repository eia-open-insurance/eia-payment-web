import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const API = '**/api/v1/payments**';
const PARTY_ID = '99999999-9999-7999-8999-999999999999';

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
    payeePartyId: '22222222-2222-7222-8222-222222222222',
    paymentDate: '2026-10-19',
    version: 0,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
    ...overrides
  };
}

async function json(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

/**
 * The workbench resolves the payee through GET /api/v1/parties/{id} on every
 * selection. These scenarios assert the short-UUID fallback, so keep the Party
 * API deterministic instead of depending on a local domain service.
 */
test.beforeEach(async ({ page }) => {
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
});

test('renders the payment record layout, summary grid and lifecycle tabs', async ({ page }) => {
  const first = payment();
  const second = payment({
    id: '44444444-4444-7444-8444-444444444444',
    paymentNumber: 'PAY-2026-0044722',
    paymentType: 'DEFENSE_COST',
    status: 'PENDING_AUTHORITY',
    amount: '4200.5000',
    version: 1
  });
  const detailRequests = [];

  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/payments') {
      await json(route, 200, [first, second]);
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/payments/${first.id}`) {
      detailRequests.push(first.id);
      await json(route, 200, first);
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/payments/${second.id}`) {
      detailRequests.push(second.id);
      await json(route, 200, second);
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected ${method} ${url.pathname}` });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Payment', exact: true })).toBeVisible();
  await expect(page.getByText('Operations · Payment')).toBeVisible();
  await expect(page.getByText('Payment authority, approval, and issuance.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create payment' })).toBeVisible();
  await expect(page.locator('.eia-record-layout')).toBeVisible();
  await expect(page.locator('.eia-record-list')).toBeVisible();
  await expect(page.locator('.eia-record-panel')).toBeVisible();

  const firstRow = page.getByRole('button', { name: 'Open record PAY-2026-0044721' });
  await expect(firstRow).toBeVisible();
  await expect(firstRow).toContainText('INDEMNITY');
  await expect(firstRow).toContainText('$125,000.00');
  await expect(firstRow).toContainText('Payee 22222222…');
  await expect(firstRow).toContainText('DRAFT');
  await expect(page.getByRole('button', { name: 'Open record PAY-2026-0044722' })).toBeVisible();

  // The first record is selected and hydrated through GET /api/v1/payments/{id}.
  await expect(page.getByRole('heading', { name: 'PAY-2026-0044721', level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('record-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('payment-action')).toHaveText('Submit');
  expect(detailRequests).toContain(first.id);

  await expect(page.getByTestId('summary-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('summary-currency')).toHaveText('USD');
  await expect(page.getByTestId('summary-payee')).toHaveText('22222222…');
  await expect(page.getByTestId('summary-date')).toHaveText('2026-10-19');

  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Approval Path' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Payment Details' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Activity' })).toBeVisible();

  await page.getByRole('tab', { name: 'Approval Path' }).click();
  await expect(page.getByRole('tab', { name: 'Approval Path' })).toHaveAttribute('aria-selected', 'true');
  const approvalPanel = page.locator('#panel-approval');
  await expect(approvalPanel.getByRole('table')).toBeVisible();
  await expect(approvalPanel.getByText('PENDING_AUTHORITY')).toBeVisible();
  await expect(approvalPanel.getByText('Submitted for authority')).toBeVisible();
  await expect(approvalPanel.getByText('Current', { exact: true })).toBeVisible();
  await expect(approvalPanel.getByText(/Submit uses POST \/api\/v1\/payments\/\{id\}\/submit/)).toBeVisible();

  await page.getByRole('tab', { name: 'Payment Details' }).click();
  const detailsPanel = page.locator('#panel-details');
  await expect(detailsPanel.getByRole('table')).toContainText('Payment ID');
  await expect(detailsPanel.getByRole('table')).toContainText(first.id);
  await expect(detailsPanel.getByRole('table')).toContainText('125000.0000');
  await expect(detailsPanel.getByRole('table')).toContainText('2026-10-19T12:00:00Z');

  await page.getByRole('button', { name: 'Open record PAY-2026-0044722' }).click();
  await expect(page.getByRole('heading', { name: 'PAY-2026-0044722', level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('PENDING_AUTHORITY');
  await expect(page.getByTestId('payment-action')).toHaveText('Authorize');
  await expect(page.getByTestId('summary-amount')).toHaveText('$4,200.50');
  expect(detailRequests).toContain(second.id);
});

test('creates a payment from the modal and sends the tenant header', async ({ page }) => {
  const existing = payment();
  let payments = [existing];
  let created = null;
  let createPayload = null;
  let createHeaders = null;

  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/payments') {
      await json(route, 200, payments);
      return;
    }
    if (method === 'POST' && url.pathname === '/api/v1/payments') {
      createPayload = route.request().postDataJSON();
      createHeaders = route.request().headers();
      created = payment({
        id: '55555555-5555-7555-8555-555555555555',
        paymentNumber: 'PAY-2026-0044723',
        paymentType: createPayload.paymentType,
        amount: '250000.0000',
        currency: createPayload.currency,
        payeePartyId: createPayload.payeePartyId,
        paymentDate: createPayload.paymentDate,
        status: 'DRAFT',
        version: 0
      });
      payments = [created, ...payments];
      await json(route, 201, created);
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/payments/${existing.id}`) {
      await json(route, 200, existing);
      return;
    }
    if (method === 'GET' && created && url.pathname === `/api/v1/payments/${created.id}`) {
      await json(route, 200, created);
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected ${method} ${url.pathname}` });
  });

  await page.route('**/api/v1/parties/search**', async (route) => {
    await json(route, 200, { query: 'Meridian', limit: 8, items: [PARTY] });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Create payment' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Create payment' })).toBeVisible();

  await dialog.getByLabel('Payment type').selectOption('EXPENSE');
  await dialog.getByLabel('Amount').fill('250000');
  await dialog.getByLabel('Currency (ISO 4217)').fill('USD');
  await dialog.getByPlaceholder('Search party number or name…').fill('Meridian');
  await dialog.getByRole('button', { name: /PTY-2026-0001/ }).click();
  await expect(dialog.getByRole('link', { name: 'Open party record' })).toHaveAttribute(
    'href',
    `/party?record=${PARTY_ID}`
  );
  await expect(dialog.getByText('Meridian Manufacturing · ORGANIZATION')).toBeVisible();
  await dialog.getByLabel('Payment date').fill('2026-11-01');
  await dialog.getByRole('button', { name: 'Create payment' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('Created PAY-2026-0044723');
  await expect(page.getByRole('heading', { name: 'PAY-2026-0044723', level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('summary-amount')).toHaveText('$250,000.00');
  await expect(page.getByTestId('summary-date')).toHaveText('2026-11-01');

  expect(createHeaders['x-eia-tenant']).toBe(TENANT);
  expect(createPayload).toEqual({
    paymentType: 'EXPENSE',
    amount: '250000',
    currency: 'USD',
    payeePartyId: PARTY_ID,
    paymentDate: '2026-11-01'
  });
});

test('advances submit, authorize, approve and issue through the header action', async ({ page }) => {
  let current = payment();
  const calls = [];

  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/payments') {
      await json(route, 200, [current]);
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/payments/${current.id}`) {
      await json(route, 200, current);
      return;
    }
    const match = url.pathname.match(
      new RegExp(`^/api/v1/payments/${current.id}/(submit|authorize|approve|issue)$`)
    );
    if (method === 'POST' && match) {
      const action = match[1];
      calls.push(action);
      const transitions = {
        submit: { status: 'PENDING_AUTHORITY', version: 1 },
        authorize: { status: 'AUTHORIZED', version: 2 },
        approve: { status: 'APPROVED', version: 3 },
        issue: { status: 'SUBMITTED', version: 5 }
      };
      current = { ...current, ...transitions[action], updatedAt: '2026-10-19T13:00:00Z' };
      await json(route, 200, current);
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected ${method} ${url.pathname}` });
  });

  await page.goto('/');
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('payment-action')).toHaveText('Submit');

  await page.getByTestId('payment-action').click();
  await expect(page.getByRole('status')).toContainText('submitted for authority');
  await expect(page.getByTestId('payment-status')).toHaveText('PENDING_AUTHORITY');
  await expect(page.getByTestId('payment-action')).toHaveText('Authorize');

  await page.getByTestId('payment-action').click();
  await expect(page.getByRole('status')).toContainText('authorized');
  await expect(page.getByTestId('payment-status')).toHaveText('AUTHORIZED');
  await expect(page.getByTestId('payment-action')).toHaveText('Approve');

  await page.getByTestId('payment-action').click();
  await expect(page.getByRole('status')).toContainText('approved for issuance');
  await expect(page.getByTestId('payment-status')).toHaveText('APPROVED');
  await expect(page.getByTestId('payment-action')).toHaveText('Issue');

  await page.getByTestId('payment-action').click();
  await expect(page.getByRole('status')).toContainText('issued to SAP/bank');
  await expect(page.getByTestId('payment-status')).toHaveText('SUBMITTED');
  await expect(page.getByTestId('payment-action-none')).toHaveText('No action');

  expect(calls).toEqual(['submit', 'authorize', 'approve', 'issue']);
});

test('renders a Payment API problem error when an action is rejected', async ({ page }) => {
  const draft = payment();

  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/payments') {
      await json(route, 200, [draft]);
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/payments/${draft.id}`) {
      await json(route, 200, draft);
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/payments/${draft.id}/submit`) {
      await route.fulfill({
        status: 400,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          timestamp: '2026-10-19T12:30:00Z',
          status: 400,
          code: 'INVALID_STATUS_TRANSITION',
          message: 'Cannot submit a payment in status PENDING_AUTHORITY; expected DRAFT',
          path: `/api/v1/payments/${draft.id}/submit`,
          details: []
        })
      });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected ${method} ${url.pathname}` });
  });

  await page.goto('/');
  await page.getByTestId('payment-action').click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText(
    'INVALID_STATUS_TRANSITION: Cannot submit a payment in status PENDING_AUTHORITY; expected DRAFT'
  );
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
});

test('renders Payment API validation details inside the create modal', async ({ page }) => {
  const existing = payment();

  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/payments') {
      await json(route, 200, [existing]);
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/payments/${existing.id}`) {
      await json(route, 200, existing);
      return;
    }
    if (method === 'POST' && url.pathname === '/api/v1/payments') {
      await route.fulfill({
        status: 400,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          timestamp: '2026-10-19T12:30:00Z',
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Payment validation failed',
          path: '/api/v1/payments',
          details: [
            { field: 'payeePartyId', message: 'payee party is not active' }
          ]
        })
      });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected ${method} ${url.pathname}` });
  });

  await page.route('**/api/v1/parties/search**', async (route) => {
    await json(route, 200, { query: 'PTY', limit: 8, items: [PARTY] });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Create payment' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount').fill('1250.00');
  await dialog.getByPlaceholder('Search party number or name…').fill('PTY-2026');
  await dialog.getByRole('button', { name: /PTY-2026-0001/ }).click();
  await dialog.getByRole('button', { name: 'Create payment' }).click();

  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText('VALIDATION_ERROR: Payment validation failed');
  await expect(alert).toContainText('payeePartyId: payee party is not active');
  await expect(dialog).toBeVisible();
});
