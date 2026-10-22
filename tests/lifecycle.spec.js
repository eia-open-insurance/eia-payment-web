import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PAYMENT_ID = '33333333-3333-7333-8333-333333333333';
const PAYEE_ID = '22222222-2222-7222-8222-222222222222';

function payment(status, version = 0) {
  return {
    id: PAYMENT_ID,
    tenantId: TENANT,
    paymentNumber: 'PAY-2026-0044721',
    paymentType: 'INDEMNITY',
    status,
    amount: '125000.0000',
    currency: 'USD',
    payeePartyId: PAYEE_ID,
    paymentDate: '2026-10-19',
    version,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z'
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
 * Mocks the payment queue, record, status PATCH, party lookup, documents, and
 * events. `state.current` is mutable so a test can simulate another operator
 * changing the payment between the read and the write.
 */
async function installMocks(page, { status = 'DRAFT', version = 0 } = {}) {
  const state = {
    current: payment(status, version),
    patchStatus: 200,
    patchBody: null,
    onPatchError: null,
    patches: [],
    detailCalls: 0,
    listCalls: 0
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/v1/payments') {
      state.listCalls += 1;
      await json(route, 200, [state.current]);
      return;
    }

    if (
      method === 'PATCH'
      && path === `/api/v1/payments/${PAYMENT_ID}/status`
    ) {
      const payload = request.postDataJSON();
      state.patches.push({
        path,
        method,
        payload,
        tenant: request.headers()['x-eia-tenant']
      });
      if (state.patchStatus >= 400) {
        if (state.onPatchError) state.onPatchError(payload);
        await json(route, state.patchStatus, state.patchBody || {
          code: 'CONCURRENT_MODIFICATION',
          message: 'The payment was changed by another request'
        });
        return;
      }
      state.current = {
        ...state.current,
        status: payload.status,
        version: Number(state.current.version) + 1,
        updatedAt: '2026-10-20T14:30:00Z'
      };
      await json(route, 200, state.current);
      return;
    }

    if (method === 'GET' && path === `/api/v1/payments/${PAYMENT_ID}`) {
      state.detailCalls += 1;
      await json(route, 200, state.current);
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

async function openPayment(page) {
  await page.goto(`/?record=${PAYMENT_ID}`);
  await expect(page.getByTestId('payment-lifecycle')).toBeVisible();
}

const ACTION_CASES = [
  ['DRAFT', 'Submit for authority'],
  ['PENDING_AUTHORITY', 'Authorize'],
  ['AUTHORIZED', 'Approve'],
  ['APPROVED', 'Schedule'],
  ['SCHEDULED', 'Send'],
  ['SUBMITTED', 'Accept'],
  ['ACCEPTED', 'Process'],
  ['PROCESSING', 'Mark paid'],
  ['PAID', 'Reconcile'],
  ['RECONCILED', null]
];

for (const [status, label] of ACTION_CASES) {
  test(`maps ${status} to ${label || 'no action'} with the matching timeline step`, async ({ page }) => {
    await installMocks(page, { status, version: 2 });
    await openPayment(page);

    await expect(page.getByTestId('payment-status')).toHaveText(status);
    await expect(page.getByTestId(`lifecycle-step-${status}`)).toHaveAttribute('data-state', 'current');
    await expect(page.getByTestId('lifecycle-current')).toContainText(status);

    if (label) {
      await expect(page.getByTestId('payment-action')).toHaveText(label);
      await expect(page.getByTestId('payment-action')).toBeEnabled();
      await expect(page.getByTestId('payment-action')).toHaveCount(1);
    } else {
      await expect(page.getByTestId('payment-action')).toHaveCount(0);
      await expect(page.getByTestId('payment-action-none')).toHaveText('No action');
      await expect(page.getByTestId('lifecycle-current')).toContainText('lifecycle complete');
    }
  });
}

const HAPPY_PATH = [
  { from: 'DRAFT', to: 'PENDING_AUTHORITY', label: 'Submit for authority', version: 0 },
  { from: 'PENDING_AUTHORITY', to: 'AUTHORIZED', label: 'Authorize', version: 1 },
  { from: 'AUTHORIZED', to: 'APPROVED', label: 'Approve', version: 2 },
  { from: 'APPROVED', to: 'SCHEDULED', label: 'Schedule', version: 3 },
  { from: 'SCHEDULED', to: 'SUBMITTED', label: 'Send', version: 4 },
  { from: 'SUBMITTED', to: 'ACCEPTED', label: 'Accept', version: 5 },
  { from: 'ACCEPTED', to: 'PROCESSING', label: 'Process', version: 6 },
  {
    from: 'PROCESSING',
    to: 'PAID',
    label: 'Mark paid',
    version: 7,
    confirm: true,
    reason: 'Bank reference 8842'
  },
  {
    from: 'PAID',
    to: 'RECONCILED',
    label: 'Reconcile',
    version: 8,
    confirm: true
  }
];

test('executes the happy path with one versioned PATCH per step', async ({ page }) => {
  const state = await installMocks(page, { status: 'DRAFT', version: 0 });
  await openPayment(page);

  for (const step of HAPPY_PATH) {
    await expect(page.getByTestId('payment-status')).toHaveText(step.from);
    await expect(page.getByTestId('payment-action')).toHaveText(step.label);

    await page.getByTestId('payment-action').click();

    if (step.confirm) {
      const dialog = page.getByTestId('payment-action-dialog');
      await expect(dialog).toBeVisible();
      // No write happens before the operator confirms.
      expect(state.patches).toHaveLength(HAPPY_PATH.indexOf(step));
      if (step.reason) {
        await dialog.getByTestId('lifecycle-reason').fill(step.reason);
      }
      await expect(dialog.getByTestId('lifecycle-expected-version')).toHaveText(String(step.version));
      await dialog.getByTestId('lifecycle-confirm-submit').click();
      await expect(dialog).toBeHidden();
    }

    await expect(page.getByTestId('payment-status')).toHaveText(step.to);
    await expect(page.getByTestId(`lifecycle-step-${step.to}`)).toHaveAttribute('data-state', 'current');

    const request = state.patches[state.patches.length - 1];
    expect(request.path).toBe(`/api/v1/payments/${PAYMENT_ID}/status`);
    expect(request.method).toBe('PATCH');
    expect(request.tenant).toBe(TENANT);
    const expectedPayload = { status: step.to, expectedVersion: step.version };
    if (step.reason) expectedPayload.reason = step.reason;
    expect(request.payload).toEqual(expectedPayload);
  }

  expect(state.patches).toHaveLength(9);
  expect(state.patches.map((request) => request.payload.status)).toEqual([
    'PENDING_AUTHORITY',
    'AUTHORIZED',
    'APPROVED',
    'SCHEDULED',
    'SUBMITTED',
    'ACCEPTED',
    'PROCESSING',
    'PAID',
    'RECONCILED'
  ]);

  // Success updates the selected record and the queue in place.
  await expect(page.getByTestId('payment-action')).toHaveCount(0);
  await expect(page.getByTestId('payment-action-none')).toHaveText('No action');
  await expect(page.getByTestId('lifecycle-current')).toContainText('lifecycle complete');
  await expect(page.getByTestId('lifecycle-step-RECONCILED')).toHaveAttribute('data-state', 'current');
  await expect(
    page.getByRole('button', { name: 'Open record PAY-2026-0044721' })
  ).toContainText('RECONCILED');
});

test('confirms Mark paid, sends the optional reason, and contains a 409 conflict', async ({ page }) => {
  const state = await installMocks(page, { status: 'PROCESSING', version: 3 });
  await openPayment(page);

  await page.getByTestId('payment-action').click();
  const dialog = page.getByTestId('payment-action-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Mark payment as paid?' })).toBeVisible();
  await expect(dialog).toContainText('PROCESSING → PAID');
  expect(state.patches).toHaveLength(0);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(state.patches).toHaveLength(0);
  await expect(page.getByTestId('payment-action')).toHaveText('Mark paid');

  // Another operator changes the payment before the confirmation is retried.
  state.patchStatus = 409;
  state.patchBody = {
    code: 'CONCURRENT_MODIFICATION',
    message: 'Expected version 3 but payment is at version 4'
  };
  state.onPatchError = () => {
    state.current = payment('PROCESSING', 4);
  };

  await page.getByTestId('payment-action').click();
  await dialog.getByTestId('lifecycle-reason').fill('Bank reference 8842');
  await dialog.getByTestId('lifecycle-confirm-submit').click();

  const conflict = page.getByTestId('lifecycle-conflict');
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText(
    'CONCURRENT_MODIFICATION: Expected version 3 but payment is at version 4'
  );
  await expect(conflict).toContainText('reloaded');
  await expect(page.getByTestId('payment-status')).toHaveText('PROCESSING');
  await expect(page.getByTestId('lifecycle-expected-version')).toHaveCount(0);
  await expect(page.getByTestId('payment-action')).toHaveText('Mark paid');

  // The retry carries the reloaded version, not the stale one.
  state.patchStatus = 200;
  await expect(page.getByTestId('payment-action')).toBeEnabled();
  await page.getByTestId('payment-action').click();
  await dialog.getByTestId('lifecycle-reason').fill('Bank reference 8842');
  await dialog.getByTestId('lifecycle-confirm-submit').click();

  await expect(page.getByTestId('payment-status')).toHaveText('PAID');
  await expect(page.getByTestId('payment-action')).toHaveText('Reconcile');
  expect(state.patches[state.patches.length - 1].payload).toEqual({
    status: 'PAID',
    expectedVersion: 4,
    reason: 'Bank reference 8842'
  });
});

test('reconciles a paid payment only after confirmation', async ({ page }) => {
  const state = await installMocks(page, { status: 'PAID', version: 4 });
  await openPayment(page);

  await page.getByTestId('payment-action').click();
  const dialog = page.getByTestId('payment-action-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Reconcile payment?' })).toBeVisible();
  await expect(dialog).toContainText('PAID → RECONCILED');
  await expect(dialog.getByTestId('lifecycle-confirm-description')).toContainText(
    'completes the execution lifecycle'
  );
  expect(state.patches).toHaveLength(0);

  await dialog.getByTestId('lifecycle-confirm-submit').click();

  await expect(dialog).toBeHidden();
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0]).toMatchObject({
    path: `/api/v1/payments/${PAYMENT_ID}/status`,
    method: 'PATCH',
    tenant: TENANT,
    payload: { status: 'RECONCILED', expectedVersion: 4 }
  });
  expect(state.patches[0].payload).not.toHaveProperty('reason');

  await expect(page.getByTestId('payment-status')).toHaveText('RECONCILED');
  await expect(page.getByTestId('payment-action')).toHaveCount(0);
  await expect(page.getByTestId('lifecycle-step-RECONCILED')).toHaveAttribute('data-state', 'current');
  await expect(
    page.getByRole('button', { name: 'Open record PAY-2026-0044721' })
  ).toContainText('RECONCILED');
});

