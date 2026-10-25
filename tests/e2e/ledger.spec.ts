import { test, expect, type Page } from '@playwright/test';
import type { Purchase } from '../../src/shared/types';

async function navigate(page: Page, destination: 'settings' | 'purchases' | 'dashboard') {
  await page.locator(`nav a[href="/${destination}"]:visible`).click();
  await expect(page).toHaveURL(new RegExp(`/${destination}$`));
}

async function setRate(page: Page, value = '0.23') {
  await page.goto('/settings');
  await page.getByLabel('Default exchange rate', { exact: true }).fill(value);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/settings') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save rate', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('status')).toContainText('Default exchange rate saved.');
}

async function openNewPurchase(page: Page) {
  await page.getByRole('button', { name: 'Add purchase', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a purchase', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function savePurchase(page: Page): Promise<Purchase> {
  const response = page.waitForResponse(
    (item) => item.url().endsWith('/api/v1/purchases') && item.request().method() === 'POST',
  );
  await page
    .getByRole('dialog', { name: 'Add a purchase', exact: true })
    .getByRole('button', { name: 'Save purchase', exact: true })
    .click();
  const result = await response;
  expect(result.status()).toBe(201);
  const body = (await result.json()) as { data: Purchase };
  await expect(page.getByRole('dialog', { name: 'Add a purchase', exact: true })).toBeHidden();
  return body.data;
}

test('setup, both currencies, saved rates, editing, dashboard, trash and recovery', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const suffix = `${info.project.name}-${crypto.randomUUID().slice(0, 8)}`;
  const group = `Journey ${suffix}`;
  const companion = `旅行者 ${suffix}`;
  const ramen = `${group} ラーメン`;
  const tea = `${group} ชา`;
  await setRate(page);
  await page.getByLabel('New purchaser name', { exact: true }).fill(companion);
  await page.getByRole('button', { name: 'Add purchaser', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Rename ${companion}`, exact: true }),
  ).toBeVisible();
  await navigate(page, 'purchases');
  await page.getByRole('button', { name: 'All time', exact: true }).click();

  let dialog = await openNewPurchase(page);
  await dialog.getByLabel('Purchase name', { exact: true }).fill(ramen);
  await dialog.getByLabel('Purchase amount', { exact: true }).fill('1500');
  await dialog.getByLabel('Purchased by', { exact: true }).selectOption({ label: companion });
  await dialog.getByRole('button', { name: 'Custom', exact: true }).click();
  await dialog.getByLabel('Purchase date and time', { exact: true }).fill('2026-10-25T14:30');
  await dialog
    .getByLabel('Description (optional)', { exact: true })
    .fill('<b>Plain text</b> and 日本の思い出');
  const first = await savePurchase(page);
  expect(first.amountJpy).toBe('1500');
  expect(first.amountThb).toBe('345.00');
  expect(first.purchasedAt).toBe('2026-10-25T05:30:00.000Z');

  dialog = await openNewPurchase(page);
  await dialog.getByLabel('Purchase name', { exact: true }).fill(tea);
  await dialog.getByRole('button', { name: 'THB', exact: true }).click();
  await dialog.getByLabel('Purchase amount', { exact: true }).fill('100.00');
  await dialog.getByLabel('Purchased by', { exact: true }).selectOption({ label: companion });
  for (let i = 0; i < 3; i++) {
    await dialog.getByRole('button', { name: 'JPY', exact: true }).click();
    await expect(dialog.getByLabel('Purchase amount', { exact: true })).toHaveValue('435');
    await dialog.getByRole('button', { name: 'THB', exact: true }).click();
    await expect(dialog.getByLabel('Purchase amount', { exact: true })).toHaveValue('100.00');
  }
  await dialog.getByRole('button', { name: 'Custom', exact: true }).click();
  await dialog.getByLabel('Purchase date and time', { exact: true }).fill('2026-10-25T23:30');
  const second = await savePurchase(page);
  expect(second.originalCurrency).toBe('THB');
  expect(second.originalAmount).toBe('100.00');
  expect(second.amountThb).toBe('100.00');
  expect(second.amountJpy).toBe('435');

  await page.getByLabel('Search purchases', { exact: true }).fill(group);
  await expect(page.locator('article.purchase-row')).toHaveCount(2);
  await expect(page.locator('.total-card .stat-value')).toContainText('฿445.00');
  await page.getByRole('button', { name: '¥ JPY', exact: true }).click();
  await expect(page.locator('.total-card .stat-value')).toContainText('¥1,935');
  await page.getByRole('button', { name: '฿ THB', exact: true }).click();

  await page.getByRole('button', { name: `Show details for ${ramen}`, exact: true }).click();
  const firstRow = page.locator('article.purchase-row').filter({ hasText: ramen });
  await expect(firstRow.locator('.purchase-description')).toHaveText(
    '<b>Plain text</b> and 日本の思い出',
  );
  await expect(firstRow.locator('.purchase-description b')).toHaveCount(0);
  await expect(firstRow).toContainText('14:30');
  await firstRow.getByRole('button', { name: 'Edit purchase', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Edit purchase', exact: true });
  await expect(dialog.getByLabel('Purchase date and time', { exact: true })).toHaveValue(
    '2026-10-25T14:30',
  );
  await dialog.getByLabel('Purchase name', { exact: true }).fill(`${ramen} edited`);
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toBeHidden();

  await navigate(page, 'settings');
  await page.getByLabel('Default exchange rate', { exact: true }).fill('0.30');
  await page.getByRole('button', { name: 'Save rate', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Default exchange rate saved.');
  await page.getByRole('button', { name: `Archive ${companion}`, exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Reactivate ${companion}`, exact: true }),
  ).toBeVisible();

  await navigate(page, 'dashboard');
  await expect(page.locator('.total-card .stat-value')).toContainText('฿445.00');
  await page.getByLabel('Filter by purchaser').selectOption({ label: `${companion} (archived)` });
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.getByLabel('From date', { exact: true }).fill('2026-10-25');
  await page.getByLabel('To date', { exact: true }).fill('2026-10-25');
  await expect(page.locator('.total-card .stat-value')).toContainText('฿445.00');
  await page.getByText('View daily spending table', { exact: true }).click();
  const dailyTable = page.getByRole('table', {
    name: 'Spending by Tokyo calendar day',
    exact: true,
  });
  await expect(dailyTable).toBeVisible();
  await expect(dailyTable).toContainText('2026-10-25');
  await expect(dailyTable).toContainText('฿445.00');
  await page.getByText('View purchaser spending table', { exact: true }).click();
  await expect(
    page.getByRole('table', {
      name: 'Spending by purchaser, including archived purchasers',
      exact: true,
    }),
  ).toContainText(companion);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('dashboard.png'), fullPage: true });

  await navigate(page, 'purchases');
  await expect(page.locator('article.purchase-row')).toHaveCount(2);
  await page.getByRole('button', { name: `Show details for ${ramen} edited`, exact: true }).click();
  await page
    .locator('article.purchase-row')
    .filter({ hasText: `${ramen} edited` })
    .getByRole('button', { name: 'Move to trash', exact: true })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Move to trash?', exact: true });
  await confirm.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(page.locator('.total-card .stat-value')).toContainText('฿100.00');
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(page.locator('article.purchase-row')).toHaveCount(1);

  // Recovery remains available after reloading, independent of any temporary toast.
  await page.reload();
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await page.getByLabel('Search purchases', { exact: true }).fill(`${ramen} edited`);
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('button', { name: `Show details for ${ramen} edited`, exact: true }).click();
  await page.getByRole('button', { name: 'Restore purchase', exact: true }).click();
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await expect(page.locator('article.purchase-row')).toHaveCount(1);
  await expect(page.locator('.total-card .stat-value')).toContainText('฿345.00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('purchases.png'), fullPage: true });
});

