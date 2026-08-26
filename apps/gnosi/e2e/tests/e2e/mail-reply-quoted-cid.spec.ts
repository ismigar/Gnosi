import { test, expect } from '@playwright/test';

/**
 * Reply to an email with inline images (cid:) from the original message:
 *  - buildQuotedHtml rewrites src="cid:..." → URL /api/mail/.../cid/...
 *    (BlockNote DISCARDS cid: srcs — the image would disappear from the quote;
 *    the API URL instead survives the roundtrip and shows up in the composer)
 *  - the POST /reply carries the /cid/ URL in the body (the backend converts it into
 *    its own inline part) and the source folder (folder=) as a query param
 *
 * The backend conversion (raw /cid/ URL or cid: → new inline part of the outgoing
 * message) is covered in backend/tests/test_mail_reply_cid.py. Here the entire
 * /api/mail is mocked: no real account or writing to the vault.
 */

const ACCOUNT = 'pw-cid@example.com';
const MSG_ID = 'imap_777';
const ORIG_CID = 'logo123@original.example';
const SUBJECT = 'Informe amb logo pw-cid';

// 1x1 transparent PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP6z/AfAAUFAgBfyPHSAAAAAElFTkSuQmCC';

const LIST_MSG = {
  id: MSG_ID,
  subject: SUBJECT,
  sender: 'Remitent <remitent@example.com>',
  recipient: ACCOUNT,
  date: '2026-06-10 10:00',
  timestamp: 1781084400,
  snippet: '',
  type: 'Received',
  is_read: true,
  account: ACCOUNT,
  imap_folder: 'Clients',
  has_attachments: false,
};

const FULL_MSG = {
  ...LIST_MSG,
  body_html: `<p>Hola, aquí teniu el logo:</p><img src="cid:${ORIG_CID}" alt="logo">`,
  body_text: '',
  attachments: [],
  inline_images: [{ cid: ORIG_CID, content_type: 'image/png' }],
};

test.describe('Mail reply amb cid: citat', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/integrations**', (route) =>
      route.fulfill({
        json: {
          mail_accounts: [{ email: ACCOUNT, provider: 'imap', display_name: 'PW Cid' }],
          default_mail: ACCOUNT,
        },
      }),
    );

    // All of /api/mail/** mocked: the test doesn't depend on real accounts or
    // write drafts to the vault (composer autosave every 2 s).
    await page.route('**/api/mail/**', (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const method = route.request().method();

      if (path === '/api/mail/messages' && method === 'GET') {
        return route.fulfill({ json: { messages: [LIST_MSG], total: 1 } });
      }
      if (path === `/api/mail/messages/${MSG_ID}` && method === 'GET') {
        return route.fulfill({ json: FULL_MSG });
      }
      if (path.includes('/cid/')) {
        return route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from(PNG_BASE64, 'base64'),
        });
      }
      if (path.endsWith('/reply') && method === 'POST') {
        return route.fulfill({ json: { status: 'success' } });
      }
      if (path === '/api/mail/drafts') {
        return route.fulfill({ json: { draft_id: 'pw-draft-cid' } });
      }
      if (path === '/api/mail/events') {
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: ready\ndata: {}\n\n',
        });
      }
      if (path === '/api/mail/counts') {
        return route.fulfill({ json: {} });
      }
      // Collections that the sidebar/viewer map directly
      if (path === '/api/mail/views' || path === '/api/mail/tags' || path.endsWith('/tags')) {
        return route.fulfill({ json: [] });
      }
      if (path === '/api/mail/folders') {
        return route.fulfill({ json: { folders: [] } });
      }
      if (path === '/api/mail/recipients/suggest') {
        return route.fulfill({ json: [] });
      }
      // catch-all (read, ai/…): resposta neutra
      return route.fulfill({ json: {} });
    });
  });

  test('el citat conserva el cid: i el POST /reply porta folder', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('/mail', { waitUntil: 'domcontentloaded' });

    // Open the mocked message
    const listItem = page.getByText(SUBJECT).first();
    await expect(listItem, `pageerrors: ${pageErrors.join(' | ')}`).toBeVisible({ timeout: 30_000 });
    await listItem.click();
    const replyBtn = page.getByRole('button', {
      name: /resposta|respondre|reply|respuesta|réponse/i,
    }).first();
    await expect(replyBtn).toBeVisible({ timeout: 20_000 });
    await replyBtn.click();

    // Composer open with the quote loaded. The quoted image is there as a URL
    // /cid/ from the API (served by the mock): BlockNote keeps it and it's displayed.
    const editor = page.locator('.mail-block-editor [contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(editor.getByText('Hola, aquí teniu el logo:')).toBeVisible({ timeout: 20_000 });
    const quotedImg = page.locator(
      `.mail-block-editor img[src*="/api/mail/messages/${MSG_ID}/cid/"]`,
    ).first();
    await expect(quotedImg).toBeAttached({ timeout: 10_000 });
    // Let MailBlockEditor's delayed auto-focus settle before moving the caret.
    await page.waitForTimeout(300);

    // Write the reply at the beginning. Clicking the editor's centre can place
    // the caret inside the quoted content, so position it explicitly.
    await editor.press('ControlOrMeta+Home');
    await page.keyboard.type('Gràcies pel logo!');

    const sendBtn = page.getByRole('button', {
      name: /^(enviar correu|send email|enviar correo|envoyer l'email)$/i,
    });
    const [replyReq] = await Promise.all([
      page.waitForRequest(
        (r) => r.url().includes(`/api/mail/messages/${MSG_ID}/reply`) && r.method() === 'POST',
        { timeout: 15_000 },
      ),
      sendBtn.click(),
    ]);

    // The source IMAP folder travels to the backend (fallback for a raw cid:)
    expect(replyReq.url()).toContain('folder=Clients');
    // The multipart body keeps the /cid/ reference from the quoted message
    // (the backend converts it into its own inline part when sending)
    const postData = replyReq.postData() || '';
    expect(postData).toContain(
      `/api/mail/messages/${MSG_ID}/cid/${encodeURIComponent(ORIG_CID)}`,
    );
    expect(postData).toContain('Gràcies pel logo!');

    await expect(page.getByText(/enviat correctament|sent successfully|enviado correctamente/i))
      .toBeVisible({ timeout: 10_000 });
  });
});