test('contains a 409, reloads the latest record, and retries with the new version', async ({ page }) => {
  const state = await installMocks(page, { status: 'DRAFT', version: 0 });
  await openPayment(page);

  // Another operator submits the payment after this workbench read version 0.
  state.patchStatus = 409;
  state.patchBody = {
    code: 'CONCURRENT_MODIFICATION',
    message: 'Expected version 0 but payment is at version 1'
  };
  state.onPatchError = () => {
    state.current = payment('PENDING_AUTHORITY', 1);
  };

  await page.getByTestId('payment-action').click();

  const conflict = page.getByTestId('lifecycle-conflict');
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText(
    'CONCURRENT_MODIFICATION: Expected version 0 but payment is at version 1'
  );
  await expect(conflict).toContainText('latest payment was reloaded');
  await expect(state.patches[0].payload).toEqual({
    status: 'PENDING_AUTHORITY',
    expectedVersion: 0
  });

  // The record and queue now show the authoritative state.
  await expect(page.getByTestId('payment-status')).toHaveText('PENDING_AUTHORITY');
  await expect(page.getByTestId('payment-action')).toHaveText('Authorize');
  await expect(
    page.getByRole('button', { name: 'Open record PAY-2026-0044721' })
  ).toContainText('PENDING_AUTHORITY');
  await expect(page.getByTestId('lifecycle-step-PENDING_AUTHORITY')).toHaveAttribute(
    'data-state',
    'current'
  );

  state.patchStatus = 200;
  await page.getByTestId('payment-action').click();

  await expect(page.getByTestId('payment-status')).toHaveText('AUTHORIZED');
  expect(state.patches[1].payload).toEqual({
    status: 'AUTHORIZED',
    expectedVersion: 1
  });
  await expect(page.getByTestId('lifecycle-conflict')).toHaveCount(0);
});

