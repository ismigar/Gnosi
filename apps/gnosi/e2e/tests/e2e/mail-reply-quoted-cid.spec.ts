import { test, expect } from '@playwright/test';

/**
 * Reply a un correu amb imatges inline (cid:) del missatge original:
 *  - buildQuotedHtml reescriu src="cid:..." → URL /api/mail/.../cid/...
 *    (BlockNote DESCARTA els src cid: — la imatge desapareixeria del citat;
 *    la URL API en canvi sobreviu el roundtrip i es mostra al composer)
 *  - el POST /reply porta la URL /cid/ al body (el backend la converteix en
 *    part inline pròpia) i la carpeta d'origen (folder=) com a query
 *
 * La conversió backend (URL /cid/ o cid: cru → part inline nova del missatge
 * sortint) es cobreix a backend/tests/test_mail_reply_cid.py. Aquí tot el
 * /api/mail està mockejat: cap compte real ni escriptura al vault.
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
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/integrations**', (route) =>
      route.fulfill({
        json: {
          mail_accounts: [{ email: ACCOUNT, provider: 'imap', display_name: 'PW Cid' }],
          default_mail: ACCOUNT,
        },
      }),
    );

    // Tot /api/mail/** mockejat: el test no depèn de comptes reals ni
    // escriu drafts al vault (autosave del composer cada 2 s).
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
      // Col·leccions que el sidebar/viewer mapegen directament
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

    // Obrir el missatge mockejat
    const listItem = page.getByText(SUBJECT).first();
    await expect(listItem, `pageerrors: ${pageErrors.join(' | ')}`).toBeVisible({ timeout: 15_000 });
    await listItem.click();
    const replyBtn = page.getByTitle(/^(resposta|reply|respuesta|réponse)$/i);
    await expect(replyBtn).toBeVisible({ timeout: 15_000 });
    await replyBtn.click();

    // Composer obert amb el citat carregat. La imatge citada hi és com a URL
    // /cid/ de l'API (servida pel mock): BlockNote la conserva i es mostra.
    const editor = page.locator('.mail-block-editor [contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await expect(editor.getByText('Hola, aquí teniu el logo:')).toBeVisible({ timeout: 10_000 });
    const quotedImg = page.locator(
      `.mail-block-editor img[src*="/api/mail/messages/${MSG_ID}/cid/"]`,
    ).first();
    await expect(quotedImg).toBeAttached({ timeout: 10_000 });

    // Escriure la resposta al principi (cursor ja a dalt)
    await editor.click();
    await page.keyboard.type('Gràcies pel logo!');

    const sendBtn = page.getByRole('button', { name: /envia|send|enviar|envoyer/i });
    const [replyReq] = await Promise.all([
      page.waitForRequest(
        (r) => r.url().includes(`/api/mail/messages/${MSG_ID}/reply`) && r.method() === 'POST',
        { timeout: 15_000 },
      ),
      sendBtn.click(),
    ]);

    // La carpeta IMAP d'origen viatja al backend (fallback per a cid: crus)
    expect(replyReq.url()).toContain('folder=Clients');
    // El cos multipart conserva la referència /cid/ del missatge citat
    // (el backend la converteix en part inline pròpia en enviar)
    const postData = replyReq.postData() || '';
    expect(postData).toContain(
      `/api/mail/messages/${MSG_ID}/cid/${encodeURIComponent(ORIG_CID)}`,
    );
    expect(postData).toContain('Gràcies pel logo!');

    await expect(page.getByText(/enviat correctament|sent successfully|enviado correctamente/i))
      .toBeVisible({ timeout: 10_000 });
  });
});
