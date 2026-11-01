import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { acceptanceState, contextHeaders, ownedAcceptancePath } from '../../support/acceptance-state.ts';
import { requireJsonObject } from '../../support/json-value.ts';

test('saved editor content survives an actual backend process restart', async ({ page }) => {
  const state = acceptanceState();
  const expected = JSON.parse(fs.readFileSync(ownedAcceptancePath('GNOSI_ACCEPTANCE_EXPECTED'), 'utf8')) as { id: string; title: string; content: string; marker: string };
  const response = await page.request.get(`/api/vault/pages/${encodeURIComponent(expected.id)}`, { headers: contextHeaders(state) });
  expect(response.ok()).toBe(true);
  const document = requireJsonObject(await response.json());
  expect(document.title).toBe(expected.title);
  expect(document.content).toContain(expected.content);
  expect(requireJsonObject(document.metadata).acceptance_marker).toBe(expected.marker);
  await page.goto(`/@${state.primary_vault.slug}/knowledge/page/${encodeURIComponent(expected.id)}`);
  await expect(page.locator('.vault-page-title:visible')).toHaveValue(expected.title);
  await expect(page.locator('.bn-editor[contenteditable="true"]:visible')).toContainText(expected.content);
});