test('renders passed, current, and upcoming lifecycle steps and the ownership context', async ({ page }) => {
  await installMocks(page, { status: 'ACCEPTED', version: 5 });
  await openPayment(page);

  await expect(page.getByTestId('lifecycle-step-DRAFT')).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('lifecycle-step-SUBMITTED')).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('lifecycle-step-ACCEPTED')).toHaveAttribute('data-state', 'current');
  await expect(page.getByTestId('lifecycle-step-ACCEPTED')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('lifecycle-step-PROCESSING')).toHaveAttribute('data-state', 'upcoming');
  await expect(page.getByTestId('lifecycle-step-RECONCILED')).toHaveAttribute('data-state', 'upcoming');
  await expect(page.getByTestId('lifecycle-current')).toContainText('Current status ACCEPTED');

  // The payment owns execution; source links are evidence only.
  const context = page.getByTestId('lifecycle-context');
  await expect(context).toContainText('Payment owns execution');
  await expect(context).toContainText('Claim and policy links are evidence');
  await expect(page.getByTestId('payment-context')).toContainText(
    'never advance or control the payment status'
  );
});

test('shows no happy-path action for an off-path terminal status', async ({ page }) => {
  await installMocks(page, { status: 'REVERSED', version: 2 });
  await openPayment(page);

  await expect(page.getByTestId('payment-action')).toHaveCount(0);
  await expect(page.getByTestId('payment-action-none')).toHaveText('No action');
  await expect(page.getByTestId('payment-secondary-actions')).toHaveCount(0);
  await expect(page.getByTestId('lifecycle-off-path')).toContainText(
    'not on the execution happy path'
  );
  await expect(page.getByTestId('lifecycle-step-DRAFT')).toHaveAttribute('data-state', 'off-path');
});

