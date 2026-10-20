import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PAYMENT_ID = '33333333-3333-7333-8333-333333333333';
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

const DOCUMENT_A = {
  id: '77777777-7777-7777-8777-777777777777',
  tenantId: TENANT,
  documentNumber: 'DOC-2026-0101',
  title: 'Payment authority',
  documentType: 'PAYMENT_AUTHORITY',
  status: 'ACTIVE'
};

const DOCUMENT_B = {
  id: '88888888-8888-8888-8888-888888888888',
  tenantId: TENANT,
  documentNumber: 'DOC-2026-0102',
  title: 'Remittance advice',
  documentType: 'REMITTANCE',
  status: 'ARCHIVED'
};

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

/**
 * Mocks the payment queue, detail, party lookup, and linked-document list.
 * `gate` keeps the document response pending so a test can observe the record
 * while the Document API is still in flight.
 */
async function mockPaymentApi(page, {
  payments = [PAYMENT],
  documentsResponse = [],
  documentsStatus = 200,
  gate = null,
  onDocuments = null
} = {}) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/v1/payments') {
      await json(route, 200, payments);
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
    if (method === 'GET' && path === '/api/v1/documents') {
      if (onDocuments) onDocuments(request, url);
      if (gate) await gate;
      await json(route, documentsStatus, documentsResponse);
      return;
    }
    if (method === 'GET' && /^\/api\/v1\/parties\/[0-9a-f-]+$/i.test(path)) {
      await json(route, 404, { code: 'PARTY_NOT_FOUND', message: 'Party was not found' });
      return;
    }
    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });
}

test('loads linked documents for the selected payment with the filter and tenant header', async ({ page }) => {
  const requests = [];

  await mockPaymentApi(page, {
    documentsResponse: { items: [DOCUMENT_A, DOCUMENT_B] },
    onDocuments: (request, url) => {
      requests.push({
        path: url.pathname,
        linkedType: url.searchParams.get('linkedType'),
        linkedId: url.searchParams.get('linkedId'),
        tenant: request.headers()['x-eia-tenant']
      });
    }
  });

  await page.goto(`/?record=${PAYMENT_ID}`);

  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('documents-count')).toHaveText('2 documents');

  const table = page.getByTestId('documents-table');
  await expect(table.getByRole('cell', { name: 'DOC-2026-0101', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'Payment authority', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'PAYMENT_AUTHORITY', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'ACTIVE', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'DOC-2026-0102', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'REMITTANCE', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'ARCHIVED', exact: true })).toBeVisible();

  // Each document number opens the document workbench on that record.
  await expect(page.getByTestId('document-link-0')).toHaveText('DOC-2026-0101');
  await expect(page.getByTestId('document-link-0')).toHaveAttribute(
    'href',
    `/document?record=${DOCUMENT_A.id}`
  );
  await expect(page.getByTestId('document-link-1')).toHaveAttribute(
    'href',
    `/document?record=${DOCUMENT_B.id}`
  );

  // Existing summary and context cards remain in place.
  await expect(page.getByTestId('summary-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('payment-context')).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');

  expect(requests.length).toBeGreaterThan(0);
  expect(requests[0]).toEqual({
    path: '/api/v1/documents',
    linkedType: 'PAYMENT',
    linkedId: PAYMENT_ID,
    tenant: TENANT
  });
});

test('renders the empty state for a bare array response and keeps the record', async ({ page }) => {
  await mockPaymentApi(page, { documentsResponse: [] });

  await page.goto(`/?record=${PAYMENT_ID}`);

  await expect(page.getByTestId('documents-card')).toBeVisible();
  await expect(page.getByTestId('documents-count')).toHaveText('0 documents');
  await expect(page.getByTestId('documents-empty')).toHaveText('No documents are linked to this payment yet.');
  await expect(page.getByTestId('documents-card')).toContainText('Documents are evidence, not business facts');
  await expect(page.getByTestId('documents-table')).toHaveCount(0);

  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('payment-context')).toBeVisible();
});

test('contains a document error inside the card without disturbing the record', async ({ page }) => {
  await mockPaymentApi(page, {
    documentsStatus: 503,
    documentsResponse: {
      code: 'DOCUMENT_UNAVAILABLE',
      message: 'Document service unavailable'
    }
  });

  await page.goto(`/?record=${PAYMENT_ID}`);

  const error = page.getByTestId('documents-error');
  await expect(error).toContainText('DOCUMENT_UNAVAILABLE: Document service unavailable');
  await expect(error).toContainText('The payment record is unaffected.');
  await expect(page.getByTestId('documents-count')).toHaveText('—');
  await expect(page.getByTestId('documents-table')).toHaveCount(0);

  // The document failure never becomes a page-level alert or replaces the record.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('summary-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('payment-context')).toBeVisible();
});

test('renders the payment while a slow Document API is still in flight', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  await mockPaymentApi(page, {
    documentsResponse: [DOCUMENT_A, DOCUMENT_B],
    gate
  });

  await page.goto(`/?record=${PAYMENT_ID}`);

  // The record and its existing cards are usable before documents resolve.
  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('payment-context')).toBeVisible();
  await expect(page.getByTestId('documents-loading')).toHaveText('Loading linked documents…');
  await expect(page.getByTestId('documents-count')).toHaveText('…');

  release();

  await expect(page.getByTestId('documents-count')).toHaveText('2 documents');
  await expect(page.getByTestId('documents-table')).toBeVisible();
});
