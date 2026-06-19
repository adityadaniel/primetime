// WonderWall browser release gate (MID-408): verifies the shipped v1 flow with
// real pages plus the host-only CSV endpoint. The test keeps setup mostly
// browser-driven (signup, create wall, participant submissions, host review) and
// uses Prisma only to seed a FAILED audit row because the public submit endpoint
// intentionally rejects unsupported URLs without creating displayable state.

import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './e2e-env';
import { signupViaUi, uniqueEmail } from './helpers/auth';
import { db, resetDatabase } from './helpers/db';

function linkedInUrl(id: string): string {
  return `https://www.linkedin.com/feed/update/urn:li:activity:${id}`;
}

async function submitPost(page: import('@playwright/test').Page, url: string) {
  await page.getByLabel('LinkedIn post URL').fill(url);
  await page.getByRole('button', { name: /send for review/i }).click();
  await expect(page.getByText('Submitted for host review')).toBeVisible({ timeout: 10_000 });
}

// Master-detail control room: click a post's row in the LEFT sidebar (<aside>)
// to select it, then act in the RIGHT detail pane (the single <article>). The
// sidebar row carries the URN when the submission has no nickname (the anonymous
// e2e flow). After selecting, wait for the detail pane to reflect the choice so
// actions never fire against the previously-selected post.
async function selectPost(page: import('@playwright/test').Page, id: string) {
  await page
    .locator('aside')
    .getByRole('button')
    .filter({ hasText: `urn:li:activity:${id}` })
    .click();
  await expect(page.locator('article')).toContainText(`urn:li:activity:${id}`);
}

function detailPane(page: import('@playwright/test').Page) {
  return page.locator('article');
}