const TERMINAL_ACTION_CASES = [
  {
    status: 'DRAFT',
    happy: 'Submit for authority',
    actions: [['cancel', 'CANCELLED'], ['void', 'VOID']]
  },
  {
    status: 'PENDING_AUTHORITY',
    happy: 'Authorize',
    actions: [['cancel', 'CANCELLED'], ['void', 'VOID']]
  },
  {
    status: 'AUTHORIZED',
    happy: 'Approve',
    actions: [['cancel', 'CANCELLED'], ['void', 'VOID']]
  },
  {
    status: 'APPROVED',
    happy: 'Schedule',
    actions: [['void', 'VOID'], ['stop', 'STOPPED']]
  },
  {
    status: 'SCHEDULED',
    happy: 'Send',
    actions: [['cancel', 'CANCELLED'], ['void', 'VOID']]
  },
  {
    status: 'RETURNED',
    happy: null,
    actions: [['cancel', 'CANCELLED']]
  },
  {
    status: 'FAILED',
    happy: null,
    actions: [['cancel', 'CANCELLED']]
  }
];

for (const { status, happy, actions } of TERMINAL_ACTION_CASES) {
  test(`maps ${status} to its ${actions.length} terminal action(s)`, async ({ page }) => {
    await installMocks(page, { status, version: 3 });
    await openPayment(page);

    await expect(page.getByTestId('payment-secondary-actions')).toBeVisible();
    await expect(page.locator('[data-testid^="payment-secondary-action-"]'))
      .toHaveCount(actions.length);

    for (const [id, target] of actions) {
      const button = page.getByTestId(`payment-secondary-action-${id}`);
      await expect(button).toHaveText(`${id[0].toUpperCase()}${id.slice(1)} payment`);
      await expect(button).toHaveAttribute('data-target', target);
      await expect(button).toBeEnabled();
    }

    if (happy) {
      await expect(page.getByTestId('payment-action')).toHaveText(happy);
      await expect(page.getByTestId('payment-action-none')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('payment-action')).toHaveCount(0);
      await expect(page.getByTestId('payment-action-none')).toHaveCount(0);
    }
  });
}

