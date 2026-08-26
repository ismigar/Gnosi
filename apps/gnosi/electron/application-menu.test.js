const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_LABELS,
  createApplicationMenuTemplate,
  normalizeMenuLabels,
} = require('./application-menu');

function topLevel(template, label) {
  return template.find((item) => item.label === label);
}

test('menu labels fall back safely at the IPC boundary', () => {
  const labels = normalizeMenuLabels({ file: 'Fitxer', settings: '   ' });

  assert.equal(labels.file, 'Fitxer');
  assert.equal(labels.settings, DEFAULT_LABELS.settings);
  assert.equal(labels.help, DEFAULT_LABELS.help);
});

test('macOS menu includes settings, window creation, updates, and standard roles', () => {
  const calls = [];
  const template = createApplicationMenuTemplate({
    labels: { file: 'Fitxer', newWindow: 'Nova finestra' },
    isMac: true,
    onCheckForUpdates: () => calls.push('updates'),
    onNewWindow: () => calls.push('window'),
    onOpenSettings: () => calls.push('settings'),
  });

  const appMenu = topLevel(template, 'Gnosi');
  const fileMenu = topLevel(template, 'Fitxer');
  assert.ok(appMenu.submenu.some((item) => item.role === 'about'));
  assert.ok(appMenu.submenu.some((item) => item.accelerator === 'CommandOrControl+,'));
  assert.equal(fileMenu.submenu[0].label, 'Nova finestra');
  assert.equal(fileMenu.submenu[0].accelerator, 'CommandOrControl+N');
  assert.equal(fileMenu.submenu[1].role, 'close');

  appMenu.submenu.find((item) => item.label === DEFAULT_LABELS.checkForUpdates).click();
  appMenu.submenu.find((item) => item.accelerator === 'CommandOrControl+,').click();
  fileMenu.submenu[0].click();
  assert.deepEqual(calls, ['updates', 'settings', 'window']);
});

test('production View menu excludes reload and developer tools', () => {
  const production = createApplicationMenuTemplate({ isMac: true, isDev: false });
  const development = createApplicationMenuTemplate({ isMac: true, isDev: true });

  const productionRoles = topLevel(production, DEFAULT_LABELS.view).submenu.map((item) => item.role);
  const developmentRoles = topLevel(development, DEFAULT_LABELS.view).submenu.map((item) => item.role);
  assert.ok(!productionRoles.includes('reload'));
  assert.ok(!productionRoles.includes('toggleDevTools'));
  assert.ok(developmentRoles.includes('reload'));
  assert.ok(developmentRoles.includes('toggleDevTools'));
  assert.ok(
    !topLevel(development, 'Gnosi').submenu.some(
      (item) => item.label === DEFAULT_LABELS.checkForUpdates,
    ),
  );
});

test('non-macOS menus keep settings discoverable under File', () => {
  const template = createApplicationMenuTemplate({ isMac: false });
  const fileMenu = topLevel(template, DEFAULT_LABELS.file);
  const helpMenu = topLevel(template, DEFAULT_LABELS.help);

  assert.ok(fileMenu.submenu.some((item) => item.accelerator === 'CommandOrControl+,'));
  assert.ok(fileMenu.submenu.some((item) => item.role === 'quit'));
  assert.ok(helpMenu.submenu.some((item) => item.label === DEFAULT_LABELS.checkForUpdates));
});
