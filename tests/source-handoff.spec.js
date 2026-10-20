import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PAYEE_ID = '99999999-9999-7999-8999-999999999999';
const DIRECT_CLAIM_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const ASSUMED_CLAIM_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const POLICY_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const CREATED_ID = '55555555-5555-7555-8555-555555555555';

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

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

/**
 * Mocks the payment queue, detail, and create endpoints. Detail lookups fall
 * back to the queue so every row remains selectable.
 */
async function mockPayments(page, { queue = [], onCreate } = {}) {
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
      const found = !id.includes('/') && rows.find((row) => row.id === id);
      if (found) {
        await json(route, 200, found);
        return;
      }
      await json(route, 404, {
        status: 404,
        code: 'PAYMENT_NOT_FOUND',
        message: `Payment ${id} was not found`
      });
      return;
    }
    if (method === 'POST' && url.pathname === '/api/v1/payments') {
      const payload = request.postDataJSON();
      const created = payment({
        id: CREATED_ID,
        paymentNumber: 'PAY-2026-0044723',
        paymentType: payload.paymentType,
        amount: payload.amount,
        currency: payload.currency,
        payeePartyId: payload.payeePartyId,
        paymentDate: payload.paymentDate,
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
        sourceReference: payload.sourceReference,
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
}

/** Resolves any party UUID to the canonical `name · party number` label. */
async function mockPartyLookup(page, requests = []) {
  await page.route(/\/api\/v1\/parties\/[0-9a-f-]+$/i, async (route) => {
    const url = new URL(route.request().url());
    requests.push({
      path: url.pathname,
      tenant: route.request().headers()['x-eia-tenant']
    });
    await json(route, 200, {
      id: PAYEE_ID,
      tenantId: TENANT,
      partyNumber: 'PTY-000000001',
      partyType: 'ORGANIZATION',
      displayName: 'Acme Manufacturing',
      status: 'ACTIVE'
    });
  });
}

test('?new=1 hand-off prefills the dialog and submits the source, amount, and payee', async ({ page }) => {
  let create = null;
  const partyRequests = [];

  await mockPayments(page, {
    queue: [payment()],
    onCreate: (entry) => {
      create = entry;
    }
  });
  await mockPartyLookup(page, partyRequests);

  await page.goto(
    `/?new=1&sourceType=DIRECT_CLAIM&sourceId=${DIRECT_CLAIM_ID}`
    + `&sourceReference=CLM-2026-0001234&amount=4200.50&currency=usd`
    + `&payeePartyId=${PAYEE_ID}`
  );

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Create payment' })).toBeVisible();

  // Amount, currency, and payee come from the hand-off; the payee label is
  // resolved through the Party API instead of showing only a UUID.
  await expect(dialog.getByLabel('Amount')).toHaveValue('4200.50');
  await expect(dialog.getByLabel('Currency (ISO 4217)')).toHaveValue('USD');
  await expect(dialog.getByText('Acme Manufacturing · PTY-000000001')).toBeVisible();
  await expect(dialog.getByTestId('payee-picker-link')).toHaveAttribute(
    'href',
    `/party?record=${PAYEE_ID}`
  );
  expect(partyRequests).toContainEqual({
    path: `/api/v1/parties/${PAYEE_ID}`,
    tenant: TENANT
  });

  // A prefilled source shows the record card, submits hidden fields, and hides
  // the optional manual source fields.
  const card = dialog.getByTestId('create-source-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Source record' })).toBeVisible();
  await expect(dialog.getByTestId('create-source-type')).toContainText('Direct claim');
  await expect(dialog.getByTestId('create-source-type')).toContainText('DIRECT_CLAIM');
  await expect(dialog.getByTestId('create-source-reference')).toHaveText('CLM-2026-0001234');
  await expect(dialog.getByTestId('create-source-link')).toHaveAttribute(
    'href',
    `/direct-claims?record=${DIRECT_CLAIM_ID}`
  );
  await expect(dialog.getByTestId('source-type-hidden')).toHaveValue('DIRECT_CLAIM');
  await expect(dialog.getByTestId('source-id-hidden')).toHaveValue(DIRECT_CLAIM_ID);
  await expect(dialog.getByTestId('source-reference-hidden')).toHaveValue(
    'CLM-2026-0001234'
  );
  await expect(dialog.getByTestId('manual-source')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Create payment' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'PAY-2026-0044723', level: 2 })).toBeVisible();
  await expect(page.getByTestId('record-source-link')).toHaveAttribute(
    'href',
    `/direct-claims?record=${DIRECT_CLAIM_ID}`
  );

  expect(create.headers['x-eia-tenant']).toBe(TENANT);
  expect(create.payload.paymentType).toBe('INDEMNITY');
  expect(create.payload.amount).toBe('4200.50');
  expect(create.payload.currency).toBe('USD');
  expect(create.payload.payeePartyId).toBe(PAYEE_ID);
  expect(create.payload.sourceType).toBe('DIRECT_CLAIM');
  expect(create.payload.sourceId).toBe(DIRECT_CLAIM_ID);
  expect(create.payload.sourceReference).toBe('CLM-2026-0001234');
  expect(create.payload.paymentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('Record Overview routes the source link by DIRECT_CLAIM, ASSUMED_CLAIM, and POLICY', async ({ page }) => {
  const cases = [
    {
      type: 'DIRECT_CLAIM',
      route: 'direct-claims',
      sourceId: DIRECT_CLAIM_ID,
      reference: 'CLM-2026-0001234',
      paymentId: '11111111-1111-7111-8111-111111111111',
      paymentNumber: 'PAY-2026-0044731'
    },
    {
      type: 'ASSUMED_CLAIM',
      route: 'assumed-claims',
      sourceId: ASSUMED_CLAIM_ID,
      reference: 'ACL-2026-0000456',
      paymentId: '22222222-2222-7222-8222-222222222222',
      paymentNumber: 'PAY-2026-0044732'
    },
    {
      type: 'POLICY',
      route: 'policy',
      sourceId: POLICY_ID,
      reference: 'POL-2026-0000789',
      paymentId: '33333333-3333-7333-8333-333333333333',
      paymentNumber: 'PAY-2026-0044733'
    }
  ];

  const rows = cases.map((entry) => payment({
    id: entry.paymentId,
    paymentNumber: entry.paymentNumber,
    sourceType: entry.type,
    sourceId: entry.sourceId,
    sourceReference: entry.reference
  }));

  await mockPayments(page, { queue: rows });
  await mockPartyLookup(page);
  await page.goto('/');

  for (const [index, entry] of cases.entries()) {
    const href = `/${entry.route}?record=${entry.sourceId}`;
    const row = page.getByRole('button', { name: `Open record ${entry.paymentNumber}` });
    await row.click();

    await expect(page.getByRole('heading', { name: entry.paymentNumber, level: 2 })).toBeVisible();
    await expect(page.getByTestId(`queue-source-${entry.paymentId}`)).toContainText(entry.reference);
    await expect(page.getByTestId('record-source')).toContainText(entry.reference);
    await expect(page.getByTestId('record-source-link')).toHaveAttribute('href', href);
    await expect(page.getByTestId('overview-source')).toContainText(entry.reference);
    await expect(page.getByTestId('overview-source-link')).toHaveAttribute('href', href);
    await expect(page.getByTestId('context-source-link')).toHaveAttribute('href', href);
  }
});

test('clearing a prefilled source omits the hand-off fields from the create payload', async ({ page }) => {
  let create = null;

  await mockPayments(page, {
    queue: [payment()],
    onCreate: (entry) => {
      create = entry;
    }
  });
  await mockPartyLookup(page);

  await page.goto(
    `/?new=1&sourceType=POLICY&sourceId=${POLICY_ID}`
    + `&sourceReference=POL-2026-0000789&amount=900&currency=USD`
    + `&payeePartyId=${PAYEE_ID}`
  );

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('create-source-card')).toBeVisible();
  await dialog.getByTestId('clear-source').click();

  await expect(dialog.getByTestId('create-source-card')).toHaveCount(0);
  await expect(dialog.getByTestId('source-type-hidden')).toHaveCount(0);
  await expect(dialog.getByTestId('source-id-hidden')).toHaveCount(0);
  await expect(dialog.getByTestId('source-reference-hidden')).toHaveCount(0);
  await expect(dialog.getByTestId('manual-source')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Create payment' }).click();
  await expect(dialog).toBeHidden();

  expect(create).not.toBeNull();
  expect(create.payload).not.toHaveProperty('sourceType');
  expect(create.payload).not.toHaveProperty('sourceId');
  expect(create.payload).not.toHaveProperty('sourceReference');
});

test('manual source fields stay optional when no hand-off is supplied', async ({ page }) => {
  let create = null;

  await mockPayments(page, {
    queue: [payment()],
    onCreate: (entry) => {
      create = entry;
    }
  });
  await mockPartyLookup(page);

  await page.goto(`/?new=1&amount=700&currency=USD&payeePartyId=${PAYEE_ID}`);

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('manual-source')).toBeVisible();
  await expect(dialog.getByTestId('create-source-card')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Create payment' }).click();
  await expect(dialog).toBeHidden();

  expect(create).not.toBeNull();
  expect(create.payload).toEqual({
    paymentType: 'INDEMNITY',
    amount: '700',
    currency: 'USD',
    payeePartyId: PAYEE_ID,
    paymentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
  });
});

test('manual source validates the type and id pair before creating the payment', async ({ page }) => {
  const creates = [];

  await mockPayments(page, {
    queue: [payment()],
    onCreate: (entry) => {
      creates.push(entry);
    }
  });
  await mockPartyLookup(page);

  await page.goto(`/?new=1&amount=500&currency=USD&payeePartyId=${PAYEE_ID}`);

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('manual-source')).toBeVisible();

  // A classified source requires its record id.
  await dialog.getByLabel('Source type').selectOption('DIRECT_CLAIM');
  await dialog.getByRole('button', { name: 'Create payment' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Enter the source record id');
  expect(creates).toHaveLength(0);

  // The id must be a UUID.
  await dialog.getByLabel('Source record id').fill('not-a-uuid');
  await dialog.getByRole('button', { name: 'Create payment' }).click();
  await expect(dialog.getByRole('alert')).toContainText('must be a UUID');
  expect(creates).toHaveLength(0);

  // An id without a type is also an incomplete pair.
  await dialog.getByLabel('Source type').selectOption('');
  await dialog.getByLabel('Source record id').fill(POLICY_ID);
  await dialog.getByRole('button', { name: 'Create payment' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Select a source type');
  expect(creates).toHaveLength(0);

  // A complete pair plus its human reference creates the payment.
  await dialog.getByLabel('Source type').selectOption('POLICY');
  await dialog.getByLabel('Source reference').fill('POL-2026-0000789');
  await expect(dialog.getByTestId('source-type-hidden')).toHaveValue('POLICY');
  await dialog.getByRole('button', { name: 'Create payment' }).click();

  await expect(dialog).toBeHidden();
  expect(creates).toHaveLength(1);
  expect(creates[0].payload).toEqual({
    paymentType: 'INDEMNITY',
    amount: '500',
    currency: 'USD',
    payeePartyId: PAYEE_ID,
    paymentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    sourceType: 'POLICY',
    sourceId: POLICY_ID,
    sourceReference: 'POL-2026-0000789'
  });
});
