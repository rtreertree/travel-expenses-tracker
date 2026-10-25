import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Purchase } from '../../src/shared/types';

async function prepare(page: Page) {
  await page.goto('/settings');
  await page.getByLabel('Default exchange rate', { exact: true }).fill('0.23');
  const response = page.waitForResponse(
    (item) => item.url().endsWith('/api/v1/settings') && item.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save rate', exact: true }).click();
  expect((await response).status()).toBe(200);
  await page.locator('nav a[href="/purchases"]:visible').click();
  await page.getByRole('button', { name: 'All time', exact: true }).click();
}
async function newForm(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add purchase', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add a purchase', exact: true });
  await form.getByLabel('Purchase name', { exact: true }).fill(name);
  await form.getByLabel('Purchase amount', { exact: true }).fill('1200');
  return form;
}
async function save(page: Page, form: Locator, editing = false) {
  const response = page.waitForResponse(
    (item) =>
      item.url().includes('/api/v1/purchases') &&
      item.request().method() === (editing ? 'PATCH' : 'POST'),
  );
  await form
    .getByRole('button', { name: editing ? 'Save changes' : 'Save purchase', exact: true })
    .click();
  const result = await response;
  expect(result.status()).toBe(editing ? 200 : 201);
  await expect(form).toBeHidden();
  return {
    purchase: ((await result.json()) as { data: Purchase }).data,
    input: result.request().postDataJSON() as Record<string, unknown>,
  };
}
async function expand(page: Page, name: string) {
  const row = page.locator('article.purchase-row').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  if (await row.getByRole('button', { name: `Show details for ${name}`, exact: true }).count()) {
    await row.getByRole('button', { name: `Show details for ${name}`, exact: true }).click();
  }
  return row;
}
async function edit(page: Page, name: string) {
  const row = await expand(page, name);
  await row.getByRole('button', { name: 'Edit purchase', exact: true }).click();
  return page.getByRole('dialog', { name: 'Edit purchase', exact: true });
}

test('pasted locations persist, text edits preserve precision, clear works, and trash retains map pins', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const name = `Location ${info.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  await prepare(page);
  let form = await newForm(page, name);
  await form.getByLabel('Location (optional)', { exact: true }).fill('35.681236, 139.767125');
  await expect(form.locator('.location-preview')).toContainText(
    'Coordinates: 35.681236, 139.767125',
  );
  let result = await save(page, form);
  expect(result.purchase.location?.latitude).toBe(35.681236);
  expect(result.purchase.location?.longitude).toBe(139.767125);
  await page.reload();
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await page.getByLabel('Search purchases', { exact: true }).fill(name);
  let row = await expand(page, name);
  await expect(row.locator('.location-coordinates')).toHaveText(
    'Coordinates: 35.681236, 139.767125',
  );
  await expect(row.locator('.purchase-location-summary a')).toHaveAttribute(
    'href',
    /https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=35\.681236%2C139\.767125/,
  );

  form = await edit(page, name);
  await form
    .getByLabel('Description (optional)', { exact: true })
    .fill('Only the description changed.');
  result = await save(page, form, true);
  expect(result.input).not.toHaveProperty('location');
  expect(result.purchase.location?.latitude).toBe(35.681236);
  expect(result.purchase.location?.longitude).toBe(139.767125);
  form = await edit(page, name);
  await form.getByLabel('Location (optional)', { exact: true }).fill('');
  result = await save(page, form, true);
  expect(result.input.location).toBeNull();
  expect(result.purchase.location).toBeNull();
  row = await expand(page, name);
  await expect(row.locator('.location-display')).toHaveCount(0);
  await expect(row.locator('.purchase-location-summary')).toHaveCount(0);

  form = await edit(page, name);
  await form
    .getByLabel('Location (optional)', { exact: true })
    .fill(
      'https://www.google.com/maps/place/Tokyo+Station/@35.68,139.76,16z/data=!3d35.681236!4d139.767125',
    );
  await expect(form.locator('.location-preview')).toContainText(
    'Coordinates: 35.681236, 139.767125',
  );
  result = await save(page, form, true);
  expect(result.purchase.location?.latitude).toBe(35.681236);
  expect(result.purchase.location?.longitude).toBe(139.767125);
  row = await expand(page, name);
  await row.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Move to trash?', exact: true })
    .getByRole('button', { name: 'Move to trash', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Move to trash?', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  row = await expand(page, name);
  await expect(row.locator('.location-coordinates')).toContainText('35.681236, 139.767125');
  await row.getByRole('button', { name: 'Restore purchase', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Purchase restored.');
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  row = await expand(page, name);
  await expect(row.locator('.location-coordinates')).toContainText('35.681236, 139.767125');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('saved-location.png'), fullPage: true });
});

test('GPS is explicit and a failed save retains coordinates and the same creation UUID', async ({
  page,
  context,
}, info) => {
  const name = `GPS ${info.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 35.658581, longitude: 139.745433 });
  await prepare(page);
  const form = await newForm(page, name);
  await expect(form.getByLabel('Location (optional)', { exact: true })).toHaveValue('');
  await expect(form.locator('.location-preview')).toHaveCount(0);
  await form.getByRole('button', { name: 'Use current location', exact: true }).click();
  await expect(form.getByLabel('Location (optional)', { exact: true })).toHaveValue(
    '35.658581, 139.745433',
  );
  const requests: Record<string, unknown>[] = [];
  let first = true;
  await page.route('**/api/v1/purchases', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (first) {
      first = false;
      await route.abort('failed');
    } else await route.continue();
  });
  await form.getByRole('button', { name: 'Save purchase', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form.getByLabel('Location (optional)', { exact: true })).toHaveValue(
    '35.658581, 139.745433',
  );
  const result = await save(page, form);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(result.purchase.id).toBe(requests[0]?.id);
  expect(result.purchase.location?.latitude).toBe(35.658581);
  expect(result.purchase.location?.longitude).toBe(139.745433);
});

