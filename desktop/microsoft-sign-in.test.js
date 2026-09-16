const assert = require('node:assert/strict');
const test = require('node:test');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { isMicrosoftSignInNavigation, openMicrosoftSignIn } = require('./microsoft-sign-in');
const { loadMainRuntime } = require('./test-helpers/main-runtime.cjs');

const AUTHORIZATION = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=fixture&login_hint=user%2Bcalendar%40example.test';
const LOGIN = '/api/auth/microsoft/login?type=calendar&login_hint=user%2Bcalendar%40example.test';

test('only the trusted app Microsoft login path is intercepted', () => {
  assert.equal(isMicrosoftSignInNavigation('app://gnosi' + LOGIN, false), true);
  assert.equal(isMicrosoftSignInNavigation('http://localhost:5173' + LOGIN, true), true);
  for (const url of ['https://evil.test' + LOGIN, 'app://gnosi.evil' + LOGIN,
    'app://user@gnosi' + LOGIN, 'app://gnosi/api/auth/microsoft/callback',
    'app://gnosi/api/auth/microsoft/login/other', 'http://localhost:51730' + LOGIN]) {
    assert.equal(isMicrosoftSignInNavigation(url, false), false);
    assert.equal(isMicrosoftSignInNavigation(url, true), false);
  }
});

test('the native session resolves the redirect and the browser receives the email hint', async () => {
  const opened = [];
  await openMicrosoftSignIn('app://gnosi' + LOGIN, {
    backendURL: 'http://localhost:43123', locale: 'ca-ES',
    fetch: async (url, options) => {
      const request = new URL(url);
      assert.equal(request.origin, 'http://localhost:43123');
      assert.equal(request.pathname, '/api/auth/microsoft/login');
      assert.equal(request.searchParams.get('login_hint'), 'user+calendar@example.test');
      assert.equal(request.searchParams.get('desktop'), 'true');
      assert.equal(request.searchParams.get('ui_locales'), 'ca-ES');
      assert.equal(options.credentials, 'include');
      assert.equal(options.redirect, 'manual');
      return Response.redirect(AUTHORIZATION, 307);
    },
    openExternal: async url => { opened.push(url); },
  });
  assert.deepEqual(opened, [AUTHORIZATION]);
});

test('failed or unexpected redirects never open an external destination', async () => {
  for (const response of [
    new Response('Not configured', { status: 400 }),
    new Response('Authentication required', { status: 401 }),
    new Response('', { status: 307 }),
    ...['https://login.microsoftonline.com.evil.test/common/oauth2/v2.0/authorize',
      'https://login.microsoftonline.com@evil.test/common/oauth2/v2.0/authorize',
      'http://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      'https://login.microsoftonline.com/other',
      'file:///tmp/fixture'].map(url => Response.redirect(url, 307)),
  ]) {
    await assert.rejects(openMicrosoftSignIn('app://gnosi' + LOGIN, {
      backendURL: 'http://localhost:5002', fetch: async () => response,
      openExternal: () => assert.fail('Unexpected browser launch'),
    }));
  }
});

for (const isDev of [false, true]) {
  test('Microsoft login preserves the current Settings window (' + (isDev ? 'dev' : 'packaged') + ')', async () => {
    const runtime = loadMainRuntime({ isDev, fetchResponse: async () => Response.redirect(AUTHORIZATION, 307) });
    const window = runtime.createWindow();
    const originalUrl = window.webContents.getURL();
    let prevented = 0;
    const url = (isDev ? 'http://localhost:5173' : 'app://gnosi') + LOGIN;
    for (let click = 0; click < 2; click++) {
      window.webContents.emit('will-navigate', { preventDefault: () => { prevented++; } }, url);
    }
    await nextTurn();
    assert.equal(prevented, 2);
    assert.equal(window.webContents.getURL(), originalUrl);
    assert.equal(window.isDestroyed(), false);
    assert.equal(runtime.mainWindows.has(window), true);
    assert.equal(runtime.windows.length, 1);
    assert.deepEqual(runtime.calls.filter(call => call.external).map(call => call.external), [AUTHORIZATION]);
  });
}

test('a failed login shows an error and leaves Settings available for retry', async () => {
  const runtime = loadMainRuntime({ locale: 'ca-ES', fetchResponse: async () => new Response('', { status: 401 }) });
  const window = runtime.createWindow();
  window.webContents.emit('will-navigate', { preventDefault() {} }, 'app://gnosi' + LOGIN);
  await nextTurn();
  assert.equal(window.webContents.getURL(), 'app://gnosi/index.html');
  assert.equal(runtime.calls.some(call => call.external), false);
  assert.match(runtime.calls.find(call => call.errorBox).errorBox.message, /No s'ha pogut/);
});
