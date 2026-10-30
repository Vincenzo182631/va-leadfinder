import { expect, test } from '@playwright/test';
import { login, openOpportunity, signupAndOnboard } from './helpers';

const ADMIN_EMAIL = 'e2e.admin@example.test';
const adminPassword = () => process.env.E2E_ADMIN_PASSWORD!;

test('1. user signs up and completes onboarding; demo data is labelled', async ({ page }) => {
  await signupAndOnboard(page);
  await expect(page.getByRole('heading', { name: 'Hello, Juana Dela Cruz' })).toBeVisible();
  await expect(page.getByText('DEMO DATA — NOT REAL LEADS')).toBeVisible();
  await expect(page.getByText('Demo only (fictional data)')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();
});

test('2. user searches and filters demo opportunities', async ({ page }) => {
  await signupAndOnboard(page);
  await page.goto('/app/discover');
  await expect(page.getByText(/You are viewing demo data/)).toBeVisible();
  await page.getByLabel('Search opportunities').fill('Coastline');
  await page.getByRole('search').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'GoHighLevel CRM Assistant (contract)' })).toBeVisible();
  await page.getByLabel('Search opportunities').fill('');
  await page.getByRole('search').getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByLabel('Skill').selectOption('automation');
  await expect(page.getByRole('link', { name: 'Automation Specialist (Zapier/GHL)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Scheduling & CRM VA' })).toHaveCount(0);
  // US-only role hidden by default, visible (with restriction badge) when requested.
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page).not.toHaveURL(/skill=/);
  await expect(page.getByLabel('Skill')).toHaveValue('');
  await page.getByLabel('Minimum match score').selectOption('0');
  await expect(page).toHaveURL(/minScore=0/);
  await expect(page.getByRole('link', { name: 'Real Estate Admin Assistant' })).toHaveCount(0);
  await page.getByRole('button', { name: 'show them' }).click();
  const card = page.getByRole('article').filter({ hasText: 'Real Estate Admin Assistant' });
  await expect(card.getByText('Region restricted')).toBeVisible();
});

