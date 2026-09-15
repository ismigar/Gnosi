// Electron's regular fs treats app.asar as a virtual directory. Hash the
// physical archive, otherwise identifying a matching installer silently fails.
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

function run(file, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function mountedImages() {
  const plist = await run('/usr/bin/hdiutil', ['info', '-plist']);
  const json = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], plist);
  return JSON.parse(json).images || [];
}

function digest(file, filesystem) {
  return crypto.createHash('sha256').update(filesystem.readFileSync(file)).digest('hex');
}

// Never infer an installer from its volume name alone. Require the same app
// payload as the installed copy, one unambiguous disk image, and user consent.
function findInstaller(images, installedApp, filesystem = fs) {
  const installedArchive = path.join(installedApp, 'Contents/Resources/app.asar');
  let installedHash;
  const candidates = [];
  for (const image of images) {
    const source = image['image-path'];
    if (typeof source !== 'string' || !path.isAbsolute(source) || !source.endsWith('.dmg')
        || source.startsWith('/Volumes/')) continue;
    try {
      if (!filesystem.lstatSync(source).isFile()) continue;
      for (const entity of image['system-entities'] || []) {
        const mount = entity['mount-point'];
        if (typeof mount !== 'string' || path.dirname(mount) !== '/Volumes') continue;
        const archive = path.join(mount, 'Gnosi.app/Contents/Resources/app.asar');
        if (!filesystem.existsSync(archive)) continue;
        installedHash ||= digest(installedArchive, filesystem);
        if (digest(archive, filesystem) === installedHash) candidates.push({ source, mount });
      }
    } catch { /* An unavailable or unrelated image is not ours to clean up. */ }
  }
  return candidates.length === 1 ? candidates[0] : null;
}

const LABELS = {
  ca: ['Instal·lació de Gnosi', 'Vols expulsar el disc instal·lador?', 'La còpia d’Aplicacions ja està oberta. Pots conservar el DMG o enviar-lo a la paperera.', 'Expulsa i envia el DMG a la paperera', 'Només expulsa', 'Ara no'],
  es: ['Instalación de Gnosi', '¿Quieres expulsar el disco instalador?', 'La copia de Aplicaciones ya está abierta. Puedes conservar el DMG o enviarlo a la papelera.', 'Expulsar y enviar el DMG a la papelera', 'Solo expulsar', 'Ahora no'],
  fr: ['Installation de Gnosi', 'Éjecter le disque d’installation ?', 'La copie dans Applications est ouverte. Vous pouvez conserver le DMG ou le mettre à la corbeille.', 'Éjecter et mettre le DMG à la corbeille', 'Éjecter uniquement', 'Pas maintenant'],
  en: ['Gnosi installation', 'Eject the installer disk?', 'The installed copy in Applications is running. You can keep the DMG or move it to the Trash.', 'Eject and move DMG to Trash', 'Eject only', 'Not now'],
};

async function offerInstallerCleanup({ platform, isInstalled, installedApp, locale, dialog, shell,
  getImages = mountedImages, identify = findInstaller,
  detach = mount => run('/usr/bin/hdiutil', ['detach', mount]) }) {
  if (platform !== 'darwin' || !isInstalled) return;
  const candidate = identify(await getImages(), installedApp);
  if (!candidate) return;
  const labels = LABELS[String(locale).toLowerCase().split(/[-_]/)[0]] || LABELS.en;
  const { response } = await dialog.showMessageBox({ type: 'question', title: labels[0],
    message: labels[1], detail: `${labels[2]}\n\n${candidate.source}`,
    buttons: labels.slice(3), defaultId: 2, cancelId: 2, noLink: true });
  if (response !== 0 && response !== 1) return;
  // Recheck identity after the dialog, and never force unmount a busy volume.
  const current = identify(await getImages(), installedApp);
  if (!current || current.mount !== candidate.mount || current.source !== candidate.source) return;
  try {
    await detach(candidate.mount);
    if (response === 0) await shell.trashItem(candidate.source);
  } catch (error) {
    dialog.showErrorBox(labels[0], String(error?.message || error));
  }
}

module.exports = { findInstaller, offerInstallerCleanup };