const NO_TERMINAL_ACTION_CASES = [
  ['SUBMITTED', 'Accept'],
  ['ACCEPTED', 'Process'],
  ['PROCESSING', 'Mark paid'],
  ['PAID', 'Reconcile'],
  ['PARTIALLY_PAID', null],
  ['RECONCILED', null],
  ['REJECTED', null],
  ['CANCELLED', null],
  ['VOID', null],
  ['STOPPED', null],
  ['REVERSED', null],
  ['ESCHEATED', null]
];

for (const [status, happy] of NO_TERMINAL_ACTION_CASES) {
  test(`offers no terminal actions for ${status}`, async ({ page }) => {
    await installMocks(page, { status, version: 5 });
    await openPayment(page);

    await expect(page.getByTestId('payment-secondary-actions')).toHaveCount(0);
    await expect(page.locator('[data-testid^="payment-secondary-action-"]')).toHaveCount(0);

    if (happy) {
      await expect(page.getByTestId('payment-action')).toHaveText(happy);
      await expect(page.getByTestId('payment-action-none')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('payment-action')).toHaveCount(0);
      await expect(page.getByTestId('payment-action-none')).toHaveText('No action');
    }
  });
}

test('cancels with confirmation, an optional reason, and shows the terminal off-path state', async ({ page }) => {
  const state = await installMocks(page, { status: 'SCHEDULED', version: 4 });
  await openPayment(page);

  await page.getByTestId('payment-secondary-action-cancel').click();
  const dialog = page.getByTestId('payment-action-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Cancel payment?' })).toBeVisible();
  await expect(dialog).toContainText('SCHEDULED → CANCELLED');
  await expect(dialog.getByTestId('lifecycle-expected-version')).toHaveText('4');
  await expect(dialog.getByTestId('lifecycle-confirm-description')).toContainText(
    'Cancelling is terminal'
  );
  await expect(dialog.getByTestId('lifecycle-reason-requirement')).toHaveText('Optional');
  await expect(dialog.getByTestId('lifecycle-reason')).not.toHaveAttribute('required');
  // No write happens before the operator confirms, and dismissing writes nothing.
  expect(state.patches).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(state.patches).toHaveLength(0);

  await page.getByTestId('payment-secondary-action-cancel').click();
  await dialog.getByTestId('lifecycle-reason').fill('Duplicate claim request');
  await dialog.getByTestId('lifecycle-confirm-submit').click();

  await expect(dialog).toBeHidden();
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0]).toEqual({
    path: `/api/v1/payments/${PAYMENT_ID}/status`,
    method: 'PATCH',
    tenant: TENANT,
    payload: {
      status: 'CANCELLED',
      expectedVersion: 4,
      reason: 'Duplicate claim request'
    }
  });

  await expect(page.getByTestId('payment-status')).toHaveText('CANCELLED');
  await expect(page.getByRole('status')).toContainText('is now CANCELLED');
  await expect(page.getByRole('status')).toContainText('terminal status');
  await expect(page.getByTestId('lifecycle-current')).toContainText('terminal status');
  await expect(page.getByTestId('lifecycle-terminal')).toContainText('CANCELLED');
  await expect(page.getByTestId('lifecycle-terminal')).toContainText('Payment cancelled');
  await expect(page.getByTestId('lifecycle-off-path')).toContainText(
    'not on the execution happy path'
  );
  await expect(page.getByTestId('lifecycle-off-path')).toContainText('terminal');
  await expect(page.getByTestId('lifecycle-step-DRAFT')).toHaveAttribute('data-state', 'off-path');
  await expect(page.getByTestId('lifecycle-step-RECONCILED')).toHaveAttribute(
    'data-state',
    'off-path'
  );
  await expect(page.getByTestId('payment-secondary-actions')).toHaveCount(0);
  await expect(page.getByTestId('payment-action')).toHaveCount(0);
  await expect(page.getByTestId('payment-action-none')).toHaveText('No action');
  await expect(
    page.getByRole('button', { name: 'Open record PAY-2026-0044721' })
  ).toContainText('CANCELLED');
});

