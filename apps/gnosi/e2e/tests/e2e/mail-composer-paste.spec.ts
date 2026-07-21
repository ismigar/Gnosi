import { test, expect } from '@playwright/test';

/**
 * Mail composer paste E2E:
 *  - pasting an image inserts an inline image block (uploaded to vault assets)
 *  - pasting a non-image file becomes a REAL attachment (badge), never a
 *    vault link in the body (links broke for recipients — see directive
 *    mail_inline_images_cid.md)
 *
 * The asset upload endpoint is mocked so test runs never write into the
 * real (OneDrive-synced) vault; the real upload path is covered by
 * pipeline/sandbox/verify_mail_inline_mime.py.
 */

const FAKE_ASSET_URL = '/api/vault/assets/Inline/pw-paste-test.png';

// 1x1 transparent PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP6z/AfAAUFAgBfyPHSAAAAAElFTkSuQmCC';

async function openComposer(page) {
  await page.goto('/mail', { waitUntil: 'domcontentloaded' });
  const composeBtn = page
    .locator('button:visible')
    .filter({ has: page.locator('svg') })
    .and(page.getByTitle(/(redactar|compose|nou missatge|new message)/i));
  await expect(composeBtn).toBeVisible({ timeout: 15_000 });
  await composeBtn.click();
  const editor = page.locator('.mail-block-editor [contenteditable="true"]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  return editor;
}

function pasteFile(editor, name: string, mime: string, base64: string) {
  return editor.evaluate(
    (el, { name, mime, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);
      const event = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(event);
    },
    { name, mime, base64 },
  );
}

test.describe('Mail composer paste', () => {
  test.beforeEach(async ({ page }) => {
    // Mock upload: keep the real vault clean and the test deterministic
    await page.route('**/api/vault/assets/upload**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: FAKE_ASSET_URL,
          path: 'Assets/Inline/pw-paste-test.png',
          is_image: true,
        }),
      }),
    );
    // Serve the fake asset so the inserted <img> actually renders
    await page.route(`**${FAKE_ASSET_URL}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(PNG_BASE64, 'base64'),
      }),
    );
  });

  test('pasted image becomes an inline image block', async ({ page }) => {
    const editor = await openComposer(page);
    await pasteFile(editor, 'captura.png', 'image/png', PNG_BASE64);

    const img = page.locator(
      `.mail-block-editor img[src*="/api/vault/assets/"]`,
    );
    await expect(img).toBeVisible({ timeout: 10_000 });
  });

  test('pasted PDF becomes a real attachment, not a vault link', async ({ page }) => {
    const editor = await openComposer(page);
    await pasteFile(
      editor,
      'informe.pdf',
      'application/pdf',
      Buffer.from('%PDF-1.4 fake').toString('base64'),
    );

    // Attachment badge with the file name (exact: the toast «Attached: …»
    // also contains the name and would trip strict mode)
    await expect(page.getByText('informe.pdf', { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // And no link/embed in the body pointing to the vault
    const editorLinks = page.locator(
      '.mail-block-editor a[href*="/api/vault/assets/"], .mail-block-editor [data-url*="/api/vault/assets/"]',
    );
    await expect(editorLinks).toHaveCount(0);
  });
});
