const { isTrustedRendererUrl } = require('./ipc-security');

function isMicrosoftSignInNavigation(url, isDev) {
  return isTrustedRendererUrl(url, isDev)
    && new URL(url).pathname === '/api/auth/microsoft/login';
}

async function openMicrosoftSignIn(url, { backendURL, fetch, openExternal, locale }) {
  const source = new URL(url);
  const login = new URL('/api/auth/microsoft/login', backendURL);
  const email = source.searchParams.get('login_hint');
  if (email) login.searchParams.set('login_hint', email);
  login.searchParams.set('desktop', 'true');
  login.searchParams.set('ui_locales', locale || 'en');
  const response = await fetch(login.href, {
    method: 'GET', credentials: 'include', redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  const location = response.headers.get('location');
  if (![302, 303, 307, 308].includes(response.status) || !location) {
    throw new Error('Microsoft sign-in could not start (HTTP ' + response.status + ')');
  }
  const authorization = new URL(location);
  if (authorization.protocol !== 'https:' || authorization.hostname !== 'login.microsoftonline.com'
    || authorization.port || authorization.username || authorization.password
    || authorization.pathname !== '/common/oauth2/v2.0/authorize') {
    throw new Error('Unexpected Microsoft authorization destination');
  }
  await openExternal(authorization.href);
}

function microsoftSignInErrorMessage(locale) {
  const messages = {
    ca: "No s'ha pogut obrir l'accés a Microsoft. Comprova la connexió i el registre de Gnosi a Microsoft. No cal introduir aquí la contrasenya del correu.",
    es: 'No se ha podido abrir el acceso a Microsoft. Comprueba la conexión y el registro de Gnosi en Microsoft. No introduzcas aquí la contraseña del correo.',
    fr: "Impossible d'ouvrir la connexion à Microsoft. Vérifiez la connexion et l'inscription de Gnosi auprès de Microsoft. Ne saisissez pas ici le mot de passe du compte.",
    en: 'Could not open Microsoft sign-in. Check the connection and the Gnosi app registration in Microsoft. Do not enter your email password here.',
  };
  return messages[String(locale).split('-')[0]] || messages.en;
}

module.exports = { isMicrosoftSignInNavigation, openMicrosoftSignIn, microsoftSignInErrorMessage };
