import { expect, type Page } from '@playwright/test';

let n = 0;
export async function signupAndOnboard(page: Page, opts: { skills?: string[] } = {}) {
  const email = `va${Date.now()}${n++}@example.test`;
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Juana Dela Cruz');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/onboarding');
  await expect(page.getByRole('heading', { name: 'Tell us about you' })).toBeVisible();
  await expect(page.getByLabel('Country')).toHaveValue('PH');
  await expect(page.getByLabel('Your time zone')).toHaveValue('Asia/Manila');
  await page.getByRole('button', { name: 'Continue' }).click();
  for (const s of opts.skills ?? ['GoHighLevel / CRM', 'Automation', 'General VA']) await page.getByText(s, { exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Finish/ }).click();
  await page.waitForURL('**/app');
  return email;
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/app');
}

export async function openOpportunity(page: Page, title: string) {
  await page.goto('/app/discover');
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}
