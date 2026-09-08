const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NsisUpdater, AppImageUpdater, DebUpdater } = require('electron-updater');

function updater(Type) {
  const instance=new Type(undefined,{version:'3.0.0',name:'Gnosi',isPackaged:true});
  instance.logger=null;
  return instance;
}

test('the installed NSIS updater requests silent replacement and automatic relaunch', async () => {
  const native=updater(NsisUpdater), calls=[];
  native.downloadedUpdateHelper={file:'C:\\fixture\\Gnosi-3.0.1-Setup.exe'};
  native.spawnLog=async(...args)=>calls.push(args);
  assert.equal(native.doInstall({isSilent:true,isForceRunAfter:true,isAdminRightsRequired:false}),true);
  await Promise.resolve();
  assert.equal(calls[0][0],'C:\\fixture\\Gnosi-3.0.1-Setup.exe');
  assert.ok(calls[0][1].includes('/S'));
  assert.ok(calls[0][1].includes('--force-run'));
});

test('the installed AppImage updater replaces an isolated file and relaunches its new path', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gnosi-appimage-update-'));
  const previous=process.env.APPIMAGE;
  t.after(()=>{if(previous===undefined)delete process.env.APPIMAGE;else process.env.APPIMAGE=previous;fs.rmSync(root,{recursive:true,force:true});});
  const installed=path.join(root,'Gnosi.AppImage'), candidate=path.join(root,'Gnosi-3.0.1-arm64.AppImage');
  fs.writeFileSync(installed,'old');fs.writeFileSync(candidate,'new');
  process.env.APPIMAGE=installed;
  const native=updater(AppImageUpdater), calls=[];
  native.downloadedUpdateHelper={file:candidate};
  native.spawnLog=async(...args)=>calls.push(args);
  assert.equal(native.doInstall({isSilent:true,isForceRunAfter:true}),true);
  assert.equal(fs.readFileSync(installed,'utf8'),'new');
  assert.equal(fs.existsSync(candidate),false);
  assert.equal(calls[0][0],installed);
  assert.equal(calls[0][2].APPIMAGE_SILENT_INSTALL,'true');
});

test('the installed DEB updater delegates elevation and only relaunches after installation succeeds', () => {
  const native=updater(DebUpdater), calls=[];
  native.downloadedUpdateHelper={file:'/fixture/Gnosi-3.0.1-arm64.deb'};
  native.hasCommand=()=>true; native.detectPackageManager=()=> 'dpkg';
  native.runCommandWithSudoIfNeeded=args=>calls.push(args);
  native.app.relaunch=()=>calls.push('relaunch');
  assert.equal(native.doInstall({isSilent:true,isForceRunAfter:true}),true);
  assert.deepEqual(calls,[['dpkg','-i','/fixture/Gnosi-3.0.1-arm64.deb'],'relaunch']);
  calls.length=0;
  native.runCommandWithSudoIfNeeded=()=>{throw new Error('Authorization cancelled');};
  assert.equal(native.doInstall({isSilent:true,isForceRunAfter:true}),false);
  assert.deepEqual(calls,[]);
});
