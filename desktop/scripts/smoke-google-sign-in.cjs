// Use a disposable Electron profile and a local fixture; never contact Google.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app, net, session } = require('electron');
const { openGoogleSignIn, fetchGoogleSignInRedirect } = require('../google-sign-in');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-google-smoke-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('disable-background-networking');
const authorization = 'https://accounts.google.com/o/oauth2/auth?state=fixture&login_hint=user%2Bcalendar%40example.test';
let server;

app.whenReady().then(async () => {
  server = http.createServer((request, response) => {
    try {
      assert.match(request.headers.cookie || '', /gnosi_session=synthetic-session/);
      const url = new URL(request.url, 'http://localhost');
      assert.equal(url.searchParams.get('login_hint'), 'user+calendar@example.test');
      assert.equal(url.searchParams.get('desktop'), 'true');
      response.writeHead(307, { Location: authorization }).end();
    } catch (error) {
      response.writeHead(400).end(String(error));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://localhost:' + server.address().port;
  await session.defaultSession.cookies.set({
    url: origin, name: 'gnosi_session', value: 'synthetic-session', httpOnly: true,
  });
  const opened = [];
  await openGoogleSignIn('app://gnosi/api/auth/google/login?type=calendar&login_hint=user%2Bcalendar%40example.test', {
    backendURL: origin, fetch: (url, options) => fetchGoogleSignInRedirect(
      requestOptions => net.request(requestOptions), url, options),
    openExternal: async url => { opened.push(url); }, locale: 'ca',
  });
  assert.deepEqual(opened, [authorization]);
  console.log('PASS: Electron preserves its session, reads the Google redirect without following it, and forwards the email hint.');
  await session.defaultSession.clearStorageData();
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  app.exit(process.exitCode || 0);
});
