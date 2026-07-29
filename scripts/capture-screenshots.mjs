#!/usr/bin/env node
/**
 * capture-screenshots.mjs — Playwright script to capture template form screenshots.
 *
 * Navigates to each Backstage scaffolder template, fills in conditional
 * dropdowns where needed, and captures the form as a PNG for the docs site.
 *
 * Prerequisites:
 *   - Backstage running locally (make dev)
 *   - Playwright browsers installed (npx playwright install chromium)
 *
 * Usage:
 *   node scripts/capture-screenshots.mjs
 *   node scripts/capture-screenshots.mjs --base-url http://localhost:3000
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'pages', 'img');
mkdirSync(outDir, { recursive: true });

const baseUrl = process.argv.includes('--base-url')
  ? process.argv[process.argv.indexOf('--base-url') + 1]
  : 'http://localhost:3000';

const TEMPLATES = [
  {
    name: 'vault-l0-admin-onboarding',
    slug: 'admin-onboarding',
    label: 'L0 Admin Onboarding',
    variants: [{ name: 'form', label: 'default form' }],
  },
  {
    name: 'vault-l1-trust',
    slug: 'trust-onboarding',
    label: 'L1 Trust Onboarding',
    variants: [
      { name: 'cluster', label: 'Kubernetes cluster', field: 'Trust Type', value: 'cluster' },
      { name: 'gitlab', label: 'GitLab instance', field: 'Trust Type', value: 'gitlab' },
    ],
  },
  {
    name: 'vault-l2-workload',
    slug: 'workload-onboarding',
    label: 'L2 Workload Onboarding',
    variants: [
      { name: 'k8s', label: 'Kubernetes', field: 'Workload Type', value: '0' },
      { name: 'gitlab', label: 'GitLab', field: 'Workload Type', value: '1' },
    ],
  },
  {
    name: 'vault-l3-usecase',
    slug: 'usecase-onboarding',
    label: 'L3 Use-case Onboarding',
    variants: [
      { name: 'kvv2', label: 'KVv2 (K8s)', field: 'Use-case Type', value: '0' },
      { name: 'kvv2-gitlab', label: 'KVv2 (GitLab)', field: 'Use-case Type', value: '1' },
      { name: 'pgsql-role', label: 'PostgreSQL role', field: 'Use-case Type', value: '2' },
      { name: 'permission-group', label: 'Permission group', field: 'Use-case Type', value: '3' },
      { name: 'pgsql-connection', label: 'PostgreSQL connection', field: 'Use-case Type', value: '4' },
    ],
  },
];

async function selectMuiDropdown(page, fieldLabel, optionValue) {
  // Backstage scaffolder enum fields render as MUI Select:
  //   <label id="root_<field>-label" for="root_<field>">Label</label>
  //   <div role="button" aria-haspopup="listbox" id="root_<field>">...text...</div>
  //   <input name="root_<field>" aria-hidden="true" value="currentValue">

  // Step 1: find the MUI Select trigger via the label's `for` attribute
  const labelEl = page.locator(`label:has-text("${fieldLabel}")`).first();
  if (!(await labelEl.count())) {
    console.warn(`  ⚠ Label "${fieldLabel}" not found`);
    return;
  }
  const fieldId = await labelEl.getAttribute('for');
  const trigger = page.locator(`#${fieldId}[role="button"]`);
  if (!(await trigger.count())) {
    console.warn(`  ⚠ MUI Select trigger #${fieldId} not found`);
    return;
  }

  // Step 2: click to open the dropdown menu
  await trigger.click();
  await page.waitForTimeout(500);

  // Step 3: the listbox appears as a <ul role="listbox"> in a portal.
  // Each option is <li role="option" data-value="cluster">
  const option = page.locator(`li[role="option"][data-value="${optionValue}"]`).first();
  if (await option.count()) {
    await option.click();
    await page.waitForTimeout(800);
    return;
  }

  // Fallback: match by visible text instead of data-value
  const optionByText = page.locator(`li[role="option"]`);
  const count = await optionByText.count();
  for (let i = 0; i < count; i++) {
    const text = await optionByText.nth(i).textContent();
    const dataVal = await optionByText.nth(i).getAttribute('data-value');
    if (dataVal === optionValue || text.toLowerCase().includes(optionValue.toLowerCase())) {
      await optionByText.nth(i).click();
      await page.waitForTimeout(800);
      return;
    }
  }

  console.warn(`  ⚠ Option "${optionValue}" not found in listbox for "${fieldLabel}"`);
  await page.keyboard.press('Escape');
}

async function main() {
  console.log(`Connecting to ${baseUrl}...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Sign in as guest
  await page.goto(`${baseUrl}`, { waitUntil: 'networkidle', timeout: 30000 });
  console.log('Signing in as guest...');
  const enterBtn = page.locator('button:has-text("ENTER")').first();
  await enterBtn.waitFor({ state: 'visible', timeout: 10000 });
  await enterBtn.click();
  await page.waitForURL('**/catalog', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log(`Signed in. Current URL: ${page.url()}`);

  for (const template of TEMPLATES) {
    console.log(`\n📸 ${template.label}`);
    const templateUrl = `${baseUrl}/create/templates/default/${template.name}`;

    for (const variant of template.variants) {
      const filename = template.variants.length === 1
        ? `${template.slug}-form.png`
        : `${template.slug}-${variant.name}.png`;

      console.log(`  → ${variant.label} → ${filename}`);

      await page.goto(templateUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);

      // Select variant if there's a conditional dropdown
      if (variant.field) {
        await selectMuiDropdown(page, variant.field, variant.value);
        await page.waitForTimeout(1000);
      }

      // Capture the main content area (exclude sidebar navigation)
      const mainContent = page.locator('main, [class*="MuiPaper-root"]').first();
      const target = (await mainContent.count()) ? mainContent : page;

      // Full page screenshot to get all form fields
      await page.screenshot({
        path: join(outDir, filename),
        fullPage: true,
      });

      console.log(`  ✓ saved ${filename}`);
    }
  }

  await browser.close();
  console.log(`\n✅ All screenshots saved to pages/img/`);
}

main().catch(err => {
  console.error('Screenshot capture failed:', err.message);
  process.exit(1);
});
