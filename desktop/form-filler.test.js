const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadMainRuntime, senderEvent } = require('./test-helpers/main-runtime.cjs');

const URL_FIXTURE = 'https://example.invalid/form';
const PROFILE = {
  email: 'synthetic@example.invalid', first_name: 'Synthetic given',
  last_name: 'Synthetic family', full_name: 'Synthetic full', phone: 'PHONE_FIXTURE',
  address: 'ADDRESS_FIXTURE', city: 'CITY_FIXTURE', zip_code: 'ZIP_FIXTURE', dni_nie: 'ID_FIXTURE',
};

function fixture(options = {}) {
  const runtime = loadMainRuntime(options);
  const main = runtime.createWindow();
  runtime.calls.length = 0;
  return {
    ...runtime, main,
    invoke: (...args) => runtime.handlers.get('open-form-filler')(senderEvent(main), ...args),
    scripts: () => runtime.calls.filter(call => call.script).map(call => call.script),
  };
}

function input(properties = {}) {
  let value = properties.value ?? '';
  return {
    name: '', id: '', placeholder: '', labels: [], events: [], ...properties,
    get value() { return value; },
    set value(next) { value = String(next); },
    dispatchEvent(event) { this.events.push([event.type, event.bubbles, this.value]); },
  };
}

function dom(inputs = []) {
  const timers = [];
  const logs = [];
  const selectors = [];
  const context = vm.createContext({
    document: { querySelectorAll(selector) { selectors.push(selector); return inputs; } },
    Event: class { constructor(type, options) { this.type = type; this.bubbles = options.bubbles; } },
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
    console: { log: (...args) => logs.push(args) },
    fetch: () => assert.fail('No network in form fixture'),
    XMLHttpRequest: class { constructor() { assert.fail('No network in form fixture'); } },
  });
  return { inputs, timers, logs, selectors, run: script => vm.runInContext(script, context, { timeout: 1000 }) };
}

async function generated(profile = PROFILE) {
  const f = fixture();
  await f.invoke({ url: URL_FIXTURE, profile });
  f.windows[1].webContents.emit('did-finish-load');
  return { f, script: f.scripts()[0] };
}

test('form guard is synchronous and precedes getters, destructuring and every action', () => {
  const f = fixture();
  f.mainWindows.clear();
  const poison = new Proxy({}, { get() { assert.fail('Payload read before sender guard'); } });
  for (const args of [[], [undefined], [null], [poison]]) {
    assert.throws(() => f.invoke(...args), /Untrusted IPC sender/);
    assert.deepEqual(f.calls, []);
  }
});

test('form payload reads url then profile before URL coercion and preserves the original load argument', async () => {
  const f = fixture();
  const reads = [];
  const url = { toString() { reads.push('coerce'); return URL_FIXTURE; } };
  await f.invoke({
    get url() { reads.push('url'); return url; },
    get profile() { reads.push('profile'); return PROFILE; },
  });
  assert.deepEqual(reads, ['url', 'profile', 'coerce']);
  assert.equal(f.calls.find(call => call.loadURL).loadURL, url);
});

test('trusted malformed payload failures stay rejected promises and ignored extra args stay ignored', async () => {
  const f = fixture();
  for (const args of [[], [undefined], [null], [1], [true], ['text'], [[]], [{}]]) {
    let pending;
    assert.doesNotThrow(() => { pending = f.invoke(...args); });
    assert.equal(typeof pending.then, 'function');
    await assert.rejects(pending, { name: 'TypeError' });
    assert.deepEqual(f.calls, []);
  }
  const poison = new Proxy({}, { get() { assert.fail('Extra argument inspected'); } });
  await f.invoke({ url: URL_FIXTURE, profile: PROFILE }, poison);
  assert.equal(f.windows.length, 2);
});

test('getters reject with their original exception before any window exists', async () => {
  for (const field of ['url', 'profile']) {
    const f = fixture();
    const failure = new Error(`synthetic ${field}`);
    const payload = { url: URL_FIXTURE };
    Object.defineProperty(payload, field, { get() { throw failure; } });
    let pending;
    assert.doesNotThrow(() => { pending = f.invoke(payload); });
    await assert.rejects(pending, error => error === failure);
    assert.deepEqual(f.calls, []);
  }
});

