import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PAYMENT_ID = '33333333-3333-7333-8333-333333333333';
const PAYEE_ID = '22222222-2222-7222-8222-222222222222';
const CLAIM_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const CLAIM_2_ID = 'abababab-abab-7aba-8aba-abababababab';
const ASSUMED_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const POLICY_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';

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

function allocation(overrides = {}) {
  return {
    id: 'e1111111-1111-7111-8111-111111111111',
    targetType: 'DIRECT_CLAIM',
    targetId: CLAIM_ID,
    targetReference: 'CLM-2026-0000001',
    component: 'INDEMNITY',
    amount: '50000.0000',
    currency: 'USD',
    createdAt: '2026-10-20T12:00:00Z',
    ...overrides
  };
}

const DIRECT = allocation();
const ASSUMED = allocation({
  id: 'e2222222-2222-7222-8222-222222222222',
  targetType: 'ASSUMED_CLAIM',
  targetId: ASSUMED_ID,
  targetReference: 'AC-2026-0000077',
  component: 'ALAE',
  amount: '15000.0000',
  createdAt: '2026-10-20T12:05:00Z'
});
const POLICY = allocation({
  id: 'e3333333-3333-7333-8333-333333333333',
  targetType: 'POLICY',
  targetId: POLICY_ID,
  targetReference: 'POL-2026-0000123',
  component: 'DEFENSE',
  amount: '10000.0000',
  createdAt: '2026-10-20T12:10:00Z'
});

const CLAIM_SEARCH_ITEM = {
  id: CLAIM_ID,
  type: 'DIRECT_CLAIM',
  label: 'CLM-2026-0000001',
  secondary: 'AUTO · OPEN',
  status: 'OPEN',
  href: `/direct-claims?record=${CLAIM_ID}`
};
const CLAIM_2_SEARCH_ITEM = {
  id: CLAIM_2_ID,
  type: 'DIRECT_CLAIM',
  label: 'CLM-2026-0000002',
  secondary: 'AUTO · OPEN',
  status: 'OPEN',
  href: `/direct-claims?record=${CLAIM_2_ID}`
};
const ASSUMED_SEARCH_ITEM = {
  id: ASSUMED_ID,
  type: 'ASSUMED_CLAIM',
  label: 'AC-2026-0000077',
  secondary: 'TREATY · OPEN',
  status: 'OPEN',
  href: `/assumed-claims?record=${ASSUMED_ID}`
};
const POLICY_SEARCH_ITEM = {
  id: POLICY_ID,
  type: 'POLICY',
  label: 'POL-2026-0000123',
  secondary: 'GL · ACTIVE',
  status: 'ACTIVE',
  href: `/policy?record=${POLICY_ID}`
};

const SEARCH_ITEMS = {
  '/api/v1/claims/search': [CLAIM_SEARCH_ITEM, CLAIM_2_SEARCH_ITEM],
  '/api/v1/assumed-claims/search': [ASSUMED_SEARCH_ITEM],
  '/api/v1/policies/search': [POLICY_SEARCH_ITEM]
};

function defaultSearch(path, q) {
  const needle = String(q || '').toLowerCase();
  return {
    query: q,
    limit: 8,
    items: (SEARCH_ITEMS[path] || []).filter((item) => (
      [item.id, item.label, item.secondary]
        .some((value) => String(value || '').toLowerCase().includes(needle))
    ))
  };
}

function allocationReversed(row) {
  return Boolean(
    row.reversed ||
    row.reversedAt ||
    row.reversalReason ||
    String(row.status || '').toUpperCase() === 'REVERSED'
  );
}

/**
 * Mirrors the Payment API's post-reversal summary: gross `totalAllocated`,
 * `totalReversed`, `netAllocated`, and `unallocated` (payment minus net). The
 * rows keep every split, reversed or not, because the ledger is append-only.
 */
