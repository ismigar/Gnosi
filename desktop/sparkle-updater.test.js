const assert = require('node:assert/strict');
const test = require('node:test');
const { SparkleUpdater } = require('./sparkle-updater');

function fixture() {
  const events = [], calls = [], failures = [];
  let available = false, ready = false;
  const bridge = {
    start: () => 1, check: () => { calls.push('check'); return 1; },
    ready: () => ready,
    download: () => { if (!available) return 0; available = false; calls.push('download'); return 1; },
    install: () => { if (!ready) return 0; ready=false; calls.push('install'); return 1; },
    next_event: () => events.shift(),
  };
  const updater = new SparkleUpdater({ bridge, poll: () => ({ unref() {} }) });
  updater.on('error', e => failures.push(e.message));
  const send = event => {
    if (event.type === 'update-available') available = true;
    if (event.type === 'update-downloaded') ready = true;
    events.push(JSON.stringify(event)); updater.drain();
  };
  return { updater, calls, failures, send, bridge };
}

test('discovery never downloads; one user action waits for verification before installation', async () => {
  const f=fixture(); const check=f.updater.checkForUpdates();
  assert.equal(f.updater.checkForUpdates(),check);
  f.send({type:'update-available',version:'3.0.1'}); await check;
  assert.deepEqual(f.calls,['check']);
  let finished=false; const download=f.updater.downloadUpdate();
  download.then(()=>{finished=true;});
  assert.equal(f.updater.downloadUpdate(),download);
  f.send({type:'download-progress',percent:100});
  await Promise.resolve(); assert.equal(finished,false);
  assert.throws(()=>f.updater.quitAndInstall(),/verified update/);
  f.send({type:'update-downloaded',version:'3.0.1'}); await download;
  f.updater.quitAndInstall();
  assert.deepEqual(f.calls,['check','download','install']);
});

test('failed downloads reject the request and retry through a fresh signed offer', async () => {
  const f=fixture(); f.send({type:'update-available',version:'3.0.1'});
  const first=f.updater.downloadUpdate();
  f.send({type:'error',message:'Invalid signature'});
  await assert.rejects(first,/Invalid signature/);
  const retry=f.updater.downloadUpdate();
  f.send({type:'update-available',version:'3.0.1'});
  f.send({type:'update-downloaded',version:'3.0.1'}); await retry;
  assert.deepEqual(f.calls,['download','check','download']);
});

test('backend shutdown failure can retry a verified staged update without redownloading', async () => {
  const f=fixture(); f.send({type:'update-available',version:'3.0.1'});
  const first=f.updater.downloadUpdate(); f.send({type:'update-downloaded',version:'3.0.1'}); await first;
  await f.updater.downloadUpdate(); f.updater.quitAndInstall();
  assert.deepEqual(f.calls,['download','install']);
});

test('native initialization errors and invalid offers cannot enable replacement', async () => {
  assert.throws(()=>new SparkleUpdater({bridge:{start:()=>0}}),/initialize/);
  const f=fixture(); const check=f.updater.checkForUpdates();
  f.send({type:'update-available',version:'../../other'});
  await assert.rejects(check,/Invalid update version/);
  assert.deepEqual(f.calls,['check']);
});