for (const [url, name, message] of [
  ['', 'TypeError', 'Invalid URL'], ['relative/path', 'TypeError', 'Invalid URL'],
  [null, 'TypeError', 'Invalid URL'], [undefined, 'TypeError', 'Invalid URL'],
  ['https://', 'TypeError', 'Invalid URL'], [Symbol('fixture'), 'TypeError', 'Cannot convert a Symbol value to a string'],
  ['file:///synthetic', 'Error', 'Unsupported form URL'],
  ['javascript:throw 1', 'Error', 'Unsupported form URL'],
  ['data:text/html,synthetic', 'Error', 'Unsupported form URL'],
  ['app://gnosi/form', 'Error', 'Unsupported form URL'],
  ['http://example.invalid/form', 'Error', 'Unsupported form URL'],
  ['https://user:password@example.invalid', 'Error', 'Unsupported form URL'],
]) {
  test(`form retains URL failure ${String(url)}`, async () => {
    const f = fixture();
    await assert.rejects(f.invoke({ url, profile: PROFILE }), { name, message });
    assert.deepEqual(f.calls, []);
  });
}

for (const url of [URL_FIXTURE, ' HTTPS://EXAMPLE.INVALID/form ', 'https://@example.invalid/form']) {
  test(`form passes supported spelling unchanged to loadURL: ${url}`, async () => {
    const f = fixture();
    await f.invoke({ url, profile: PROFILE });
    assert.equal(f.calls.find(call => call.loadURL).loadURL, url);
  });
}

