const DEFAULT_LABELS = Object.freeze({
  about: 'About Gnosi',
  checkForUpdates: 'Check for Updates…',
  settings: 'Settings…',
  services: 'Services',
  hide: 'Hide Gnosi',
  hideOthers: 'Hide Others',
  showAll: 'Show All',
  quit: 'Quit Gnosi',
  file: 'File',
  newWindow: 'New Window',
  closeWindow: 'Close Window',
  edit: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  pasteAndMatchStyle: 'Paste and Match Style',
  delete: 'Delete',
  selectAll: 'Select All',
  view: 'View',
  reload: 'Reload',
  forceReload: 'Force Reload',
  toggleDeveloperTools: 'Toggle Developer Tools',
  actualSize: 'Actual Size',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  toggleFullScreen: 'Toggle Full Screen',
  window: 'Window',
  minimize: 'Minimize',
  zoom: 'Zoom',
  bringAllToFront: 'Bring All to Front',
  help: 'Help',
  documentation: 'Gnosi Documentation',
});

function normalizeMenuLabels(labels) {
  const candidate = labels && typeof labels === 'object' ? labels : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_LABELS).map(([key, fallback]) => [
      key,
      typeof candidate[key] === 'string' && candidate[key].trim()
        ? candidate[key].trim()
        : fallback,
    ]),
  );
}

function createApplicationMenuTemplate({
  labels,
  isDev = false,
  isMac = process.platform === 'darwin',
  onCheckForUpdates = () => {},
  onNewWindow = () => {},
  onOpenDocumentation = () => {},
  onOpenSettings = () => {},
} = {}) {
  const text = normalizeMenuLabels(labels);
  const template = [];

  if (isMac) {
    template.push({
      label: 'Gnosi',
      submenu: [
        { label: text.about, role: 'about' },
        ...(!isDev ? [{ label: text.checkForUpdates, click: onCheckForUpdates }] : []),
        { type: 'separator' },
        {
          label: text.settings,
          accelerator: 'CommandOrControl+,',
          click: onOpenSettings,
        },
        { type: 'separator' },
        { label: text.services, role: 'services', submenu: [] },
        { type: 'separator' },
        { label: text.hide, role: 'hide' },
        { label: text.hideOthers, role: 'hideOthers' },
        { label: text.showAll, role: 'unhide' },
        { type: 'separator' },
        { label: text.quit, role: 'quit' },
      ],
    });
  }

  const fileSubmenu = [
    {
      label: text.newWindow,
      accelerator: 'CommandOrControl+N',
      click: onNewWindow,
    },
    { label: text.closeWindow, role: 'close' },
  ];
  if (!isMac) {
    fileSubmenu.push(
      { type: 'separator' },
      {
        label: text.settings,
        accelerator: 'CommandOrControl+,',
        click: onOpenSettings,
      },
      { type: 'separator' },
      { label: text.quit, role: 'quit' },
    );
  }
  template.push({ label: text.file, submenu: fileSubmenu });

  template.push({
    label: text.edit,
    submenu: [
      { label: text.undo, role: 'undo' },
      { label: text.redo, role: 'redo' },
      { type: 'separator' },
      { label: text.cut, role: 'cut' },
      { label: text.copy, role: 'copy' },
      { label: text.paste, role: 'paste' },
      { label: text.pasteAndMatchStyle, role: 'pasteAndMatchStyle' },
      { label: text.delete, role: 'delete' },
      { label: text.selectAll, role: 'selectAll' },
    ],
  });

  const viewSubmenu = [];
  if (isDev) {
    viewSubmenu.push(
      { label: text.reload, role: 'reload' },
      { label: text.forceReload, role: 'forceReload' },
      { label: text.toggleDeveloperTools, role: 'toggleDevTools' },
      { type: 'separator' },
    );
  }
  viewSubmenu.push(
    { label: text.actualSize, role: 'resetZoom' },
    { label: text.zoomIn, role: 'zoomIn' },
    { label: text.zoomOut, role: 'zoomOut' },
    { type: 'separator' },
    { label: text.toggleFullScreen, role: 'togglefullscreen' },
  );
  template.push({ label: text.view, submenu: viewSubmenu });

  template.push({
    label: text.window,
    role: 'windowMenu',
    submenu: [
      { label: text.minimize, role: 'minimize' },
      { label: text.zoom, role: 'zoom' },
      ...(isMac
        ? [
            { type: 'separator' },
            { label: text.bringAllToFront, role: 'front' },
          ]
        : []),
    ],
  });

  template.push({
    label: text.help,
    role: 'help',
    submenu: [
      { label: text.documentation, click: onOpenDocumentation },
      ...(!isMac && !isDev
        ? [
            { type: 'separator' },
            { label: text.checkForUpdates, click: onCheckForUpdates },
          ]
        : []),
    ],
  });

  return template;
}

module.exports = {
  DEFAULT_LABELS,
  createApplicationMenuTemplate,
  normalizeMenuLabels,
};