test('3. user views source attribution and match explanation', async ({ page }) => {
  await signupAndOnboard(page);
  await openOpportunity(page, 'GoHighLevel CRM Assistant (contract)');
  await expect(page.getByRole('heading', { name: 'Why it matched' })).toBeVisible();
  for (const l of ['Skill relevance', 'Hiring signal', 'Remote & contract fit', 'Freshness']) await expect(page.getByText(l, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('VA LeadFinder Demo Data')).toBeVisible();
  await expect(page.getByText(/Demo opportunity/)).toBeVisible();
  await expect(page.getByRole('link', { name: /View original source/ })).toHaveCount(0); // locked until unlock
  await page.getByRole('button', { name: 'Unlock opportunity' }).click();
  const src = page.getByRole('link', { name: /View original source/ });
  await expect(src).toHaveAttribute('href', /^https:\/\/example\.com\/demo\//);
  await expect(src).toHaveAttribute('rel', /noopener/);
});

test('4. user saves a prospect, adds notes, and changes stage', async ({ page }) => {
  await signupAndOnboard(page);
  await openOpportunity(page, 'Scheduling & CRM VA');
  await page.getByRole('button', { name: 'Unlock opportunity' }).click();
  await page.getByRole('button', { name: 'Save to pipeline' }).click();
  await page.getByLabel('Notes').fill('Check their careers page for a contact form.');
  await page.getByRole('button', { name: 'Save notes' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByLabel('Stage').selectOption('researching');
  await page.goto('/app/pipeline');
  const item = page.getByRole('listitem').filter({ hasText: 'Scheduling & CRM VA' });
  await expect(item.getByText('Check their careers page')).toBeVisible();
  await expect(item.getByRole('combobox')).toHaveValue('researching');
  await item.getByRole('combobox').selectOption('contacted');
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'Scheduling & CRM VA' }).getByRole('combobox')).toHaveValue('contacted');
});

test('5. user creates and copies an outreach draft', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signupAndOnboard(page);
  await openOpportunity(page, 'Transaction Coordinator VA');
  await page.getByRole('button', { name: 'Unlock opportunity' }).click();
  await page.getByLabel('Template').selectOption('ghl_crm');
  await page.getByRole('button', { name: 'Create draft' }).click();
  const draft = page.getByLabel('Draft message');
  await expect(draft).toHaveValue(/Hello Demo Sage Property Team team/);
  await expect(draft).toHaveValue(/Juana Dela Cruz/);
  await page.getByRole('button', { name: /Copy draft/ }).click();
  await expect(page.getByRole('button', { name: /Copied!/ })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Demo Sage Property Team');
  await expect(page.getByText(/follow applicable outreach and anti-spam laws/)).toBeVisible();
});

test('6. plan limits are shown and enforced by the server', async ({ page }) => {
  await signupAndOnboard(page);
  const titles = ['GoHighLevel CRM Assistant (contract)', 'Automation Specialist (Zapier/GHL)', 'Scheduling & CRM VA', 'Transaction Coordinator VA', 'Executive Assistant to Founder', 'Travel Booking Assistant'];
  for (const t of titles.slice(0, 5)) {
    await openOpportunity(page, t);
    await page.getByRole('button', { name: 'Unlock opportunity' }).click();
    await expect(page.getByRole('heading', { name: 'Opportunity summary' })).toBeVisible();
  }
  await openOpportunity(page, titles[5]!);
  await page.getByRole('button', { name: 'Unlock opportunity' }).click();
  await expect(page.getByText('Monthly limit reached')).toBeVisible();
  await expect(page.getByText(/used all 5 unlocks/)).toBeVisible();
  await page.goto('/app/account');
  await expect(page.getByText('5 / 5')).toBeVisible();
});

test('7. admin creates a properly attributed opportunity through the licensing gate', async ({ page }) => {
  await login(page, ADMIN_EMAIL, adminPassword());
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Sources' }).click();
  await page.getByRole('button', { name: 'Register a manual source' }).click();
  await page.getByLabel('Source name').fill('E2E Partner Board');
  await page.getByLabel('Homepage URL').fill('https://partner.example.com');
  await page.getByLabel('Identifier').fill('e2e_partner');
  await page.getByLabel('Data type').fill('Partner job summaries');
  await page.getByRole('button', { name: /Create \(starts disabled/ }).click();
  const card = page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: /E2E Partner Board/ }) });
  await expect(card.getByText('Licence: draft')).toBeVisible();
  await card.getByRole('button', { name: 'Compliance review' }).click();
  // Approval without the checklist is refused.
  await card.getByRole('button', { name: 'Approve licence' }).click();
  await expect(card.getByText(/Complete the compliance checklist first/)).toBeVisible();
  await card.getByLabel('Attribution text shown to users').fill('Summaries via E2E Partner Board');
  await card.getByLabel('Contract / permission reference').fill('Agreement E2E-001 (signed)');
  for (const l of ['Commercial use approved in writing', 'Redistribution to paying subscribers approved in writing', 'Source terms reviewed for this exact paid, signup-gated use', 'Commercial use confirmed in writing', 'Redistribution to subscribers confirmed in writing', 'Required attribution configured', 'Retention / expiry limits configured', 'Personal-data / privacy (DPA, NPC) review completed']) await card.getByLabel(l).check();
  await card.getByRole('button', { name: 'Approve licence' }).click();
  await expect(card.getByText('Licence: approved')).toBeVisible();
  await card.getByRole('button', { name: 'Enable source' }).click();
  await expect(card.getByText('Enabled', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Add / import' }).click();
  await page.getByLabel('Manual source').selectOption({ label: 'E2E Partner Board (approved, enabled)' });
  await page.getByLabel(/I confirm these records come from this source/).check();
  await page.getByLabel('Company name').fill('Northstar Admin Partners');
  await page.getByLabel('Role / business need').fill('Remote Calendar & Inbox Assistant');
  await page.getByLabel('Original summary (your own words)').fill('A growing consultancy needs part-time inbox and calendar support from a remote contractor.');
  await page.getByLabel('Hiring signal note').fill('Posted on partner board this week');
  await page.getByLabel('Eligibility (as stated)').selectOption('worldwide');
  await page.getByLabel('Source URL').fill('https://partner.example.com/jobs/123');
  await page.getByLabel('Business contact route (URL or generic mailbox)').fill('careers@northstar.example.com');
  await page.getByRole('button', { name: 'Add to moderation queue' }).click();
  await expect(page.getByText('Run succeeded')).toBeVisible();

  await page.getByRole('tab', { name: 'Moderation' }).click();
  const item = page.locator('div.rounded-2xl').filter({ hasText: 'Remote Calendar & Inbox Assistant' });
  await item.getByRole('button', { name: 'Verify & publish' }).click();
  await expect(item).toHaveCount(0);

  await page.goto('/app/discover?minScore=0&query=Northstar');
  const opp = page.getByRole('article').filter({ hasText: 'Remote Calendar & Inbox Assistant' });
  await expect(opp.getByText('Source: E2E Partner Board')).toBeVisible();
  await expect(opp.getByText('Demo', { exact: true })).toHaveCount(0);
});