test.describe('WonderWall release flow', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('create → submit → reject/retry → approve/display → export CSV', async ({
    browser,
    page,
  }) => {
    // Host signs up through the real UI and creates a WonderWall.
    await signupViaUi(page, {
      email: uniqueEmail('wonderwall'),
      password: 'wonderwall-release-pass',
      name: 'WonderWall Host',
    });

    await page.goto('/host/wonderwall/new');
    await page.getByLabel(/wall title/i).fill('WonderWall E2E');
    await page.getByLabel(/description/i).fill('Release verification wall');
    await page.getByLabel(/participant instructions/i).fill('Share a public LinkedIn post.');
    await page.getByRole('button', { name: /start activity/i }).click();
    await page.waitForURL(/\/host\/wonderwall\/\d{6}\/control$/);

    const pin = page.url().match(/\/host\/wonderwall\/(\d{6})\/control$/)?.[1];
    expect(pin, 'control URL should include a six-digit PIN').toBeTruthy();
    const session = await db.wonderWallSession.findUniqueOrThrow({ where: { pin: pin! } });
    await expect(page.getByRole('link', { name: /open display/i })).toHaveAttribute(
      'href',
      `${E2E_BASE_URL}/host/wonderwall/${pin}/display`,
    );

    // Public display must be reachable without the host session and initially
    // show zero approved posts.
    const displayContext = await browser.newContext();
    const displayPage = await displayContext.newPage();
    await displayPage.goto(`/host/wonderwall/${pin}/display`);
    await expect(displayPage).toHaveURL(new RegExp(`/host/wonderwall/${pin}/display$`));
    await expect(displayPage.getByText('Waiting for approved LinkedIn posts.')).toBeVisible();
    await expect(displayPage.locator('iframe[title="Embedded LinkedIn post"]')).toHaveCount(0);

    // Participant submits three valid URLs from an anonymous browser. The first
    // will be rejected, the second approved/displayed, the third left pending.
    const participantContext = await browser.newContext();
    const participantPage = await participantContext.newPage();
    await participantPage.goto(`/play/${pin}/wonderwall`);
    await expect(participantPage.getByText(`PIN ${pin}`)).toBeVisible();

    const rejectedId = '1000000000000000001';
    const approvedId = '1000000000000000002';
    const pendingId = '1000000000000000003';

    await submitPost(participantPage, linkedInUrl(rejectedId));
    await submitPost(participantPage, linkedInUrl(approvedId));
    await submitPost(participantPage, linkedInUrl(pendingId));

    // Pending submissions stay off the public display before host approval.
    await displayPage.reload();
    await expect(displayPage.getByText('Waiting for approved LinkedIn posts.')).toBeVisible();
    await expect(displayPage.locator('iframe[title="Embedded LinkedIn post"]')).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'PENDING REVIEW' })).toBeVisible();

    await selectPost(page, rejectedId);
    const rejectDetail = detailPane(page);
    await rejectDetail.getByRole('button', { name: 'REJECT' }).click();
    await rejectDetail.getByPlaceholder(/optional reason/i).fill('Off-topic for this wall');
    await rejectDetail.getByRole('button', { name: 'CONFIRM REJECT' }).click();
    await expect(page.getByText('Reason: Off-topic for this wall')).toBeVisible({
      timeout: 10_000,
    });

    // Participant feedback polls, but a reload makes the browser assertion
    // deterministic while still exercising the public my-posts endpoint.
    await participantPage.reload();
    await expect(participantPage.getByText('NOT USED')).toBeVisible({ timeout: 10_000 });
    await expect(participantPage.getByText('Off-topic for this wall')).toBeVisible();
    await expect(
      participantPage.getByText('The host passed on this one. Try another post.'),
    ).toBeVisible();
    await expect(participantPage.getByText('↑ PASTE A NEW LINK ABOVE TO TRY AGAIN')).toBeVisible();

    await selectPost(page, approvedId);
    const approveDetail = detailPane(page);
    await approveDetail.getByRole('button', { name: 'APPROVE' }).click();
    await expect(approveDetail.getByText('APPROVED')).toBeVisible({ timeout: 10_000 });
    await expect(approveDetail.getByText('CAN DISPLAY: YES')).toBeVisible();

    await displayPage.reload();
    await expect(displayPage.getByText('ON AIR · 01 APPROVED POSTS')).toBeVisible({
      timeout: 10_000,
    });
    const iframe = displayPage.locator('iframe[title="Embedded LinkedIn post"]');
    await expect(iframe).toHaveCount(1);
    await expect(iframe).toHaveAttribute(
      'src',
      `https://www.linkedin.com/embed/feed/update/urn:li:activity:${approvedId}?collapsed=1`,
    );
    await expect(iframe).toHaveAttribute('height', '620');
    await expect(
      displayPage.locator('.columns-1.md\\:columns-3'),
      'display waterfall should use three columns on desktop',
    ).toHaveCSS('column-count', '3');
    await expect(displayPage.getByRole('link', { name: /open on linkedin/i })).toHaveAttribute(
      'href',
      linkedInUrl(approvedId),
    );
    await expect(displayPage.getByText(`urn:li:activity:${pendingId}`)).toHaveCount(0);

    // Create one hidden row through the host UI, and one FAILED audit row via DB
    // so the CSV proof covers every WonderWallPostStatus value.
    const hiddenId = '1000000000000000004';
    await submitPost(participantPage, linkedInUrl(hiddenId));
    await page.reload();
    await selectPost(page, hiddenId);
    const hiddenDetail = detailPane(page);
    await hiddenDetail.getByRole('button', { name: 'APPROVE' }).click();
    await expect(hiddenDetail.getByText('APPROVED')).toBeVisible({ timeout: 10_000 });
    await hiddenDetail.getByRole('button', { name: 'HIDE' }).click();
    await expect(hiddenDetail.getByText('HIDDEN')).toBeVisible({ timeout: 10_000 });

    const failedId = '1000000000000000005';
    await db.wonderWallPost.create({
      data: {
        sessionId: session.id,
        originalUrl: linkedInUrl(failedId),
        urn: `urn:li:activity:${failedId}`,
        embedUrl: `https://www.linkedin.com/embed/feed/update/urn:li:activity:${failedId}`,
        status: 'FAILED',
        canDisplay: false,
        submitterName: '=spreadsheet user',
        submitterKey: '@submitter-key',
        failureReason: '@unsupported embed',
      },
    });

    // Host-only CSV export: same browser context as the signed-in host, includes
    // all statuses and metadata, but no LinkedIn body/profile/comment fields.
    const csvRes = await page.request.get(`/api/wonderwall/${pin}/export`);
    expect(csvRes.status()).toBe(200);
    expect(csvRes.headers()['content-type']).toContain('text/csv; charset=utf-8');
    expect(csvRes.headers()['content-disposition']).toBe(
      `attachment; filename="wonderwall-${pin}-submissions.csv"`,
    );
    const csv = await csvRes.text();
    expect(csv.split('\r\n')[0]).toBe(
      'submittedAt,status,canDisplay,originalUrl,urn,embedUrl,submitterName,submitterKey,reviewedAt,reviewedByHostUserId,rejectionReason,displayOrder,failureReason',
    );
    for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN', 'FAILED']) {
      expect(csv).toContain(`,${status},`);
    }
    expect(csv).toContain("'=spreadsheet user");
    expect(csv).toContain("'@submitter-key");
    expect(csv).toContain("'@unsupported embed");
    for (const forbidden of ['body', 'profile', 'reaction', 'comment', 'image']) {
      expect(csv.toLowerCase()).not.toContain(forbidden);
    }

    await participantContext.close();
    await displayContext.close();
  });
});