test('cancels a failed payment without a reason and omits the reason from the payload', async ({ page }) => {
  const state = await installMocks(page, { status: 'FAILED', version: 6 });
  await openPayment(page);

  await page.getByTestId('payment-secondary-action-cancel').click();
  const dialog = page.getByTestId('payment-action-dialog');
  await expect(dialog.getByTestId('lifecycle-reason-requirement')).toHaveText('Optional');
  await dialog.getByTestId('lifecycle-confirm-submit').click();

  await expect(dialog).toBeHidden();
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].payload).toEqual({
    status: 'CANCELLED',
    expectedVersion: 6
  });
  expect(state.patches[0].payload).not.toHaveProperty('reason');
  await expect(page.getByTestId('payment-status')).toHaveText('CANCELLED');
  await expect(page.getByTestId('lifecycle-terminal')).toContainText('Payment cancelled');
  await expect(page.getByTestId('lifecycle-off-path')).toContainText('terminal');
});

test('requires a reason before voiding and sends the trimmed reason', async ({ page }) => {
  const state = await installMocks(page, { status: 'DRAFT', version: 0 });
  await openPayment(page);

  await page.getByTestId('payment-secondary-action-void').click();
  const dialog = page.getByTestId('payment-action-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Void payment?' })).toBeVisible();
  await expect(dialog.getByTestId('lifecycle-confirm-description')).toContainText(
    'Voiding is terminal'
  );
  await expect(dialog.getByTestId('lifecycle-reason-requirement')).toHaveText('Required');
  await expect(dialog.getByTestId('lifecycle-reason')).toHaveAttribute('required', '');

  await dialog.getByTestId('lifecycle-confirm-submit').click();
  await expect(dialog.getByTestId('lifecycle-action-error')).toHaveText(
    'A reason is required to void a payment.'
  );
  expect(state.patches).toHaveLength(0);
  await expect(dialog).toBeVisible();

  await dialog.getByTestId('lifecycle-reason').fill('   ');
  await dialog.getByTestId('lifecycle-confirm-submit').click();
  await expect(dialog.getByTestId('lifecycle-action-error')).toHaveText(
    'A reason is required to void a payment.'
  );
  expect(state.patches).toHaveLength(0);

  await dialog.getByTestId('lifecycle-reason').fill('  Wrong payee on the instruction  ');
  await expect(dialog.getByTestId('lifecycle-action-error')).toHaveCount(0);
  await dialog.getByTestId('lifecycle-confirm-submit').click();

  await expect(dialog).toBeHidden();
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].payload).toEqual({
    status: 'VOID',
    expectedVersion: 0,
    reason: 'Wrong payee on the instruction'
  });
  await expect(page.getByTestId('payment-status')).toHaveText('VOID');
  await expect(page.getByTestId('payment-action')).toHaveCount(0);
  await expect(page.getByTestId('payment-secondary-actions')).toHaveCount(0);
  await expect(page.getByTestId('lifecycle-terminal')).toContainText('Payment voided');
  await expect(page.getByTestId('lifecycle-off-path')).toContainText('not on the execution happy path');
  await expect(
    page.getByRole('button', { name: 'Open record PAY-2026-0044721' })
  ).toContainText('VOID');
});