test('window isolation and navigation guards are registered before the non-awaited load', async () => {
  const order = [];
  const f = fixture({ onWindowCreated(window) {
    if (window.options.title !== 'Gnosi Form Filler') return;
    order.push('create');
    window.loadURL = url => {
      order.push(['load', url]);
      assert.equal(window.webContents.listenerCount('did-finish-load'), 1);
      assert.equal(window.webContents.listenerCount('will-navigate'), 1);
      assert.equal(window.webContents.listenerCount('will-redirect'), 1);
      window.webContents.emit('did-finish-load');
      return new Promise(() => {});
    };
    const on = window.webContents.on;
    window.webContents.on = function (name, callback) {
      order.push(['listen', name]);
      return on.call(this, name, callback);
    };
  } });
  assert.equal(await f.invoke({ url: URL_FIXTURE, profile: PROFILE }), undefined);
  assert.deepEqual(order, [
    'create', ['listen', 'will-navigate'], ['listen', 'will-redirect'],
    ['listen', 'did-finish-load'], ['load', URL_FIXTURE],
  ]);
  assert.equal(f.calls[0].log.at(-1), 'Opening form filler');
  assert.deepEqual(structuredClone(f.windows[1].options), {
    width: 1000, height: 800, title: 'Gnosi Form Filler',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  assert.equal(f.mainWindows.has(f.windows[1]), false);
  assert.deepEqual(f.scripts(), []);
});

test('cross-origin navigation and redirects are blocked and never receive profile bytes', async () => {
  const f = fixture();
  await f.invoke({ url: URL_FIXTURE, profile: PROFILE });
  const filler = f.windows[1];
  const prevented = [];
  for (const [eventName, url] of [
    ['will-navigate', 'https://redirected.invalid/form'],
    ['will-redirect', 'https://example.invalid.evil/form'],
    ['will-redirect', 'http://example.invalid/form'],
  ]) {
    filler.webContents.emit(eventName, {
      preventDefault() { prevented.push([eventName, url]); },
    }, url);
  }
  assert.deepEqual(prevented, [
    ['will-navigate', 'https://redirected.invalid/form'],
    ['will-redirect', 'https://example.invalid.evil/form'],
    ['will-redirect', 'http://example.invalid/form'],
  ]);

  filler.webContents.mainFrame.url = 'https://redirected.invalid/form';
  filler.webContents.emit('did-finish-load');
  assert.deepEqual(f.scripts(), []);
  assert.equal(JSON.stringify(f.calls).includes(PROFILE.email), false);

  filler.webContents.mainFrame.url = 'https://example.invalid/second-step';
  filler.webContents.emit('did-finish-load');
  assert.equal(f.scripts().length, 1);
});

test('load exceptions reject after guard registration without cleanup or replacement windows', async () => {
  const failure = new Error('synthetic load error');
  const f = fixture({ onWindowCreated(window) {
    if (window.options.title === 'Gnosi Form Filler') window.loadURL = () => { throw failure; };
  } });
  await assert.rejects(f.invoke({ url: URL_FIXTURE, profile: PROFILE }), error => error === failure);
  assert.equal(f.windows[1].webContents.listenerCount('did-finish-load'), 1);
  assert.equal(f.windows[1].webContents.listenerCount('will-navigate'), 1);
  assert.equal(f.windows[1].webContents.listenerCount('will-redirect'), 1);
  assert.equal(f.windows.length, 2);
});

test('profile serialization occurs on each load using captured profile identity, not replacement payload', async () => {
  const f = fixture();
  let count = 0;
  const profile = { toJSON() { count++; return { email: `synthetic-${count}@example.invalid` }; } };
  const payload = { url: URL_FIXTURE, profile };
  await f.invoke(payload);
  assert.equal(count, 0);
  payload.profile = { email: 'replacement@example.invalid' };
  const filler = f.windows[1];
  for (let n = 1; n <= 2; n++) {
    filler.webContents.emit('did-finish-load');
    assert.equal(count, n);
    const field = input({ name: 'email' });
    dom([field]).run(f.scripts().at(-1));
    assert.equal(field.value, `synthetic-${n}@example.invalid`);
  }
  assert.equal(filler.webContents.listenerCount('did-finish-load'), 1);
});

test('serialization errors remain synchronous load-callback errors after a successful IPC result', async () => {
  const circular = {}; circular.self = circular;
  for (const profile of [circular, { email: 1n }]) {
    const f = fixture();
    assert.equal(await f.invoke({ url: URL_FIXTURE, profile }), undefined);
    assert.throws(() => f.windows[1].webContents.emit('did-finish-load'), { name: 'TypeError' });
    assert.deepEqual(f.scripts(), []);
    assert.equal(f.calls.at(-1).log.at(-1), 'Form loaded, injecting script...');
  }
});

test('executeJavaScript return is not awaited and synchronous failure is not swallowed', async () => {
  const { f } = await generated();
  const contents = f.windows[1].webContents;
  let calls = 0;
  contents.executeJavaScript = () => { calls++; return { get then() { assert.fail('Script result awaited'); } }; };
  contents.emit('did-finish-load');
  assert.equal(calls, 1);
  const failure = new Error('synthetic injection error');
  contents.executeJavaScript = () => { throw failure; };
  assert.throws(() => contents.emit('did-finish-load'), error => error === failure);
});

test('serialized profile strings remain data, including quotes, backticks, HTML and line separators', async () => {
  const email = 'fixture";globalThis.injected=true;//` ${1}\n</script>\u2028\u2029';
  const { script } = await generated({ email });
  const field = input({ name: 'email' });
  const d = dom([field]);
  d.run(script);
  assert.equal(field.value, email);
  assert.equal(d.run('globalThis.injected'), undefined);
  assert.equal(JSON.stringify(d.logs).includes(email), false);
});

test('all original aliases match across name, id, placeholder and the first label', async () => {
  const { script } = await generated();
  const aliases = {
    email: ['email', 'mail', 'correu', 'correo'],
    first_name: ['first_name', 'nombre', 'nom', 'given-name'],
    last_name: ['last_name', 'cognom', 'apellido', 'family-name'],
    full_name: ['full_name', 'name', 'nombre_completo', 'nom_complet'],
    phone: ['phone', 'tel', 'mobil', 'móvil', 'telefon'],
    address: ['address', 'adreça', 'direccion', 'dirección', 'street'],
    city: ['city', 'ciutat', 'poblacio', 'población'],
    zip_code: ['zip', 'postal', 'codi_postal', 'cp'], dni_nie: ['dni', 'nif', 'nie', 'document'],
  };
  // Earlier field groups win, even when an alias also belongs to a later group.
  const priority = alias => Object.entries(aliases).find(([, patterns]) => patterns.some(p => alias.includes(p)))[0];
  for (const alias of Object.values(aliases).flat()) {
    for (const attribute of ['name', 'id', 'placeholder', 'labels']) {
      const value = `PREFIX_${alias.toUpperCase()}_SUFFIX`;
      const field = input({ [attribute]: attribute === 'labels' ? [{ innerText: value }] : value });
      dom([field]).run(script);
      const expected = PROFILE[priority(alias)];
      assert.equal(field.value, expected, `${attribute}: ${alias}`);
      assert.deepEqual(field.events, [['input', true, expected], ['change', true, expected]]);
    }
  }
});

test('field priority retains cognom/nombre_completo collisions and truthy fallback', async () => {
  const { script } = await generated({ ...PROFILE, email: '', first_name: false, last_name: 0 });
  const fields = [input({ name: 'email', id: 'city' }), input({ name: 'nombre_completo' }), input({ name: 'cognom' })];
  dom(fields).run(script);
  assert.deepEqual(fields.map(field => field.value), [PROFILE.city, PROFILE.full_name, '']);
  const { script: original } = await generated();
  dom(fields).run(original);
  assert.deepEqual(fields.map(field => field.value), [PROFILE.email, PROFILE.first_name, PROFILE.first_name]);
});

test('only first label counts; all selected input types retain existing overwrite behavior', async () => {
  const { script } = await generated();
  const untouched = input({ labels: [{ innerText: 'unmatched' }, { innerText: 'email' }], value: 'existing' });
  const fields = ['text', 'hidden', 'checkbox', 'submit', 'password'].map(type => input({ name: 'email', type, disabled: true, value: 'existing' }));
  const d = dom([untouched, ...fields]);
  d.run(script);
  assert.equal(untouched.value, 'existing');
  assert.deepEqual(untouched.events, []);
  assert.ok(fields.every(field => field.value === PROFILE.email));
  assert.deepEqual(d.selectors, ['input, textarea, select']);
});

test('immediate fill and 1000/3000ms retries query new DOM nodes and overwrite edits without submission', async () => {
  const { script } = await generated();
  const first = input({ name: 'email' });
  const d = dom([first]);
  d.run(script);
  assert.equal(first.value, PROFILE.email);
  assert.deepEqual(d.timers.map(timer => timer.delay), [1000, 3000]);
  first.value = 'synthetic user edit';
  const late = input({ name: 'city' });
  d.inputs.push(late);
  d.timers[0].callback();
  assert.equal(first.value, PROFILE.email);
  assert.equal(late.value, PROFILE.city);
  const last = input({ name: 'dni' });
  d.inputs.push(last);
  d.timers[1].callback();
  assert.equal(last.value, PROFILE.dni_nie);
  assert.equal(d.selectors.length, 3);
  assert.equal(d.timers.length, 2);
  assert.equal(first.events.length, 6);
  assert.equal(JSON.stringify(d.logs).includes(PROFILE.email), false);
});

test('non-string truthy field values retain native DOM coercion and falsy JSON values do not fill', async () => {
  const { script } = await generated({ email: 42, phone: true, city: { fixture: 1 }, address: ['a', 'b'], zip_code: 0, dni_nie: null });
  const fields = ['email', 'phone', 'city', 'address', 'zip', 'dni'].map(name => input({ name }));
  dom(fields).run(script);
  assert.deepEqual(fields.map(field => field.value), ['42', 'true', '[object Object]', 'a,b', '', '']);
});

test('null and missing profiles fail only in the renderer when fields exist', async () => {
  for (const profile of [null, undefined]) {
    const f = fixture();
    await f.invoke({ url: URL_FIXTURE, profile });
    f.windows[1].webContents.emit('did-finish-load');
    const script = f.scripts()[0];
    const empty = dom(); empty.run(script);
    assert.equal(empty.timers.length, 2);
    const d = dom([input({ name: 'email' })]);
    assert.throws(() => d.run(script), { name: 'TypeError' });
    assert.deepEqual(d.timers, []);
  }
});

test('isolated injected script baseline is byte-identical after extraction', async () => {
  const { script } = await generated();
  const hash = createHash('sha256').update(script).digest('hex');
  // Filled from the original main implementation before production edits.
  assert.equal(hash, 'e671c8af6e88b562f258249496d26b894b6a2b1ea6996a0477662c2da55fcb3c');
});

test('real synthetic DOM inputs, textarea, select, labels and bubbled events run without network or submission', async t => {
  // Reuse the installed frontend test dependency; never resolve Electron or
  // enable JSDOM resource loading. Outside-only scripts execute solely by eval.
  const frontendRequire = createRequire(path.join(__dirname, '../frontend/package.json'));
  const { JSDOM, ResourceLoader } = frontendRequire('jsdom');
  const { script } = await generated();
  class NoResources extends ResourceLoader {
    fetch() { assert.fail('No external resources in the synthetic DOM'); }
  }
  const page = new JSDOM(`<!doctype html><form>
    <label for="field">CORREU</label><input id="field">
    <textarea name="address"></textarea>
    <select name="city"><option value="">Empty</option><option value="CITY_FIXTURE">Synthetic city</option></select>
    <input name="unmatched" value="keep"><button type="submit">Synthetic submit</button>
  </form>`, { runScripts: 'outside-only', resources: new NoResources() });
  t.after(() => page.window.close());
  const window = page.window;
  const document = window.document;
  const deny = () => assert.fail('No network, navigation, clicks or submission');
  window.fetch = deny;
  window.XMLHttpRequest = class { constructor() { deny(); } };
  window.WebSocket = class { constructor() { deny(); } };
  window.open = deny;
  window.HTMLFormElement.prototype.submit = deny;
  window.HTMLFormElement.prototype.requestSubmit = deny;
  window.HTMLElement.prototype.click = deny;
  document.addEventListener('submit', deny);
  const timers = [];
  window.setTimeout = (callback, delay) => { timers.push({ callback, delay }); };
  const logs = [];
  window.console.log = (...args) => logs.push(args);
  // JSDOM has no layout-derived innerText. Supply only that browser property
  // on the synthetic label; association/selection/events are actual DOM APIs.
  const label = document.querySelector('label');
  Object.defineProperty(label, 'innerText', { value: label.textContent });
  const events = [];
  for (const type of ['input', 'change']) {
    document.addEventListener(type, event => events.push([event.type, event.bubbles, event.target.value]));
  }
  window.eval(script);
  assert.equal(document.querySelector('#field').value, PROFILE.email);
  assert.equal(document.querySelector('textarea').value, PROFILE.address);
  assert.equal(document.querySelector('select').value, PROFILE.city);
  assert.equal(document.querySelector('[name="unmatched"]').value, 'keep');
  assert.deepEqual(events, [
    ['input', true, PROFILE.email], ['change', true, PROFILE.email],
    ['input', true, PROFILE.address], ['change', true, PROFILE.address],
    ['input', true, PROFILE.city], ['change', true, PROFILE.city],
  ]);
  const late = document.createElement('input');
  late.name = 'phone'; document.querySelector('form').append(late);
  timers[0].callback();
  assert.equal(late.value, PROFILE.phone);
  late.value = 'synthetic edit';
  timers[1].callback();
  assert.equal(late.value, PROFILE.phone);
  assert.deepEqual(timers.map(timer => timer.delay), [1000, 3000]);
  assert.equal(window.location.href, 'about:blank');
  assert.equal(JSON.stringify(logs).includes(PROFILE.email), false);
});