function summaryBody(rows) {
  const allocated = rows.reduce((total, row) => total + Number(row.amount || 0), 0);
  const reversed = rows
    .filter(allocationReversed)
    .reduce((total, row) => total + Number(row.amount || 0), 0);
  const net = allocated - reversed;
  return {
    items: rows,
    paymentAmount: Number(PAYMENT.amount).toFixed(4),
    totalAllocated: allocated.toFixed(4),
    totalReversed: reversed.toFixed(4),
    netAllocated: net.toFixed(4),
    unallocated: (Number(PAYMENT.amount) - net).toFixed(4),
    count: rows.length,
    reversedCount: rows.filter(allocationReversed).length,
    currency: PAYMENT.currency
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
 * Mocks the payment record plus the allocation collection, its three target
 * searches, documents, events, and party lookup. `state` is mutable so a test
 * can change the ledger between requests (retry, conflict reload) without
 * registering a second route.
 */
async function installMocks(page, {
  allocations = [],
  getStatus = 200,
  getErrorBody = {
    code: 'ALLOCATION_LEDGER_UNAVAILABLE',
    message: 'Allocation service unavailable'
  },
  postStatus = 201,
  postBody = null,
  reverseStatus = 200,
  reverseBody = null,
  gate = null,
  getBody = null,
  search = defaultSearch
} = {}) {
  const state = {
    allocations: allocations.map((row) => ({ ...row })),
    getStatus,
    getErrorBody,
    postStatus,
    postBody,
    reverseStatus,
    reverseBody,
    gate,
    getBody,
    search,
    getCalls: 0,
    requests: [],
    posts: [],
    reversals: [],
    searchCalls: []
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const headers = request.headers();

    state.requests.push({
      method,
      path,
      q: url.searchParams.get('q'),
      tenant: headers['x-eia-tenant'],
      book: headers['x-eia-book']
    });

    if (method === 'GET' && path === '/api/v1/payments') {
      await json(route, 200, [PAYMENT]);
      return;
    }

    const reverseMatch = path.match(
      /^\/api\/v1\/payments\/([^/]+)\/allocations\/([^/]+)\/reverse$/
    );
    if (reverseMatch && method === 'POST') {
      const allocationId = decodeURIComponent(reverseMatch[2]);
      const payload = request.postDataJSON();
      state.reversals.push({ allocationId, payload, path, tenant: headers['x-eia-tenant'] });
      if (state.reverseStatus >= 400) {
        await json(route, state.reverseStatus, state.reverseBody || {
          code: 'ALLOCATION_ALREADY_REVERSED',
          message: 'Allocation is already reversed'
        });
        return;
      }
      const index = state.allocations.findIndex(
        (row) => String(row.id || row.allocationId) === allocationId
      );
      if (index < 0) {
        await json(route, 404, { code: 'ALLOCATION_NOT_FOUND', message: 'Allocation was not found' });
        return;
      }
      const updated = {
        ...state.allocations[index],
        reversedAt: '2026-10-22T09:30:00Z',
        reversalReason: payload.reason,
        ...(state.reverseBody || {})
      };
      state.allocations = state.allocations.map((row, rowIndex) => (
        rowIndex === index ? updated : row
      ));
      await json(route, 200, updated);
      return;
    }

    if (/^\/api\/v1\/payments\/[^/]+\/allocations$/.test(path)) {
      if (method === 'GET') {
        state.getCalls += 1;
        if (state.gate) await state.gate.promise;
        if (state.getStatus !== 200) {
          await json(route, state.getStatus, state.getErrorBody);
          return;
        }
        const body = state.getBody ? state.getBody(state) : summaryBody(state.allocations);
        await json(route, 200, body);
        return;
      }
      if (method === 'POST') {
        const payload = request.postDataJSON();
        state.posts.push({ payload, path, tenant: headers['x-eia-tenant'] });
        if (state.postStatus >= 400) {
          await json(route, state.postStatus, state.postBody || {
            code: 'ALLOCATION_REJECTED',
            message: 'Allocation rejected'
          });
          return;
        }
        const created = {
          id: 'e9999999-9999-7999-8999-999999999999',
          ...payload,
          currency: PAYMENT.currency,
          createdAt: '2026-10-20T13:00:00Z'
        };
        state.allocations = [...state.allocations, created];
        await json(route, 201, state.postBody || created);
        return;
      }
    }

    if (method === 'GET' && SEARCH_ITEMS[path]) {
      state.searchCalls.push({
        path,
        q: url.searchParams.get('q'),
        tenant: headers['x-eia-tenant'],
        book: headers['x-eia-book']
      });
      await json(route, 200, state.search(path, url.searchParams.get('q') || ''));
      return;
    }

    if (method === 'GET' && path === `/api/v1/payments/${PAYMENT_ID}`) {
      await json(route, 200, PAYMENT);
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
    if (method === 'GET' && path.startsWith('/api/v1/parties/')) {
      await json(route, 404, { code: 'PARTY_NOT_FOUND', message: 'Party was not found' });
      return;
    }
    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });

  return state;
}

async function openAllocations(page) {
  await page.getByRole('tab', { name: 'Allocations' }).click();
}

async function openAddAllocation(page) {
  await page.getByTestId('allocation-add').click();
  const dialog = page.getByTestId('allocation-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function pickDirectClaim(dialog, term = 'CLM') {
  await dialog.getByPlaceholder('Search direct claim number…').fill(term);
  await dialog.getByRole('button', { name: /CLM-2026-0000001/ }).click();
}

test('renders the allocation summary, ledger columns, and target links', async ({ page }) => {
  const state = await installMocks(page, { allocations: [DIRECT, ASSUMED, POLICY] });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openAllocations(page);

  await expect(page.getByTestId('allocations-payment-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('allocations-net-amount')).toHaveText('$75,000.00');
  await expect(page.getByTestId('allocations-reversed-amount')).toHaveText('$0.00');
  await expect(page.getByTestId('allocations-remaining-amount')).toHaveText('$50,000.00');
  await expect(page.getByTestId('allocations-count')).toHaveText('3');
  await expect(page.getByTestId('record-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('allocation-ledger-count')).toHaveText('3 rows');
  await expect(page.getByTestId('allocation-active-badge-0')).toHaveText('ACTIVE');
  await expect(page.getByTestId('allocation-reversed-badge-0')).toHaveCount(0);
  await expect(page.getByTestId('allocation-reverse-0')).toBeVisible();

  const table = page.getByTestId('allocations-table');
  await expect(table).toBeVisible();

  await expect(page.getByTestId('allocation-target-type-0')).toHaveText('DIRECT_CLAIM');
  await expect(page.getByTestId('allocation-target-link-0')).toHaveText('CLM-2026-0000001');
  await expect(page.getByTestId('allocation-target-link-0')).toHaveAttribute(
    'href',
    `/direct-claims?record=${CLAIM_ID}`
  );
  await expect(page.getByTestId('allocation-component-0')).toHaveText('INDEMNITY');
  await expect(page.getByTestId('allocation-amount-0')).toHaveText('$50,000.00');
  await expect(page.getByTestId('allocation-created-0')).toHaveText('2026-10-20T12:00:00Z');

  await expect(page.getByTestId('allocation-target-type-1')).toHaveText('ASSUMED_CLAIM');
  await expect(page.getByTestId('allocation-target-link-1')).toHaveText('AC-2026-0000077');
  await expect(page.getByTestId('allocation-target-link-1')).toHaveAttribute(
    'href',
    `/assumed-claims?record=${ASSUMED_ID}`
  );
  await expect(page.getByTestId('allocation-amount-1')).toHaveText('$15,000.00');

  await expect(page.getByTestId('allocation-target-type-2')).toHaveText('POLICY');
  await expect(page.getByTestId('allocation-target-link-2')).toHaveText('POL-2026-0000123');
  await expect(page.getByTestId('allocation-target-link-2')).toHaveAttribute(
    'href',
    `/policy?record=${POLICY_ID}`
  );
  await expect(page.getByTestId('allocation-amount-2')).toHaveText('$10,000.00');

  expect(state.getCalls).toBe(1);
  const get = state.requests.find(
    (entry) => entry.method === 'GET' && entry.path === `/api/v1/payments/${PAYMENT_ID}/allocations`
  );
  expect(get).toMatchObject({
    path: `/api/v1/payments/${PAYMENT_ID}/allocations`,
    tenant: TENANT
  });
});

test('shows reversed allocations with their reason and date and keeps the split auditable', async ({ page }) => {
  const reversed = allocation({
    reversedAt: '2026-10-21T15:45:00Z',
    reversalReason: 'Duplicate settlement release'
  });
  const active = allocation({
    id: 'e7777777-7777-7777-8777-777777777777',
    targetType: 'POLICY',
    targetId: POLICY_ID,
    targetReference: 'POL-2026-0000123',
    component: 'DEFENSE',
    amount: '25000.0000',
    createdAt: '2026-10-21T16:00:00Z'
  });

  await installMocks(page, { allocations: [reversed, active] });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openAllocations(page);

  // Net allocated excludes the reversed split; the reversed total and remaining
  // balance report the reversal without removing the original row.
  await expect(page.getByTestId('allocations-net-amount')).toHaveText('$25,000.00');
  await expect(page.getByTestId('allocations-reversed-amount')).toHaveText('$50,000.00');
  await expect(page.getByTestId('allocations-remaining-amount')).toHaveText('$100,000.00');
  await expect(page.getByTestId('allocations-count')).toHaveText('2');
  await expect(page.getByTestId('allocation-ledger-count')).toHaveText('2 rows · 1 reversed');

  const row = page.getByTestId('allocation-row-0');
  await expect(row).toHaveAttribute('data-reversed', 'true');
  await expect(page.getByTestId('allocation-reversed-badge-0')).toHaveText('REVERSED');
  await expect(page.getByTestId('allocation-reversed-reason-0')).toHaveText(
    'Duplicate settlement release'
  );
  await expect(page.getByTestId('allocation-reversed-at-0')).toHaveText(
    '2026-10-21T15:45:00Z'
  );
  // The original split is evidence: target, component, and amount stay visible.
  await expect(page.getByTestId('allocation-target-link-0')).toHaveText('CLM-2026-0000001');
  await expect(page.getByTestId('allocation-component-0')).toHaveText('INDEMNITY');
  await expect(page.getByTestId('allocation-amount-0')).toHaveText('$50,000.00');
  await expect(page.getByTestId('allocation-reverse-0')).toHaveCount(0);
  await expect(page.getByTestId('allocation-reversed-locked-0')).toHaveText('Reversed');

  // An active split still offers the reversal action.
  await expect(page.getByTestId('allocation-active-badge-1')).toHaveText('ACTIVE');
  await expect(page.getByTestId('allocation-reverse-1')).toBeEnabled();
});

test('reverses an allocation with a required reason and posts the trimmed payload', async ({ page }) => {
  const state = await installMocks(page, { allocations: [DIRECT, ASSUMED, POLICY] });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openAllocations(page);

  await expect(page.getByTestId('allocations-net-amount')).toHaveText('$75,000.00');
  await page.getByTestId('allocation-reverse-0').click();

  const dialog = page.getByTestId('allocation-reverse-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('allocation-reverse-context')).toContainText(
    'never deleted'
  );

  // A blank reason is rejected locally: no reversal request is sent.
  await dialog.getByTestId('allocation-reverse-submit').click();
  await expect(dialog.getByTestId('allocation-reverse-form-error')).toHaveText(
    'A reason is required to reverse an allocation.'
  );
  expect(state.reversals).toHaveLength(0);

  // The reason field is bounded to the API's 200-character maximum.
  await expect(dialog.getByTestId('allocation-reverse-reason')).toHaveAttribute(
    'maxlength',
    '200'
  );

  await dialog.getByTestId('allocation-reverse-reason').fill('  Duplicate settlement  ');
  await dialog.getByTestId('allocation-reverse-submit').click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('allocations-status')).toContainText(
    'Reversed $50,000.00 allocation to CLM-2026-0000001.'
  );
  await expect(page.getByTestId('allocations-status')).toContainText(
    'The original split remains on the ledger.'
  );

  expect(state.reversals).toHaveLength(1);
  expect(state.reversals[0]).toEqual({
    allocationId: DIRECT.id,
    path: `/api/v1/payments/${PAYMENT_ID}/allocations/${DIRECT.id}/reverse`,
    tenant: TENANT,
    payload: { reason: 'Duplicate settlement' }
  });

  // The same row is now reversed in place: the amount, target, and component
  // are untouched, and the stamped reason and date are visible.
  await expect(page.getByTestId('allocation-row-0')).toHaveAttribute('data-reversed', 'true');
  await expect(page.getByTestId('allocation-reversed-badge-0')).toHaveText('REVERSED');
  await expect(page.getByTestId('allocation-reversed-reason-0')).toHaveText(
    'Duplicate settlement'
  );
  await expect(page.getByTestId('allocation-reversed-at-0')).toHaveText(
    '2026-10-22T09:30:00Z'
  );
  await expect(page.getByTestId('allocation-amount-0')).toHaveText('$50,000.00');
  await expect(page.getByTestId('allocation-target-link-0')).toHaveText('CLM-2026-0000001');
  await expect(page.getByTestId('allocation-reverse-0')).toHaveCount(0);
  await expect(page.getByTestId('allocation-reversed-locked-0')).toHaveText('Reversed');
  await expect(page.getByTestId('allocation-row-1')).toHaveCount(1);

  // Net allocated falls by the reversed amount; remaining rises and the count
  // still includes the reversed split.
  await expect(page.getByTestId('allocations-net-amount')).toHaveText('$25,000.00');
  await expect(page.getByTestId('allocations-reversed-amount')).toHaveText('$50,000.00');
  await expect(page.getByTestId('allocations-remaining-amount')).toHaveText('$100,000.00');
  await expect(page.getByTestId('allocations-count')).toHaveText('3');
  await expect(page.getByTestId('allocation-ledger-count')).toHaveText('3 rows · 1 reversed');

  // Reversing a split never changes the payment or its approval path.
  await expect(page.getByTestId('record-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('allocation-add')).toBeEnabled();
});

test('keeps the reversal dialog open when the allocation is already reversed', async ({ page }) => {
  const state = await installMocks(page, {
    allocations: [DIRECT],
    reverseStatus: 409,
    reverseBody: {
      code: 'ALLOCATION_ALREADY_REVERSED',
      message: 'Allocation is already reversed'
    }
  });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openAllocations(page);
  await page.getByTestId('allocation-reverse-0').click();

  const dialog = page.getByTestId('allocation-reverse-dialog');
  await dialog.getByTestId('allocation-reverse-reason').fill('Second attempt');
  await dialog.getByTestId('allocation-reverse-submit').click();

  // A repeat reversal is a conflict: the dialog stays open with the problem and
  // a reload hint, and the ledger is not mutated locally.
  await expect(dialog).toBeVisible();
  const error = dialog.getByTestId('allocation-reverse-error');
  await expect(error).toContainText(
    'ALLOCATION_ALREADY_REVERSED: Allocation is already reversed'
  );
  await expect(error).toContainText('reload the allocations');
  expect(state.reversals).toHaveLength(1);
  expect(state.reversals[0]).toMatchObject({
    allocationId: DIRECT.id,
    payload: { reason: 'Second attempt' }
  });

  await expect(page.getByTestId('allocation-active-badge-0')).toHaveText('ACTIVE');
  await expect(page.getByTestId('allocation-reverse-0')).toBeVisible();
  await expect(page.getByTestId('allocation-reversed-badge-0')).toHaveCount(0);
  await expect(page.getByTestId('allocations-net-amount')).toHaveText('$50,000.00');
  await expect(page.getByTestId('allocations-reversed-amount')).toHaveText('$0.00');
  await expect(page.getByTestId('allocations-remaining-amount')).toHaveText('$75,000.00');
  await expect(dialog.getByTestId('allocation-reverse-submit')).toBeEnabled();
});

test('resolves a bare target id through predictive search and falls back to the short id', async ({ page }) => {
  const resolved = allocation({ targetReference: undefined, amount: '25000.0000' });
  const unresolved = allocation({
    id: 'e4444444-4444-7444-8444-444444444444',
    targetType: 'ASSUMED_CLAIM',
    targetId: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
    targetReference: undefined,
    component: 'EXPENSE',
    amount: '5000.0000'
  });

  const state = await installMocks(page, {
    allocations: [resolved, unresolved],
    getBody: (current) => current.allocations
  });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openAllocations(page);

  // The claims search returns this record for its id, so the canonical label wins.
  await expect(page.getByTestId('allocation-target-link-0')).toHaveText('CLM-2026-0000001');
  // The assumed search has no matching id: the short UUID remains.
  await expect(page.getByTestId('allocation-target-link-1')).toHaveText('dddddddd…');

  await expect(page.getByTestId('allocations-net-amount')).toHaveText('$30,000.00');
  await expect(page.getByTestId('allocations-remaining-amount')).toHaveText('$95,000.00');
  await expect(page.getByTestId('allocations-count')).toHaveText('2');

  const claimSearch = state.searchCalls.find((entry) => entry.path === '/api/v1/claims/search');
  expect(claimSearch).toEqual({
    path: '/api/v1/claims/search',
    q: CLAIM_ID,
    tenant: TENANT,
    book: 'DIRECT'
  });
  const assumedSearch = state.searchCalls.find(
    (entry) => entry.path === '/api/v1/assumed-claims/search'
  );
  expect(assumedSearch).toEqual({
    path: '/api/v1/assumed-claims/search',
    q: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
    tenant: TENANT,
    book: 'ASSUMED'
  });
});

test('opens the picker against the endpoint and book for each target type', async ({ page }) => {
  const state = await installMocks(page, { allocations: [] });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openAllocations(page);
  const dialog = await openAddAllocation(page);

  await expect(dialog.getByLabel('Target type')).toHaveValue('DIRECT_CLAIM');
  await expect(dialog.getByLabel('Amount')).toHaveValue('125000.0000');
  await expect(dialog.getByLabel('Component')).toHaveValue('INDEMNITY');

  await pickDirectClaim(dialog);
  await expect(dialog.getByTestId('allocation-picker-link')).toHaveAttribute(
    'href',
    `/direct-claims?record=${CLAIM_ID}`
  );

  await dialog.getByLabel('Target type').selectOption('ASSUMED_CLAIM');
  await dialog.getByPlaceholder('Search assumed claim number…').fill('AC');
  await dialog.getByRole('button', { name: /AC-2026-0000077/ }).click();
  await expect(dialog.getByTestId('allocation-picker-link')).toHaveAttribute(
    'href',
    `/assumed-claims?record=${ASSUMED_ID}`
  );

  await dialog.getByLabel('Target type').selectOption('POLICY');
  await dialog.getByPlaceholder('Search policy number…').fill('POL');
  await dialog.getByRole('button', { name: /POL-2026-0000123/ }).click();
  await expect(dialog.getByTestId('allocation-picker-link')).toHaveAttribute(
    'href',
    `/policy?record=${POLICY_ID}`
  );

  expect(state.searchCalls).toEqual([
    {
      path: '/api/v1/claims/search',
      q: 'CLM',
      tenant: TENANT,
      book: 'DIRECT'
    },
    {
      path: '/api/v1/assumed-claims/search',
      q: 'AC',
      tenant: TENANT,
      book: 'ASSUMED'
    },
    {
      path: '/api/v1/policies/search',
      q: 'POL',
      tenant: TENANT,
      book: 'DIRECT'
    }
  ]);
});

test('posts the allocation payload, then refreshes the ledger and leaves the payment amount alone', async ({ page }) => {
  const state = await installMocks(page, { allocations: [] });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openAllocations(page);
  const dialog = await openAddAllocation(page);

  await pickDirectClaim(dialog);
  await dialog.getByLabel('Component').selectOption('ALAE');
  await dialog.getByTestId('allocation-submit').click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('allocations-status')).toContainText(
    'Allocated $125,000.00 to CLM-2026-0000001.'
  );

  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toMatchObject({
    path: `/api/v1/payments/${PAYMENT_ID}/allocations`,
    tenant: TENANT,
    payload: {
      targetType: 'DIRECT_CLAIM',
      targetId: CLAIM_ID,
      component: 'ALAE',
      amount: '125000.0000'
    }
  });

  await expect(page.getByTestId('allocations-net-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('allocations-remaining-amount')).toHaveText('$0.00');
  await expect(page.getByTestId('allocations-count')).toHaveText('1');
  await expect(page.getByTestId('allocation-component-0')).toHaveText('ALAE');
  await expect(page.getByTestId('allocation-target-link-0')).toHaveAttribute(
    'href',
    `/direct-claims?record=${CLAIM_ID}`
  );

  // Splitting the payment never changes the payment itself.
  await expect(page.getByTestId('record-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('allocation-add')).toBeDisabled();
});

test('rejects an over-allocation and a non-positive amount before POST', async ({ page }) => {
  const state = await installMocks(page, { allocations: [DIRECT] });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openAllocations(page);
  const dialog = await openAddAllocation(page);

  await pickDirectClaim(dialog);
  await dialog.getByLabel('Amount').fill('80000');
  await dialog.getByTestId('allocation-submit').click();

  const formError = dialog.getByTestId('allocation-form-error');
  await expect(formError).toContainText(
    'Allocation amount cannot exceed the unallocated $75,000.00.'
  );
  expect(state.posts).toHaveLength(0);

  await dialog.getByLabel('Amount').fill('0');
  await dialog.getByTestId('allocation-submit').click();
  await expect(formError).toContainText('Allocation amount must be greater than 0.');
  expect(state.posts).toHaveLength(0);

  await dialog.getByLabel('Amount').fill('-100');
  await dialog.getByTestId('allocation-submit').click();
  await expect(formError).toContainText('Allocation amount must be greater than 0.');
  expect(state.posts).toHaveLength(0);

  // The unallocated hint is driven by the ledger, not by the entered amount.
  await expect(dialog.getByTestId('allocation-unallocated-hint')).toContainText(
    'Unallocated $75,000.00'
  );
});

test('renders the empty ledger and keeps the full payment unallocated', async ({ page }) => {
  await installMocks(page, { allocations: [] });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openAllocations(page);

  await expect(page.getByTestId('allocations-empty')).toContainText(
    'No allocations recorded for this payment yet.'
  );
  await expect(page.getByTestId('allocations-payment-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('allocations-net-amount')).toHaveText('$0.00');
  await expect(page.getByTestId('allocations-remaining-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('allocations-count')).toHaveText('0');
  await expect(page.getByTestId('allocations-table')).toHaveCount(0);
  await expect(page.getByTestId('allocation-add')).toBeEnabled();
  await expect(page.getByTestId('allocations-context')).toContainText(
    'The sum of the allocations cannot exceed the payment amount'
  );
});

test('contains a ledger error in the tab and retries without disturbing the payment', async ({ page }) => {
  const state = await installMocks(page, {
    allocations: [DIRECT],
    getStatus: 503
  });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openAllocations(page);

  const error = page.getByTestId('allocations-error');
  await expect(error).toContainText(
    'ALLOCATION_LEDGER_UNAVAILABLE: Allocation service unavailable'
  );
  await expect(page.getByTestId('allocations-net-amount')).toHaveText('—');
  await expect(page.getByTestId('allocations-remaining-amount')).toHaveText('—');
  await expect(page.getByTestId('allocations-count')).toHaveText('—');
  await expect(page.getByTestId('allocations-table')).toHaveCount(0);

  // The payment record itself is unaffected by the allocation failure.
  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('payment-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('record-amount')).toHaveText('$125,000.00');

  state.getStatus = 200;
  await page.getByRole('button', { name: 'Retry allocations' }).click();

  await expect(page.getByTestId('allocations-error')).toHaveCount(0);
  await expect(page.getByTestId('allocations-table')).toBeVisible();
  await expect(page.getByTestId('allocations-count')).toHaveText('1');
  await expect(page.getByTestId('allocations-net-amount')).toHaveText('$50,000.00');
});

test('keeps the form open on a 409 and offers a ledger reload', async ({ page }) => {
  const state = await installMocks(page, {
    allocations: [DIRECT],
    postStatus: 409,
    postBody: {
      code: 'ALLOCATION_EXCEEDS_PAYMENT',
      message: 'Allocations would exceed the payment amount'
    }
  });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openAllocations(page);
  const dialog = await openAddAllocation(page);

  await pickDirectClaim(dialog);
  await dialog.getByTestId('allocation-submit').click();

  await expect(dialog).toBeVisible();
  const stale = page.getByTestId('allocation-stale');
  await expect(stale).toContainText(
    'ALLOCATION_EXCEEDS_PAYMENT: Allocations would exceed the payment amount'
  );
  await expect(stale).toContainText('reload the allocations');
  expect(state.posts).toHaveLength(1);
  await expect(page.getByTestId('allocation-row-1')).toHaveCount(0);

  // The ledger changed underneath the form: another allocation now consumes
  // part of the previously unallocated balance.
  state.allocations = [
    DIRECT,
    allocation({
      id: 'e5555555-5555-7555-8555-555555555555',
      targetType: 'ASSUMED_CLAIM',
      targetId: ASSUMED_ID,
      targetReference: 'AC-2026-0000077',
      component: 'ALAE',
      amount: '50000.0000'
    })
  ];

  await page.getByTestId('allocation-reload').click();

  await expect(page.getByTestId('allocations-status')).toHaveText('Allocations reloaded.');
  await expect(page.getByTestId('allocation-unallocated-hint')).toContainText(
    'Unallocated $25,000.00'
  );
  await expect(page.getByTestId('allocations-remaining-amount')).toHaveText('$25,000.00');
  await expect(page.getByTestId('allocation-stale')).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test('renders the payment while the allocation ledger is still loading', async ({ page }) => {
  let release;
  const gate = {
    promise: new Promise((resolve) => {
      release = resolve;
    })
  };
  await installMocks(page, { allocations: [DIRECT, ASSUMED], gate });

  await page.goto(`/?record=${PAYMENT_ID}`);
  await openAllocations(page);

  await expect(page.getByTestId('allocations-loading')).toHaveText(
    'Loading payment allocations…'
  );
  await expect(page.getByTestId('allocations-payment-amount')).toHaveText('$125,000.00');
  await expect(page.getByTestId('allocations-net-amount')).toHaveText('…');
  await expect(page.getByTestId('allocations-remaining-amount')).toHaveText('…');
  await expect(page.getByTestId('allocations-count')).toHaveText('…');
  await expect(page.getByRole('heading', { name: PAYMENT.paymentNumber, level: 2 })).toBeVisible();

  release();

  await expect(page.getByTestId('allocations-table')).toBeVisible();
  await expect(page.getByTestId('allocations-count')).toHaveText('2');
  await expect(page.getByTestId('allocations-net-amount')).toHaveText('$65,000.00');
  await expect(page.getByTestId('allocations-remaining-amount')).toHaveText('$60,000.00');
});
