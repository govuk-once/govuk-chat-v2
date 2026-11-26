import { expect, test } from '@playwright/test';
import { requireRunContext } from './run-context.ts';

test('signs in through the Hosted UI to the chat page', async ({ page }) => {
  await page.goto(requireRunContext('demoUiUrl'));

  // Cognito's sign-in page renders its form twice - one for mobile and one for
  // desktop - with the same element ids. Labels point at the first form, so
  // `getByLabel` can miss the visible field. So instead each locator is
  // filtered to the visible match.
  await page
    .getByRole('textbox', { name: 'Username' })
    .filter({ visible: true })
    .fill(requireRunContext('username'));
  // Playwright's report titles each fill step with the value filled, so the
  // password is set directly to keep it out of the report CI uploads.
  await page
    .getByRole('textbox', { name: 'Password' })
    .filter({ visible: true })
    .evaluate((input, password) => {
      input.value = password;
    }, requireRunContext('password'));
  await page
    .getByRole('button', { name: 'submit' })
    .filter({ visible: true })
    .click();

  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
});
