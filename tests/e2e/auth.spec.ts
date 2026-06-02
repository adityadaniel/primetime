import { expect, test } from '@playwright/test';
import { type Credentials, loginViaUi, logout, signupViaUi, uniqueEmail } from './helpers/auth';
import { db, resetDatabase } from './helpers/db';

test.describe('auth lifecycle', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test.afterAll(async () => {
    await db.$disconnect();
  });

  test('signup creates a user and lands on /host', async ({ page }) => {
    const creds: Credentials = {
      email: uniqueEmail('signup'),
      password: 'correct horse battery',
      name: 'Ada Lovelace',
    };
    await signupViaUi(page, creds);
    await expect(page).toHaveURL(/\/host$/);

    const user = await db.user.findUnique({ where: { email: creds.email } });
    expect(user, 'user row should exist after signup').not.toBeNull();
    expect(user?.passwordHash, 'password should be hashed, not stored raw').toBeTruthy();
    expect(user?.passwordHash).not.toBe(creds.password);
    expect(user?.name).toBe('Ada Lovelace');
  });

  test('sign out then sign back in restores the session', async ({ page }) => {
    const creds: Credentials = {
      email: uniqueEmail('signin'),
      password: 'a-strong-passphrase',
    };
    await signupViaUi(page, creds);

    await logout(page); // ends at /signin (protected /host bounced)

    await loginViaUi(page, creds);
    await expect(page).toHaveURL(/\/host$/);
    // Session is real: a protected route loads without redirect.
    await page.goto('/host');
    await expect(page).toHaveURL(/\/host$/);
  });

  test('forgot/reset flow updates the password (UI + dev-token capture)', async ({ page }) => {
    const email = uniqueEmail('reset');
    const oldPassword = 'old-password-123';
    const newPassword = 'brand-new-password-456';

    await signupViaUi(page, { email, password: oldPassword });
    await logout(page);

    // Request the reset link via the /reset form; the dev-only devUrl is shown
    // on-page (EMAIL_PROVIDER=token-print), mirroring the email a user gets.
    await page.goto('/reset');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: /send reset link/i }).click();

    const resetLink = page.locator('a[href*="/reset/"]');
    await expect(resetLink).toBeVisible();
    const resetUrl = await resetLink.getAttribute('href');
    expect(resetUrl, 'dev reset link should be rendered').toBeTruthy();

    // Set the new password on the token page → auto sign-in → /host.
    await page.goto(resetUrl as string);
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: /update password/i }).click();
    await page.waitForURL('**/host', { timeout: 15_000 });

    // The new password works and the old one no longer does.
    await logout(page);
    await loginViaUi(page, { email, password: newPassword });
    await expect(page).toHaveURL(/\/host$/);

    await logout(page);
    await page.goto('/signin');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(oldPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/couldn't sign you in/i)).toBeVisible();
    await expect(page).toHaveURL(/\/signin/);
  });

  test('first-run admin banner shows only on a fresh install', async ({ page }) => {
    // beforeEach truncated User → zero users → first run.
    await page.goto('/signup');
    await expect(page.getByText(/you will be the first admin/i)).toBeVisible();

    // Once any user exists, the banner is gone.
    await db.user.create({
      data: { email: uniqueEmail('seed'), passwordHash: 'not-a-real-hash' },
    });
    await page.goto('/signup');
    await expect(page.getByText(/you will be the first admin/i)).toHaveCount(0);
  });

  test('duplicate signup is rejected', async ({ page }) => {
    const creds: Credentials = {
      email: uniqueEmail('dupe'),
      password: 'first-account-password',
    };
    await signupViaUi(page, creds);
    await logout(page);

    await page.goto('/signup');
    await page.getByLabel('Email', { exact: true }).fill(creds.email);
    await page.getByLabel('Password', { exact: true }).fill('another-password');
    await page.getByLabel('Confirm password', { exact: true }).fill('another-password');
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(page.getByText(/account (already )?exists with that email/i)).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);
    // Still exactly one user with that email.
    const count = await db.user.count({ where: { email: creds.email } });
    expect(count).toBe(1);
  });
});
