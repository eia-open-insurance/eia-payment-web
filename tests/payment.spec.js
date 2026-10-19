import { test, expect } from '@playwright/test';

const PAYMENT = {
  id: '33333333-3333-7333-8333-333333333333',
  tenantId: '11111111-1111-7111-8111-111111111111',
  paymentNumber: 'PAY-2026-0044721',
  paymentType: 'INDEMNITY',
  status: 'DRAFT',
  amount: '125000.0000',
  currency: 'USD',
  payeePartyId: '22222222-2222-7222-8222-222222222222',
  paymentDate: '2026-10-19',
  version: 0
};

test('renders the payment workbench and mocked payment row', async ({ page }) => {
  await page.route('**/api/v1/payments**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([PAYMENT])
      });
    } else {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(PAYMENT)
      });
    }
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Payment' })).toBeVisible();
  await expect(page.getByText('PAY-2026-0044721')).toBeVisible();
  await expect(page.getByRole('table').getByText('INDEMNITY')).toBeVisible();
  await expect(page.getByRole('table').getByText('USD 125000.0000')).toBeVisible();
  await expect(page.getByRole('table').getByText('DRAFT')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
});
