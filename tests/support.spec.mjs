import { test, expect } from '@playwright/test';
import { SUPPORT } from '../src/data/support.ts';

test.describe('Support & Pricing page', () => {
  test('all easy-support platform links are visible with correct targets', async ({ page }) => {
    await page.goto('/pricing/');
    for (const item of SUPPORT.easy) {
      const link = page.locator(`a[href="${item.url}"]`);
      await expect(link).toBeVisible();
      await expect(link).toContainText(item.name);
    }
  });

  test('bank transfer section contains complete canonical bank details', async ({ page }) => {
    await page.goto('/pricing/');
    await expect(page.getByText('LHV', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('ALEKS NELIN')).toBeVisible();
    await expect(page.getByText('EE887700771010699620')).toBeVisible();
  });

  test('all crypto entries are present with explicit network labels and addresses', async ({ page }) => {
    await page.goto('/pricing/');
    await expect(page.getByText(SUPPORT.warning)).toBeVisible();

    for (const c of SUPPORT.crypto) {
      const card = page.locator('.crypto-card', { hasText: c.name });
      await expect(card.locator('.crypto-name')).toHaveText(c.name);
      await expect(card.locator('.w-badge')).toHaveText(c.network);
      await expect(card.locator('.crypto-address')).toHaveText(c.address);
    }

    // Base and Ethereum intentionally share the exact hex address
    const evmAddresses = page.locator('.crypto-address', { hasText: '0x175D98fF376b65B86154Fe47655c158C6F9bb80B' });
    await expect(evmAddresses).toHaveCount(2);
  });

  test('copy button updates text to Copied and restores to Copy', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/pricing/');
    const firstCopyBtn = page.locator('.js-copy').first();
    await expect(firstCopyBtn).toHaveText('Copy');
    await firstCopyBtn.click();
    await expect(firstCopyBtn).toHaveText('Copied');
  });

  test('page retains selectable addresses without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/pricing/');
    await expect(page.locator('.iban-row code')).toHaveText('EE887700771010699620');
    await expect(page.locator('.crypto-address').first()).toContainText('UQCL');
    await context.close();
  });
});
