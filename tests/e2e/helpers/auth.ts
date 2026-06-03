// Browser-driven auth helpers. These exercise the real UI + Auth.js flows
// (signup form → signIn('credentials'), signin form, next-auth signout) so the
// E2E suite covers the same path a user takes, not just the API surface.

import { expect, type Page } from '@playwright/test';

export interface Credentials {
  email: string;
  password: string;
  name?: string;
}

let emailCounter = 0;
/** A unique, lowercase email per call so tests never collide on User.email or
 * trip the per-email signup rate limit across repeated runs. */
export function uniqueEmail(prefix = 'e2e'): string {
  emailCounter += 1;
  return `${prefix}-${Date.now()}-${emailCounter}@example.test`;
}

/** Sign up through the /signup form and wait for the post-signup redirect to
 * /host (the form auto-signs-in via Credentials on success). */
export async function signupViaUi(page: Page, creds: Credentials): Promise<void> {
  await page.goto('/signup');
  if (creds.name) {
    await page.getByLabel('Display name (optional)').fill(creds.name);
  }
  await page.getByLabel('Email', { exact: true }).fill(creds.email);
  await page.getByLabel('Password', { exact: true }).fill(creds.password);
  await page.getByLabel('Confirm password', { exact: true }).fill(creds.password);
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL('**/host', { timeout: 15_000 });
}

/** Sign in through the /signin form and wait for redirect to /host. */
export async function loginViaUi(page: Page, creds: Credentials): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email', { exact: true }).fill(creds.email);
  await page.getByLabel('Password', { exact: true }).fill(creds.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/host', { timeout: 15_000 });
}

/** Sign out via the Auth.js endpoint (clears the session cookie in this
 * browser context). Verifies the session is gone by hitting a protected route. */
export async function logout(page: Page): Promise<void> {
  const csrfRes = await page.request.get('/api/auth/csrf');
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  await page.request.post('/api/auth/signout', {
    form: { csrfToken, callbackUrl: '/' },
  });
  // Protected route must now bounce to /signin (middleware).
  await page.goto('/host');
  await page.waitForURL('**/signin**', { timeout: 15_000 });
}

/**
 * Kick off a password reset and return the reset URL. With EMAIL_PROVIDER=
 * token-print and NODE_ENV!==production, POST /api/auth/reset echoes the reset
 * link as `devUrl` in its JSON — no log scraping or mailer harness needed.
 */
export async function requestResetUrl(page: Page, email: string): Promise<string> {
  const res = await page.request.post('/api/auth/reset', {
    data: { email: email.toLowerCase() },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { ok: boolean; devUrl?: string };
  expect(body.devUrl, 'reset response should include devUrl in dev mode').toBeTruthy();
  return body.devUrl as string;
}
