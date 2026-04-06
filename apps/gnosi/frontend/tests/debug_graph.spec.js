import { test, expect } from '@playwright/test';

test('Debug GraphPage crash', async ({ page }) => {
  const logs = [];
  const errors = [];
  
  page.on('console', msg => logs.push(`LOG: ${msg.type()} ${msg.text()}`));
  page.on('pageerror', err => errors.push(`ERROR: ${err.message}`));

  console.log('Navigating to graph...');
  await page.goto('http://localhost:5173/graph', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000); // give it time to crash

  console.log('--- Logs ---');
  logs.forEach(l => console.log(l));
  console.log('--- Errors ---');
  errors.forEach(e => console.log(e));
});