test('late GPS callbacks cannot replace a location edited by the user or a reopened form', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const state = window as unknown as {
      gpsCalls: number;
      gpsReply?: PositionCallback;
      gpsFailure?: PositionErrorCallback;
    };
    state.gpsCalls = 0;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback, failure: PositionErrorCallback) => {
          state.gpsCalls += 1;
          state.gpsReply = success;
          state.gpsFailure = failure;
        },
      },
    });
  });
  await prepare(page);
  let form = await newForm(page, `GPS race ${info.project.name}`);
  expect(await page.evaluate(() => (window as unknown as { gpsCalls: number }).gpsCalls)).toBe(0);
  await form.getByRole('button', { name: 'Use current location', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Finding location…', exact: true })).toBeDisabled();
  await form.getByLabel('Location (optional)', { exact: true }).fill('Kyoto Station');
  await page.evaluate(() => {
    (window as unknown as { gpsReply?: PositionCallback }).gpsReply?.({
      coords: { latitude: 35, longitude: 139 },
    } as GeolocationPosition);
  });
  await expect(form.getByLabel('Location (optional)', { exact: true })).toHaveValue(
    'Kyoto Station',
  );
  await expect(form.locator('.location-preview')).toContainText('No coordinates extracted');
  await form.getByRole('button', { name: 'Use current location', exact: true }).click();
  await page.evaluate(() => {
    (window as unknown as { gpsFailure?: PositionErrorCallback }).gpsFailure?.({
      code: 1,
    } as GeolocationPositionError);
  });
  await expect(form.getByRole('alert')).toContainText('Location permission was not granted');
  await form.getByRole('button', { name: 'Use current location', exact: true }).click();
  await form.getByRole('button', { name: 'Close purchase form', exact: true }).click();
  await page.getByRole('button', { name: 'Add purchase', exact: true }).click();
  form = page.getByRole('dialog', { name: 'Add a purchase', exact: true });
  await page.evaluate(() => {
    (window as unknown as { gpsReply?: PositionCallback }).gpsReply?.({
      coords: { latitude: 33, longitude: 130 },
    } as GeolocationPosition);
  });
  await expect(form.getByLabel('Location (optional)', { exact: true })).toHaveValue(
    'Kyoto Station',
  );
  // Starting a save also supersedes GPS. Its late callback cannot change the
  // draft after the request body has already been sent.
  let releaseSave: (() => Promise<void>) | undefined;
  await page.route('**/api/v1/purchases', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    releaseSave = () => route.abort('failed');
  });
  await form.getByRole('button', { name: 'Use current location', exact: true }).click();
  await form.getByRole('button', { name: 'Save purchase', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
  await expect(
    form.getByRole('button', { name: 'Use current location', exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    (window as unknown as { gpsReply?: PositionCallback }).gpsReply?.({
      coords: { latitude: 31, longitude: 131 },
    } as GeolocationPosition);
  });
  await expect(form.getByLabel('Location (optional)', { exact: true })).toHaveValue(
    'Kyoto Station',
  );
  await expect.poll(() => !!releaseSave).toBe(true);
  await releaseSave!();
  await expect(form.getByRole('button', { name: 'Save purchase', exact: true })).toBeEnabled();
  await expect(
    form.getByRole('button', { name: 'Use current location', exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('a GPS timeout retries automatically, reports accuracy, and can be canceled safely', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const state = window as unknown as {
      gpsSuccess: PositionCallback[];
      gpsFailure: PositionErrorCallback[];
      gpsOptions: PositionOptions[];
    };
    state.gpsSuccess = [];
    state.gpsFailure = [];
    state.gpsOptions = [];
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (
          success: PositionCallback,
          failure: PositionErrorCallback,
          options: PositionOptions,
        ) => {
          state.gpsSuccess.push(success);
          state.gpsFailure.push(failure);
          state.gpsOptions.push(options);
        },
      },
    });
  });
  await prepare(page);
  const form = await newForm(page, `GPS timeout ${info.project.name}`);
  await form.getByLabel('Location (optional)', { exact: true }).fill('Kyoto Station');
  await form.getByRole('button', { name: 'Use current location', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { gpsOptions: PositionOptions[] }).gpsOptions[0],
    ),
  ).toEqual({ enableHighAccuracy: false, timeout: 20_000, maximumAge: 60_000 });
  await page.evaluate(() =>
    (window as unknown as { gpsFailure: PositionErrorCallback[] }).gpsFailure[0]!({
      code: 3,
    } as GeolocationPositionError),
  );
  await expect(form.getByRole('status')).toContainText('Retrying with a more accurate fix');
  expect(
    await page.evaluate(
      () => (window as unknown as { gpsOptions: PositionOptions[] }).gpsOptions[1],
    ),
  ).toEqual({ enableHighAccuracy: true, timeout: 30_000, maximumAge: 60_000 });
  await page.evaluate(() =>
    (window as unknown as { gpsSuccess: PositionCallback[] }).gpsSuccess[1]!({
      coords: { latitude: 35.6812, longitude: 139.7671, accuracy: 37 },
    } as GeolocationPosition),
  );
  await expect(form.getByLabel('Location (optional)', { exact: true })).toHaveValue(
    '35.6812, 139.7671',
  );
  await expect(form).toContainText('estimated accuracy ±37 m');
  await form.getByLabel('Location (optional)', { exact: true }).fill('Kyoto Station');
  await form.getByRole('button', { name: 'Use current location', exact: true }).click();
  await page.evaluate(() => {
    const state = window as unknown as { gpsFailure: PositionErrorCallback[] };
    state.gpsFailure[2]!({ code: 3 } as GeolocationPositionError);
    state.gpsFailure[3]!({ code: 3 } as GeolocationPositionError);
  });
  await expect(form.getByRole('alert')).toContainText('Location Services and Wi-Fi');
  await expect(form.getByLabel('Location (optional)', { exact: true })).toHaveValue(
    'Kyoto Station',
  );
  await form.getByRole('button', { name: 'Use current location', exact: true }).click();
  await form.getByRole('button', { name: 'Cancel location request', exact: true }).click();
  await page.evaluate(() =>
    (window as unknown as { gpsFailure: PositionErrorCallback[] }).gpsFailure[4]!({
      code: 3,
    } as GeolocationPositionError),
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { gpsOptions: PositionOptions[] }).gpsOptions.length,
    ),
  ).toBe(5);
  await expect(
    form.getByRole('button', { name: 'Use current location', exact: true }),
  ).toBeEnabled();
  await expect(form.getByRole('alert')).toHaveCount(0);
  await expect(form.getByLabel('Location (optional)', { exact: true })).toHaveValue(
    'Kyoto Station',
  );
});