test('network failure preserves the draft and creation ID for a safe retry', async ({
  page,
}, info) => {
  const name = `Retry ${info.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  await setRate(page);
  await navigate(page, 'purchases');
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  const dialog = await openNewPurchase(page);
  await dialog.getByLabel('Purchase name', { exact: true }).fill(name);
  await dialog.getByLabel('Purchase amount', { exact: true }).fill('1500');
  const submitted: Record<string, unknown>[] = [];
  let first = true;
  await page.route('**/api/v1/purchases', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    submitted.push(route.request().postDataJSON() as Record<string, unknown>);
    if (first) {
      first = false;
      await route.abort('failed');
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: 'Save purchase', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Purchase name', { exact: true })).toHaveValue(name);
  await expect(dialog.getByLabel('Purchase amount', { exact: true })).toHaveValue('1500');
  await expect(dialog.getByRole('button', { name: 'Save purchase', exact: true })).toBeEnabled();
  const purchase = await savePurchase(page);
  expect(submitted).toHaveLength(2);
  expect(submitted[0]).toEqual(submitted[1]);
  expect(purchase.id).toBe(submitted[0]?.id);
  expect(submitted[0]).not.toHaveProperty('purchasedAt');
  await page.getByLabel('Search purchases', { exact: true }).fill(name);
  await expect(page.locator('article.purchase-row')).toHaveCount(1);
});