test('stops an approved payment only after a reason is confirmed', async ({ page }) => {
  const state = await installMocks(page, { status: 'APPROVED', version: 2 });
  await openPayment(page);

  await expect(page.getByTestId('payment-action')).toHaveText('Schedule');
  await expect(page.getByTestId('payment-secondary-action-void')).toBeVisible();
  await page.getByTestId('payment-secondary-action-stop').click();

  const dialog = page.getByTestId('payment-action-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Stop payment?' })).toBeVisible();
  await expect(dialog).toContainText('APPROVED → STOPPED');
  await expect(dialog.getByTestId('lifecycle-confirm-description')).toContainText(
    'Stopping is terminal'
  );
  await expect(dialog.getByTestId('lifecycle-reason-requirement')).toHaveText('Required');
  expect(state.patches).toHaveLength(0);

  await dialog.getByTestId('lifecycle-reason').fill('Payment run cancelled by treasury');
  await dialog.getByTestId('lifecycle-confirm-submit').click();

  await expect(dialog).toBeHidden();
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].payload).toEqual({
    status: 'STOPPED',
    expectedVersion: 2,
    reason: 'Payment run cancelled by treasury'
  });
  await expect(page.getByTestId('payment-status')).toHaveText('STOPPED');
  await expect(page.getByTestId('payment-action')).toHaveCount(0);
  await expect(page.getByTestId('payment-secondary-actions')).toHaveCount(0);
  await expect(page.getByTestId('lifecycle-terminal')).toContainText('Payment stopped');
  await expect(page.getByTestId('lifecycle-step-APPROVED')).toHaveAttribute(
    'data-state',
    'off-path'
  );
  await expect(page.getByTestId('lifecycle-off-path')).toContainText('not on the execution happy path');
});

test('contains a terminal-action API error in the dialog and retries after the problem clears', async ({ page }) => {
  const state = await installMocks(page, { status: 'AUTHORIZED', version: 1 });
  state.patchStatus = 400;
  state.patchBody = {
    code: 'INVALID_STATUS_TRANSITION',
    message: 'Cannot transition payment from AUTHORIZED to VOID'
  };
  await openPayment(page);

  await page.getByTestId('payment-secondary-action-void').click();
  const dialog = page.getByTestId('payment-action-dialog');
  await dialog.getByTestId('lifecycle-reason').fill('Duplicate payment');
  await dialog.getByTestId('lifecycle-confirm-submit').click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('lifecycle-action-error')).toContainText(
    'INVALID_STATUS_TRANSITION: Cannot transition payment from AUTHORIZED to VOID'
  );
  expect(state.patches).toHaveLength(1);
  await expect(page.getByTestId('payment-status')).toHaveText('AUTHORIZED');
  await expect(page.getByTestId('lifecycle-conflict')).toHaveCount(0);

  state.patchStatus = 200;
  await dialog.getByTestId('lifecycle-confirm-submit').click();

  await expect(dialog).toBeHidden();
  expect(state.patches).toHaveLength(2);
  expect(state.patches[1].payload).toEqual({
    status: 'VOID',
    expectedVersion: 1,
    reason: 'Duplicate payment'
  });
  await expect(page.getByTestId('payment-status')).toHaveText('VOID');
  await expect(page.getByTestId('lifecycle-terminal')).toContainText('Payment voided');
});
