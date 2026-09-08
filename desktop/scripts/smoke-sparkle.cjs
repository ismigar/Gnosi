// Real, isolated macOS update acceptance: two temporary Electron bundles,
// an ephemeral signing key and a loopback feed. Never launches the user profile.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');
const { generateKeyPairSync } = require('node:crypto');
const { collectCode, isConcreteFrameworkVersion, depth } = require('./after-pack.cjs');
const { output } = require('./sparkle-build.cjs');

async function smoke({ tamper = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('Sparkle smoke requires macOS.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-sparkle-smoke-'));
  console.log(`Isolated Sparkle acceptance: ${root}`);
  const key = generateKeyPairSync('ed25519');
  const seed = path.join(root, 'test-key');
  fs.writeFileSync(seed, key.privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32).toString('base64'), { mode: 0o600 });
  const publicKey = key.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const records = path.join(root, 'events.jsonl');
  let downloads = 0;
  const server = http.createServer((request, response) => {
    const name = request.url === '/appcast.xml' ? 'appcast.xml' : request.url === '/update.zip' ? 'update.zip' : null;
    if (!name) { response.writeHead(404).end(); return; }
    if (name === 'update.zip') downloads += 1;
    const file = path.join(root, name);
    response.setHeader('Content-Length', fs.statSync(file).size);
    response.setHeader('Content-Type', name.endsWith('.xml') ? 'application/xml' : 'application/zip');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', error => { fs.rmSync(seed, {force:true}); reject(error); });
    server.listen(0, '127.0.0.1', resolve);
  });
  const feed = `http://127.0.0.1:${server.address().port}/appcast.xml`;
  const updaterPath = path.resolve(__dirname, '../sparkle-updater.js');
  const appId = `org.gnosi.sparkle-smoke.${path.basename(root).replaceAll('-', '').toLowerCase()}`;
  const script = `const {app}=require('electron');const fs=require('node:fs');
app.setPath('userData',${JSON.stringify(path.join(root, 'profile'))});
const log=e=>fs.appendFileSync(${JSON.stringify(records)},JSON.stringify(e)+'\\n');
app.whenReady().then(()=>{log({type:'launched',version:app.getVersion()});
if(app.getVersion()==='1.0.1'){app.quit();return;}
const {SparkleUpdater}=require(${JSON.stringify(updaterPath)});let updater;
try{updater=new SparkleUpdater({resourcesPath:process.resourcesPath});}catch(e){log({type:'error',message:e.message});app.exit(1);return;}
updater.on('error',e=>{log({type:'error',message:e.message});app.exit(${tamper ? 0 : 1});});
updater.on('download-progress',e=>log({type:'progress',...e}));
updater.on('update-downloaded',e=>log({type:'downloaded',...e}));
updater.on('update-available',e=>{log({type:'available',...e});setTimeout(async()=>{
log({type:'clicked'});try{await updater.downloadUpdate();log({type:'backend-stopped'});updater.quitAndInstall();}catch(e){log({type:'error',message:e.message});app.exit(1);}},1500);});
updater.checkForUpdates().catch(e=>{log({type:'error',message:e.message});app.exit(1);});
});`;
  const electronBundle = path.resolve(require('electron'), '../../..');
  const apps = [];
  let child;
  try {
    for (const version of ['1.0.0', '1.0.1']) {
      const parent = path.join(root, version); fs.mkdirSync(parent);
      const app = path.join(parent, 'Gnosi Update Test.app'); apps.push(app);
      execFileSync('/bin/cp', ['-cR', electronBundle, app]);
      const resources = path.join(app, 'Contents/Resources');
      const code = path.join(resources, 'app'); fs.mkdirSync(code);
      fs.writeFileSync(path.join(code, 'package.json'), JSON.stringify({ name: 'gnosi-sparkle-smoke', version, main: 'main.cjs' }));
      fs.writeFileSync(path.join(code, 'main.cjs'), script);
      fs.copyFileSync(path.join(output, 'gnosi-sparkle.dylib'), path.join(resources, 'gnosi-sparkle.dylib'));
      execFileSync('/bin/cp', ['-cR', path.join(output, 'Sparkle.framework'), path.join(app, 'Contents/Frameworks/Sparkle.framework')]);
      const updates = { CFBundleIdentifier: appId, CFBundleName: 'Gnosi Update Test', CFBundleVersion: version,
        CFBundleShortVersionString: version, SUPublicEDKey: publicKey, SUFeedURL: feed,
        SUEnableAutomaticChecks: false, SUAutomaticallyUpdate: false, SUAllowsAutomaticUpdates: false,
        SUSendProfileInfo: false, SURequireSignedFeed: true, SUVerifyUpdateBeforeExtraction: true,
        SUSignedFeedFailureExpirationInterval: 0,
        NSAppTransportSecurity: { NSAllowsLocalNetworking: true, NSExceptionDomains: { '127.0.0.1': { NSExceptionAllowsInsecureHTTPLoads: true } } } };
      execFileSync('python3', ['-c', 'import plistlib,json,sys; p=sys.argv[1];d=plistlib.load(open(p,"rb"));d.update(json.loads(sys.argv[2]));plistlib.dump(d,open(p,"wb"))',
        path.join(app, 'Contents/Info.plist'), JSON.stringify(updates)]);
      const { files, directories } = collectCode(app);
      const sign = target => execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', target], { stdio: 'pipe' });
      files.sort((a,b)=>depth(b)-depth(a)).forEach(sign);
      directories.filter(d=>d!==app && (d.endsWith('.app')||d.endsWith('.xpc')||isConcreteFrameworkVersion(d)))
        .sort((a,b)=>depth(b)-depth(a)).forEach(sign);
      sign(app);
      execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
    }
    const archive = path.join(root, 'update.zip');
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', apps[1], archive]);
    const sign = file => execFileSync(path.join(output, 'bin/sign_update'), ['--ed-key-file', seed, '-p', file], { encoding: 'utf8' }).trim();
    const signature = sign(archive);
    const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Gnosi test</title><item><title>Test 1.0.1</title><sparkle:version>1.0.1</sparkle:version><sparkle:shortVersionString>1.0.1</sparkle:shortVersionString><enclosure url="${feed.replace('appcast.xml','update.zip')}" length="${fs.statSync(archive).size}" type="application/octet-stream" sparkle:edSignature="${signature}" /></item></channel></rss>`;
    fs.writeFileSync(path.join(root, 'appcast.xml'), xml); sign(path.join(root, 'appcast.xml'));
    if (tamper) {
      const fd = fs.openSync(archive, 'r+'); fs.writeSync(fd, Buffer.from('tampered'), 0, 8, 100); fs.closeSync(fd);
    }
    child = spawn(path.join(apps[0], 'Contents/MacOS/Electron'), [], { stdio: ['ignore', 'pipe', 'pipe'] });
    const log = fs.createWriteStream(path.join(root, 'native.log'));
    child.stdout.pipe(log); child.stderr.pipe(log);
    const deadline = Date.now() + 180000;
    let result;
    while (Date.now() < deadline) {
      const events = fs.existsSync(records) ? fs.readFileSync(records, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
      const clicked = events.some(e=>e.type==='clicked');
      if (!clicked && downloads) throw new Error('The updater downloaded before the user action.');
      const error = events.find(e=>e.type==='error');
      if (error) {
        if (tamper && clicked && /sign|verif|valid/i.test(error.message)
          && !events.some(e=>e.type==='downloaded')) { result='Tampered archive rejected before installation'; break; }
        throw new Error(error.message);
      }
      if (events.some(e=>e.type==='launched' && e.version==='1.0.1')) {
        if (tamper) throw new Error('A tampered update was installed.');
        if (!events.some(e=>e.type==='progress') || !events.some(e=>e.type==='backend-stopped')) throw new Error('Missing progress or shutdown boundary.');
        const actual = execFileSync('/usr/libexec/PlistBuddy', ['-c','Print :CFBundleVersion',path.join(apps[0],'Contents/Info.plist')], {encoding:'utf8'}).trim();
        if(actual!=='1.0.1') throw new Error('Original application was not replaced.');
        result='Downloaded, verified, replaced 1.0.0 with 1.0.1 and relaunched'; break;
      }
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    if (!result) throw new Error(`Sparkle acceptance timed out; inspect ${root}`);
    console.log(result);
    return root;
  } finally {
    child?.kill(); server.close(); fs.rmSync(seed, {force:true});
  }
}
module.exports = { smoke };
if (require.main === module) smoke({ tamper: process.argv.includes('--tamper') }).catch(error => { console.error(error.message); process.exitCode=1; });