test('8. a normal user cannot see admin functionality or another user’s data', async ({ page, browser }) => {
  await signupAndOnboard(page);
  await openOpportunity(page, 'Scheduling & CRM VA');
  await page.getByRole('button', { name: 'Unlock opportunity' }).click();
  await page.getByRole('button', { name: 'Save to pipeline' }).click();
  await page.getByLabel('Notes').fill('PRIVATE-NOTE-USER-A');
  await page.getByRole('button', { name: 'Save notes' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();

  const other = await (await browser.newContext()).newPage();
  await signupAndOnboard(other);
  await expect(other.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  await other.goto('/admin');
  await other.waitForURL('**/app');
  const status = await other.evaluate(async () => {
    const s = JSON.parse(sessionStorage.getItem('vlf.dev.session')!);
    return (await fetch('/api/admin/overview', { headers: { Authorization: `Bearer ${s.token}` } })).status;
  });
  expect(status).toBe(403);
  await other.goto('/app/pipeline');
  await expect(other.getByText('Your pipeline is empty')).toBeVisible();
  await expect(other.getByText('PRIVATE-NOTE-USER-A')).toHaveCount(0);
});

test('9. payment test mode updates entitlement only after a verified webhook', async ({ page }) => {
  await signupAndOnboard(page);
  await page.goto('/app/account');
  await page.getByRole('button', { name: 'Subscribe to Solo' }).click();
  await page.waitForURL('**/billing/mock-checkout**');
  await expect(page.getByText(/Plan in effect: /)).toContainText('free');
  await page.goto('/app/account');
  await expect(page.getByText('Waiting for your first payment')).toBeVisible();
  await expect(page.locator('p', { hasText: 'Current plan' }).locator('..')).toContainText('Free Preview');
  await page.goBack();
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();
  await expect(page.getByText(/outcome: processed/)).toBeVisible();
  await expect(page.getByText(/Plan in effect: /)).toContainText('solo');
  await page.goto('/app/account');
  await expect(page.locator('p', { hasText: 'Current plan' }).locator('..')).toContainText('Solo');
  await expect(page.getByText('0 / 40')).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Cancel subscription' }).click();
  await expect(page.getByText(/You will not be charged again/).first()).toBeVisible();
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  test('10. mobile layout is usable at 375px', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Find businesses that need your skills.' })).toBeVisible();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Mobile' })).toBeVisible();
    await signupAndOnboard(page);
    await page.goto('/app/discover');
    await expect(page.getByRole('navigation', { name: 'Workspace mobile' })).toBeVisible();
    await expect(page.getByRole('article').first()).toBeVisible();
    for (const path of ['/app', '/app/discover', '/app/pipeline', '/app/account']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
    }
  });
});

test('11. keyboard-only navigation of important controls', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await page.goto('/signup');
  await page.getByLabel('Your name').focus();
  await page.keyboard.type('Key Board');
  await page.keyboard.press('Tab');
  await page.keyboard.type(`kb${Date.now()}@example.test`);
  await page.keyboard.press('Tab');
  await page.keyboard.type('password123');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox')).toBeChecked();
  // Tab past the Terms and Privacy links inside the consent label, then submit.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Create account' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForURL('**/onboarding');
  await expect(page.getByRole('heading', { name: 'Tell us about you' })).toBeFocused();
  await page.getByRole('button', { name: 'Continue' }).focus();
  await page.keyboard.press('Enter');
  // Toggle a skill chip with the keyboard.
  const chip = page.getByRole('checkbox', { name: 'General VA' });
  await chip.focus();
  await page.keyboard.press('Space');
  await expect(chip).toBeChecked();
  const outline = await chip.evaluate((el) => getComputedStyle(el.parentElement!).outlineStyle);
  expect(outline).not.toBe('none');
});

test('12. empty-source and provider-error states are understandable', async ({ page, browser }) => {
  await signupAndOnboard(page);
  // Provider/API error → clear error with retry.
  await page.route('**/api/opportunities?**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'Opportunity service is temporarily unavailable.' } }) }));
  await page.goto('/app/discover');
  await expect(page.getByText("We couldn't load this")).toBeVisible();
  await expect(page.getByText('Opportunity service is temporarily unavailable.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.unroute('**/api/opportunities?**');

  // Demo mode off + no live source → explicit "no data sources" state.
  const admin = await (await browser.newContext()).newPage();
  await login(admin, ADMIN_EMAIL, adminPassword());
  await admin.goto('/admin');
  await admin.getByRole('tab', { name: 'Settings' }).click();
  const demoToggle = admin.getByLabel('Demo mode (serve fictional demo opportunities)');
  await demoToggle.click();
  await expect(demoToggle).not.toBeChecked();
  try {
    // Only meaningful if no live source is enabled; test 7 enabled one, so revoke it first.
    await admin.getByRole('tab', { name: 'Sources' }).click();
    const card = admin.locator('div.rounded-2xl').filter({ has: admin.getByRole('heading', { name: /E2E Partner Board/ }) });
    if (await card.count()) {
      await card.getByRole('button', { name: 'Compliance review' }).click();
      await card.getByRole('button', { name: 'Revoke' }).click();
      await expect(card.getByText('Licence: revoked')).toBeVisible();
    }
    await page.reload();
    await expect(page.getByText('No data sources are active')).toBeVisible();
    await expect(page.getByText('DEMO DATA — NOT REAL LEADS')).toHaveCount(0);
  } finally {
    await admin.getByRole('tab', { name: 'Settings' }).click();
    const t = admin.getByLabel('Demo mode (serve fictional demo opportunities)');
    if (!(await t.isChecked())) await t.click();
    await expect(t).toBeChecked();
  }
});
