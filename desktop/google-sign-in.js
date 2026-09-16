const { isTrustedRendererUrl } = require('./ipc-security');

function isGoogleSignInNavigation(url, isDev) {
  return isTrustedRendererUrl(url, isDev)
    && new URL(url).pathname === '/api/auth/google/login';
}

// Electron net.fetch rejects manual redirects. Read ClientRequest's redirect
// event before its cancellation, keeping the desktop session on the local hop.
function fetchGoogleSignInRedirect(createRequest, url, options) {
  return new Promise((resolve, reject) => {
    const request = createRequest({
      url, method: 'GET', credentials: 'include', redirect: 'manual',
    });
    let finished = false;
    const finish = (error, response) => {
      if (finished) return;
      finished = true;
      options.signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve(response);
    };
    const cancel = () => {
      finish(new Error('Google sign-in request cancelled'));
      request.abort();
    };
    request.on('redirect', (status, _method, location) => {
      finish(null, { status, headers: new Headers({ location }) });
      request.abort();
    });
    request.on('response', response => {
      finish(null, { status: response.statusCode, headers: new Headers() });
      request.abort();
    });
    // The writable stream can close before the response. Settle on the network
    // events or timeout; consume cancellation errors after a captured redirect.
    request.on('error', error => { finish(error); });
    request.on('login', (_details, callback) => { callback(); });
    if (options.signal?.aborted) return cancel();
    options.signal?.addEventListener('abort', cancel, { once: true });
    request.end();
  });
}

/** Resolve the authenticated redirect without loading Google's HTML in Gnosi. */
async function openGoogleSignIn(url, { backendURL, fetch, openExternal, locale }) {
  const source = new URL(url);
  const login = new URL('/api/auth/google/login', backendURL);
  for (const key of ['type', 'login_hint']) {
    const value = source.searchParams.get(key);
    if (value) login.searchParams.set(key, value);
  }
  login.searchParams.set('desktop', 'true');
  login.searchParams.set('ui_locales', locale || 'en');
  const response = await fetch(login.href, {
    method: 'GET',
    credentials: 'include',
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  const location = response.headers.get('location');
  if (![302, 303, 307, 308].includes(response.status) || !location) {
    throw new Error('Google sign-in could not start (HTTP ' + response.status + ')');
  }
  const authorization = new URL(location);
  if (authorization.protocol !== 'https:' || authorization.hostname !== 'accounts.google.com'
    || authorization.port || authorization.username || authorization.password
    || !['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(authorization.pathname)) {
    throw new Error('Unexpected Google authorization destination');
  }
  await openExternal(authorization.href);
}

function googleSignInErrorMessage(locale) {
  const messages = {
    ca: "No s'ha pogut obrir l'accés a Google. Comprova la connexió i la configuració de Google a Gnosi i torna-ho a provar.",
    es: 'No se ha podido abrir el acceso a Google. Comprueba la conexión y la configuración de Google en Gnosi e inténtalo de nuevo.',
    fr: "Impossible d'ouvrir la connexion à Google. Vérifiez la connexion et la configuration de Google dans Gnosi, puis réessayez.",
    en: 'Could not open Google sign-in. Check your connection and Google configuration in Gnosi, then try again.',
  };
  return messages[String(locale).split('-')[0]] || messages.en;
}

module.exports = { isGoogleSignInNavigation, openGoogleSignIn, googleSignInErrorMessage, fetchGoogleSignInRedirect };
