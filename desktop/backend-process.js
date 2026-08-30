// @ts-check

const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const INSTANCE_HEADER = 'x-gnosi-desktop-instance';
const MAX_HEALTH_BYTES = 4096;

/** @typedef {import('node:child_process').ChildProcessWithoutNullStreams} BackendChild */
/**
 * @typedef {object} LaunchOptions
 * @property {string} executable
 * @property {string[]} args
 * @property {string} cwd
 * @property {NodeJS.ProcessEnv} environment
 * @property {string} healthUrl
 * @property {number} [startupTimeoutMs]
 * @property {number} [requestTimeoutMs]
 * @property {number} [pollIntervalMs]
 * @property {(child: BackendChild) => void} [onSpawn]
 * @property {(output: string) => void} [onOutput]
 */
/**
 * @typedef {object} BackendHandle
 * @property {BackendChild} process
 * @property {() => Promise<boolean>} isRunning
 * @property {() => Promise<void>} stop
 */

/** @param {import('node:child_process').ChildProcess} child */
function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * Read a complete, bounded health response without proxies or redirects.
 * This marker correlates a process; it does not grant application access.
 * @param {string} healthUrl
 * @param {string} identity
 * @param {number} timeoutMs
 * @param {AbortSignal} [signal]
 * @returns {Promise<boolean>}
 */
function probeBackend(healthUrl, identity, timeoutMs, signal) {
  const url = new URL(healthUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/api/health') {
    return Promise.reject(new Error('Backend readiness requires a loopback health URL'));
  }
  if (!/^[a-f0-9]{64}$/.test(identity) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error('Invalid backend readiness parameters'));
  }
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(false); return; }
    let settled = false;
    /** @type {import('node:http').ClientRequest | undefined} */
    let request;
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    /** @param {boolean} ready */
    const finish = ready => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      request?.destroy();
      resolve(ready);
    };
    const abort = () => finish(false);
    signal?.addEventListener('abort', abort, { once: true });
    // An absolute timer also stops servers that trickle bytes indefinitely.
    timer = setTimeout(abort, timeoutMs);
    request = http.get(url, { family: url.hostname === 'localhost' ? 4 : undefined }, response => {
      response.once('aborted', abort);
      response.once('error', abort);
      if (response.statusCode !== 200 || response.headers[INSTANCE_HEADER] !== identity) {
        response.resume();
        finish(false);
        return;
      }
      /** @type {Buffer[]} */
      const chunks = [];
      let length = 0;
      response.on('data', (/** @type {unknown} */ value) => {
        if (!Buffer.isBuffer(value)) { finish(false); return; }
        length += value.length;
        if (length > MAX_HEALTH_BYTES) { finish(false); return; }
        chunks.push(value);
      });
      response.once('end', () => {
        try {
          /** @type {unknown} */
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          finish(typeof payload === 'object' && payload !== null
            && 'status' in payload && payload.status === 'ok'
            && 'mode' in payload && payload.mode === 'FastAPI');
        } catch { finish(false); }
      });
    });
    request.once('error', abort);
  });
}

/**
 * Wait for this exact child, not an existing service on the desired port.
 * @param {BackendChild} child
 * @param {string} healthUrl
 * @param {string} identity
 * @param {{startupTimeoutMs: number, requestTimeoutMs: number, pollIntervalMs: number}} timings
 */
async function waitForBackend(child, healthUrl, identity, timings) {
  const controller = new AbortController();
  /** @type {Error | undefined} */
  let failure;
  const exited = () => {
    failure = new Error('Backend exited before readiness; check the local port and installation');
    controller.abort();
  };
  /** @param {Error} error */
  const failed = error => { failure = error; controller.abort(); };
  child.once('exit', exited);
  child.once('error', failed);
  const deadline = performance.now() + timings.startupTimeoutMs;
  try {
    while (!hasExited(child) && !failure) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Error('Backend startup timed out; check the local port and installation');
      const ready = await probeBackend(healthUrl, identity,
        Math.min(remaining, timings.requestTimeoutMs), controller.signal);
      if (failure) throw failure;
      if (hasExited(child)) break;
      if (ready) return;
      await new Promise(resolve => setTimeout(resolve,
        Math.min(timings.pollIntervalMs, Math.max(0, deadline - performance.now()))));
    }
    throw failure || new Error('Backend exited before readiness');
  } finally {
    controller.abort();
    child.removeListener('exit', exited);
    child.removeListener('error', failed);
  }
}

/**
 * Terminate and reap only the child owned by this application.
 * @param {BackendChild} child
 * @param {number} [graceMs]
 * @returns {Promise<void>}
 */
function stopBackend(child, graceMs = 5000) {
  if (hasExited(child) || child.pid === undefined) return Promise.resolve();
  return new Promise((resolve, reject) => {
    /** @type {NodeJS.Timeout | undefined} */
    let escalate;
    /** @type {NodeJS.Timeout | undefined} */
    let limit;
    /** @param {Error} [error] */
    const finish = error => {
      clearTimeout(escalate);
      clearTimeout(limit);
      child.removeListener('exit', exited);
      child.removeListener('error', failed);
      if (error) reject(error); else resolve();
    };
    const exited = () => finish();
    /** @param {Error} error */
    const failed = error => finish(error);
    child.once('exit', exited);
    child.once('error', failed);
    escalate = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    }, graceMs);
    limit = setTimeout(() => finish(new Error('Backend did not stop after termination')), graceMs + 2000);
    try { child.kill('SIGTERM'); } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** @param {LaunchOptions} options @returns {Promise<BackendHandle>} */
async function launchBackend(options) {
  const timings = {
    startupTimeoutMs: options.startupTimeoutMs ?? 120000,
    requestTimeoutMs: options.requestTimeoutMs ?? 1000,
    pollIntervalMs: options.pollIntervalMs ?? 100,
  };
  if (Object.values(timings).some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Invalid backend startup timing');
  }
  const identity = randomBytes(32).toString('hex');
  const child = spawn(options.executable, options.args, {
    cwd: options.cwd,
    env: { ...options.environment, GNOSI_DESKTOP_INSTANCE: identity },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
    windowsHide: true,
  });
  // Keep a listener throughout the child's lifetime, including an onSpawn
  // callback failure before the readiness waiter can attach its own listeners.
  /** @type {Error | undefined} */
  let processFailure;
  child.on('error', error => { processFailure = error; });
  // Drain both pipes, even when callers do not retain diagnostic output.
  child.stdout.on('data', value => options.onOutput?.(String(value)));
  child.stderr.on('data', value => options.onOutput?.(String(value)));
  try {
    options.onSpawn?.(child);
    await waitForBackend(child, options.healthUrl, identity, timings);
  } catch (error) {
    await stopBackend(child);
    throw error;
  }
  return {
    process: child,
    isRunning: async () => !processFailure && !hasExited(child)
      && await probeBackend(options.healthUrl, identity, timings.requestTimeoutMs)
      && !processFailure && !hasExited(child),
    stop: () => stopBackend(child),
  };
}

module.exports = { launchBackend, probeBackend, stopBackend, waitForBackend };
