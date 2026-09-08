const { EventEmitter } = require('node:events');
const path = require('node:path');
const { isCanonicalReleaseVersion } = require('./release-version');

function loadBridge(resourcesPath) {
  const library = require('koffi').load(path.join(resourcesPath, 'gnosi-sparkle.dylib'));
  return Object.fromEntries(['start', 'check', 'download', 'install', 'ready', 'next_event'].map(name =>
    [name, library.func(`${name === 'next_event' ? 'const char *' : 'int'} gnosi_sparkle_${name}(void)`)]));
}

class SparkleUpdater extends EventEmitter {
  constructor({ resourcesPath, bridge, poll = setInterval } = {}) {
    super();
    this.bridge = bridge || loadBridge(resourcesPath);
    this.pendingCheck = null;
    this.pendingDownload = null;
    this.version = null;
    if (!this.bridge.start()) throw new Error('Gnosi could not initialize its signed Sparkle update feed.');
    this.timer = poll(() => this.drain(), 100);
    this.timer.unref();
  }

  drain() {
    try {
      for (let count = 0; count < 100; count += 1) {
        const json = this.bridge.next_event();
        if (!json) return;
        this.handle(JSON.parse(json));
      }
    } catch (error) { this.fail(error); }
  }

  handle(event) {
    if (event.type === 'error') return this.fail(new Error(event.message || 'Sparkle update failed.'));
    if (['update-available', 'update-downloaded'].includes(event.type)) {
      if (!isCanonicalReleaseVersion(event.version)) return this.fail(new Error('Invalid update version.'));
      this.version = event.version;
    }
    if (event.type === 'download-progress') {
      if (!Number.isFinite(event.percent)) return;
      this.emit(event.type, { percent: Math.max(0, Math.min(100, event.percent)) });
    } else if (['checking-for-update', 'update-available', 'update-not-available', 'update-downloaded'].includes(event.type)
      && !(this.pendingDownload && ['checking-for-update', 'update-available'].includes(event.type))) {
      this.emit(event.type, { version: this.version });
    }
    if (['update-available', 'update-not-available'].includes(event.type)) {
      const pending = this.pendingCheck; this.pendingCheck = null;
      pending?.resolve();
      if (event.type === 'update-available' && this.pendingDownload && !this.bridge.download()) {
        this.fail(new Error('Sparkle could not start the requested download.'));
      } else if (event.type === 'update-not-available' && this.pendingDownload) {
        const download = this.pendingDownload; this.pendingDownload = null; download.resolve();
      }
    }
    if (event.type === 'update-downloaded') {
      const pending = this.pendingDownload; this.pendingDownload = null;
      pending?.resolve();
    }
  }

  fail(error) {
    const pending = [this.pendingCheck, this.pendingDownload];
    this.pendingCheck = null; this.pendingDownload = null;
    this.emit('error', error);
    for (const item of pending) item?.reject(error);
  }

  checkForUpdates() {
    if (this.pendingCheck) return this.pendingCheck.promise;
    const pending = deferred();
    this.pendingCheck = pending;
    if (!this.bridge.check()) {
      this.pendingCheck = null;
      pending.reject(new Error('Sparkle is busy; try checking for updates again.'));
    }
    return pending.promise;
  }

  downloadUpdate() {
    if (this.pendingDownload) return this.pendingDownload.promise;
    if (this.bridge.ready()) {
      this.emit('update-downloaded', { version: this.version });
      return Promise.resolve();
    }
    const pending = deferred();
    this.pendingDownload = pending;
    // After an error Sparkle closes its cycle. Retry discovers a fresh signed
    // offer before resuming; a failed installation may still be ready instead.
    if (!this.bridge.download()) {
      this.checkForUpdates().catch(error => this.fail(error));
    }
    return pending.promise;
  }

  quitAndInstall() {
    if (!this.bridge.install()) throw new Error('Sparkle has no verified update ready to install.');
  }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

module.exports = { SparkleUpdater, loadBridge };
