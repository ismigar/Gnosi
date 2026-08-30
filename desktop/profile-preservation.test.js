const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { preserveLegacyProfile } = require('./profile-preservation');
const exclusiveRename = require('./exclusive-rename');

// Keep these tests synchronous: t.mock.method patches the shared fs module.
const posixOnly = {
  skip: process.platform === 'win32'
    ? 'POSIX modes / symlinks require platform support or Windows privileges'
    : false,
};

function fixture(t, { profile = true, source = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-profile-test-')));
  t.after(() => {
    t.mock.restoreAll();
    // This is exclusively the fresh temporary tree allocated by this test.
    fs.rmSync(root, { recursive: true, force: true });
  });
  const profilePath = path.join(root, 'Gnosi perfil à');
  const recovery = path.join(root, '.Gnosi perfil à.gnosi-electron-recovery');
  const f = {
    root,
    profile: profilePath,
    source: path.join(profilePath, 'databases'),
    recovery,
    saved: path.join(recovery, 'databases.saved'),
    intent: path.join(recovery, 'intent.json'),
    completed: path.join(recovery, 'completed.json'),
    appData: path.join(profilePath, 'system'),
  };
  if (!profile) return f;
  fs.mkdirSync(f.profile);
  for (const [name, bytes] of [
    ['Cookies', Buffer.from([0, 255, 2, 128])],
    ['Local Storage/leveldb/000001.log', Buffer.from('fictitious chat state')],
    ['IndexedDB/app_gnosi_0.indexeddb.leveldb/CURRENT', Buffer.from('fixture index')],
    ['system/gnosi.sqlite', Buffer.from('fictitious Gnosi database')],
    ['vaults/note.md', Buffer.from('fixture note')],
    ['gnosi.sqlite', Buffer.from('fictitious root database')],
  ]) {
    const filename = path.join(f.profile, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, bytes);
  }
  fs.mkdirSync(path.join(root, 'Other Browser'));
  fs.writeFileSync(path.join(root, 'Other Browser', 'Cookies'), 'unrelated fixture');
  if (source) {
    fs.mkdirSync(path.join(f.source, 'nested', 'empty directory'), { recursive: true });
    fs.writeFileSync(path.join(f.source, 'Databases.db'), Buffer.from([0, 255, 0, 13, 10, 128, 1]));
    fs.writeFileSync(path.join(f.source, 'nested', 'unrecognized payload.bin'),
      Buffer.from(Array.from({ length: 1024 }, (_, index) => index % 256)));
    fs.writeFileSync(path.join(f.source, 'Databases.db-wal'), 'opaque WAL fixture');
    fs.writeFileSync(path.join(f.source, 'Databases.db-shm'), 'opaque SHM fixture');
  }
  return f;
}

// Snapshot bytes and stable identity, never following a link. Exclude ctime,
// which legitimately changes on rename, and directory mtime/size/link counts.
function snapshot(filename) {
  const info = fs.lstatSync(filename, { bigint: true });
  const result = { device: info.dev, inode: info.ino, mode: info.mode };
  if (info.isSymbolicLink()) return { ...result, target: fs.readlinkSync(filename) };
  if (info.isDirectory()) {
    return {
      ...result,
      entries: fs.readdirSync(filename).sort().map(name => [name, snapshot(path.join(filename, name))]),
    };
  }
  return { ...result, bytes: fs.readFileSync(filename), links: info.nlink, mtime: info.mtimeNs };
}

function siblings(f) {
  return [
    ...fs.readdirSync(f.profile).filter(name => name !== 'databases')
      .sort().map(name => [name, snapshot(path.join(f.profile, name))]),
    ['Other Browser', snapshot(path.join(f.root, 'Other Browser'))],
  ];
}

function expectedIntent(f, directory = f.source) {
  const info = fs.lstatSync(directory, { bigint: true });
  return { version: 1, profile: f.profile, device: String(info.dev), inode: String(info.ino) };
}

function journal(filename, value) {
  fs.writeFileSync(filename, `${JSON.stringify(value)}\n`, { flag: 'wx' });
}

function prepareIntent(f) {
  const intent = expectedIntent(f);
  fs.mkdirSync(f.recovery);
  journal(f.intent, intent);
  return intent;
}

function withMock(t, method, implementation, action) {
  const mock = t.mock.method(fs, method, implementation);
  try { return action(); } finally { mock.mock.restore(); }
}

function withoutWrites(t, action) {
  const attempts = [];
  const methods = [
    'mkdirSync', 'mkdtempSync', 'renameSync', 'copyFileSync', 'cpSync',
    'rmSync', 'rmdirSync', 'unlinkSync', 'writeFileSync', 'appendFileSync',
    'truncateSync', 'ftruncateSync', 'chmodSync', 'chownSync', 'linkSync', 'symlinkSync',
  ];
  const mocks = methods.map(method => t.mock.method(fs, method, () => {
    attempts.push(method);
    assert.fail(`unexpected filesystem mutation: ${method}`);
  }));
  const open = fs.openSync;
  mocks.push(t.mock.method(fs, 'openSync', (filename, flags, ...args) => {
    if (flags !== 'r' && flags !== 'rs') attempts.push(`openSync(${flags})`);
    assert.ok(flags === 'r' || flags === 'rs', `unexpected writable open: ${flags}`);
    return open(filename, flags, ...args);
  }));
  try { return action(); } finally {
    mocks.forEach(mock => mock.mock.restore());
    // assert.throws inside action must not mistake a guard failure for a
    // legitimate production rejection and thereby hide an attempted write.
    assert.deepEqual(attempts, [], 'no filesystem mutations may even be attempted');
  }
}

function rejectUnchanged(t, f, protectedPaths = []) {
  const before = snapshot(f.root);
  withoutWrites(t, () => assert.throws(() => preserveLegacyProfile(f.profile, protectedPaths)));
  assert.deepEqual(snapshot(f.root), before, 'failure must not alter any fixture data');
}

function assertPreserved(f, payload, neighbors) {
  assert.equal(fs.existsSync(f.source), false);
  assert.deepEqual(snapshot(f.saved), payload, 'opaque bytes, inodes and file metadata must survive');
  assert.deepEqual(siblings(f), neighbors, 'browser and Gnosi sibling data must stay in place');
  assert.deepEqual(fs.readdirSync(f.recovery).sort(), ['completed.json', 'databases.saved', 'intent.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.intent, 'utf8')), expectedIntent(f, f.saved));
  assert.deepEqual(JSON.parse(fs.readFileSync(f.completed, 'utf8')), expectedIntent(f, f.saved));
}

test('a missing profile returns absent without creating any paths', t => {
  const f = fixture(t, { profile: false });
  const before = snapshot(f.root);
  assert.deepEqual(withoutWrites(t, () => preserveLegacyProfile(f.profile)), {
    status: 'absent', recoveryDirectory: f.recovery,
  });
  assert.deepEqual(snapshot(f.root), before);
});

test('an existing profile without databases leaves every sibling untouched', t => {
  const f = fixture(t, { source: false });
  const before = snapshot(f.root);
  assert.deepEqual(withoutWrites(t, () => preserveLegacyProfile(f.profile)), {
    status: 'absent', recoveryDirectory: f.recovery,
  });
  assert.deepEqual(snapshot(f.root), before);
});

test('preserves opaque bytes and inodes without inspecting payload or moving siblings', t => {
  const f = fixture(t);
  const payload = snapshot(f.source);
  const neighbors = siblings(f);
  const mocks = [];
  for (const method of ['readdirSync', 'readFileSync']) {
    const original = fs[method];
    mocks.push(t.mock.method(fs, method, (filename, ...args) => {
      for (const directory of [f.source, f.saved]) {
        const relative = typeof filename === 'string' ? path.relative(directory, filename) : '..';
        assert.ok(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
          `payload must not be inspected through ${method}`);
      }
      return original(filename, ...args);
    }));
  }
  for (const method of ['copyFileSync', 'cpSync', 'rmSync', 'rmdirSync', 'unlinkSync']) {
    mocks.push(t.mock.method(fs, method, () => assert.fail(`preservation must not call ${method}`)));
  }
  try {
    assert.deepEqual(preserveLegacyProfile(f.profile), {
      status: 'preserved', recoveryDirectory: f.recovery,
    });
  } finally { mocks.forEach(mock => mock.mock.restore()); }
  assertPreserved(f, payload, neighbors);
});

test('a completed rerun keeps both journals and all data byte/inode stable without writes', t => {
  const f = fixture(t);
  preserveLegacyProfile(f.profile);
  const before = snapshot(f.root);
  assert.deepEqual(withoutWrites(t, () => preserveLegacyProfile(f.profile)), {
    status: 'preserved', recoveryDirectory: f.recovery,
  });
  assert.deepEqual(snapshot(f.root), before);
});

test('POSIX recovery directory and journals have private permissions', posixOnly, t => {
  const f = fixture(t);
  preserveLegacyProfile(f.profile);
  assert.equal(fs.statSync(f.recovery).mode & 0o777, 0o700);
  for (const filename of [f.intent, f.completed]) {
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  }
});

test('unsafe roots and non-directory profile/source/recovery paths fail without writes', t => {
  withoutWrites(t, () => {
    for (const unsafe of ['', 'relative/profile', path.parse(os.tmpdir()).root]) {
      assert.throws(() => preserveLegacyProfile(unsafe));
    }
  });
  for (const target of ['profile', 'source', 'recovery']) {
    const f = fixture(t, { profile: target !== 'profile', source: target !== 'source' });
    fs.writeFileSync(f[target], 'must remain a regular file');
    rejectUnchanged(t, f);
  }
});

test('existing saved directories or files are never overwritten', t => {
  for (const kind of ['empty directory', 'nonempty directory', 'file']) {
    const f = fixture(t);
    prepareIntent(f);
    if (kind === 'file') fs.writeFileSync(f.saved, 'destination file');
    else {
      fs.mkdirSync(f.saved);
      if (kind === 'nonempty directory') fs.writeFileSync(path.join(f.saved, 'unrelated'), 'keep');
    }
    rejectUnchanged(t, f);
  }
});

test('a destination appearing immediately before rename is not silently overwritten', t => {
  const f = fixture(t);
  const payload = snapshot(f.source);
  const rename = exclusiveRename.renameDirectoryNoReplace;
  let destinationIdentity;
  let failure;
  const mock = t.mock.method(exclusiveRename, 'renameDirectoryNoReplace', (source, destination) => {
    assert.equal(source, f.source);
    assert.equal(destination, f.saved);
    fs.mkdirSync(destination);
    destinationIdentity = snapshot(destination);
    return rename(source, destination);
  });
  try {
    try { preserveLegacyProfile(f.profile); } catch (error) { failure = error; }
  } finally { mock.mock.restore(); }
  assert.ok(destinationIdentity, 'exercise the conflict at the real rename boundary');
  if (!failure) {
    t.diagnostic(`unexpected success: sourceExists=${fs.existsSync(f.source)}, `
      + `destinationInodeRetained=${snapshot(f.saved).inode === destinationIdentity.inode}, `
      + `completionWritten=${fs.existsSync(f.completed)}`);
  }
  assert.ok(failure, 'must reject instead of overwriting a newly appeared destination');
  assert.deepEqual(snapshot(f.source), payload);
  assert.deepEqual(snapshot(f.saved), destinationIdentity);
  assert.equal(fs.existsSync(f.completed), false);
});

test('unknown recovery entries are retained and block preservation', t => {
  const f = fixture(t);
  fs.mkdirSync(f.recovery);
  fs.writeFileSync(path.join(f.recovery, 'unrecognized-backup.bin'), Buffer.from([0, 255, 17]));
  rejectUnchanged(t, f);
});

test('saved data without intent and journals without data fail closed', t => {
  for (const state of ['saved without intent', 'orphan intent', 'completion without intent']) {
    const f = fixture(t, { source: state === 'completion without intent' });
    fs.mkdirSync(f.recovery);
    if (state === 'saved without intent') {
      fs.mkdirSync(f.saved);
      fs.writeFileSync(path.join(f.saved, 'keep'), 'orphan data');
    } else if (state === 'orphan intent') {
      journal(f.intent, { version: 1, profile: f.profile, device: '1', inode: '2' });
    } else journal(f.completed, expectedIntent(f));
    rejectUnchanged(t, f);
  }
});

test('unknown or oversized intent schemas are never trusted or rewritten', t => {
  const variants = [
    intent => ({ ...intent, version: 2 }),
    intent => ({ ...intent, profile: `${intent.profile}-other` }),
    intent => ({ ...intent, inode: 7 }),
    intent => ({ ...intent, device: '-1' }),
    intent => ({ ...intent, unexpected: true }),
    () => null,
    intent => ({ ...intent, extra: 'x'.repeat(16_384) }),
  ];
  for (const variant of variants) {
    const f = fixture(t);
    fs.mkdirSync(f.recovery);
    journal(f.intent, variant(expectedIntent(f)));
    rejectUnchanged(t, f);
  }
});

test('truncated intent or completion journals block retries without losing data', t => {
  for (const target of ['intent', 'completed']) {
    const f = fixture(t);
    if (target === 'completed') {
      prepareIntent(f);
      fs.renameSync(f.source, f.saved);
    } else fs.mkdirSync(f.recovery);
    fs.writeFileSync(f[target], '{"version":1,');
    rejectUnchanged(t, f);
    rejectUnchanged(t, f);
  }
});

test('a completion journal inconsistent with intent fails closed', t => {
  const f = fixture(t);
  const intent = prepareIntent(f);
  fs.renameSync(f.source, f.saved);
  journal(f.completed, { ...intent, inode: String(BigInt(intent.inode) + 1n) });
  rejectUnchanged(t, f);
});

test('intent cannot authorize a source directory with a different identity', t => {
  const f = fixture(t);
  fs.mkdirSync(f.recovery);
  const intent = expectedIntent(f);
  journal(f.intent, { ...intent, inode: String(BigInt(intent.inode) + 1n) });
  rejectUnchanged(t, f);
});

test('intent cannot authorize a saved directory with a different identity', t => {
  const f = fixture(t);
  prepareIntent(f);
  fs.renameSync(f.source, path.join(f.root, 'original kept aside'));
  fs.mkdirSync(f.saved);
  fs.writeFileSync(path.join(f.saved, 'unrelated'), 'different tree');
  rejectUnchanged(t, f);
});

test('a re-created source after completed preservation never replaces the saved tree', t => {
  const f = fixture(t);
  preserveLegacyProfile(f.profile);
  fs.mkdirSync(f.source);
  fs.writeFileSync(path.join(f.source, 'new database'), 'new fixture data');
  rejectUnchanged(t, f);
});

test('a symlink at the profile root is rejected without touching its target', posixOnly, t => {
  const f = fixture(t);
  const target = path.join(f.root, 'real profile');
  fs.renameSync(f.profile, target);
  fs.symlinkSync(target, f.profile, 'dir');
  rejectUnchanged(t, f);
});

test('symlinks at recovery or saved roots cannot redirect preservation', posixOnly, t => {
  for (const location of ['recovery', 'saved']) {
    const f = fixture(t);
    const target = path.join(f.root, 'unrelated recovery target');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep'), 'do not touch');
    if (location === 'saved') prepareIntent(f);
    fs.symlinkSync(target, f[location], 'dir');
    rejectUnchanged(t, f);
  }
});

test('live and dangling symlinks at the source are rejected', posixOnly, t => {
  for (const dangling of [false, true]) {
    const f = fixture(t, { source: false });
    const target = path.join(f.root, 'source target');
    if (!dangling) {
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'keep'), 'fixture');
    }
    fs.symlinkSync(target, f.source, 'dir');
    rejectUnchanged(t, f);
  }
});

test('symlinked intent and completion journals are rejected, even with valid target JSON', posixOnly, t => {
  for (const location of ['intent', 'completed']) {
    const f = fixture(t);
    const intent = expectedIntent(f);
    if (location === 'completed') {
      prepareIntent(f);
      fs.renameSync(f.source, f.saved);
    } else fs.mkdirSync(f.recovery);
    const target = path.join(f.root, 'external journal.json');
    journal(target, intent);
    fs.symlinkSync(target, f[location], 'file');
    rejectUnchanged(t, f);
  }
});

test('hard-linked journals are not accepted as exclusive recovery evidence', t => {
  const f = fixture(t);
  prepareIntent(f);
  fs.linkSync(f.intent, path.join(f.root, 'second journal link'));
  rejectUnchanged(t, f);
});

test('protected source/recovery paths and nonexistent descendants block all writes', t => {
  for (const select of [
    f => f.source,
    f => path.join(f.source, 'nested', 'not created', 'app data'),
    f => f.recovery,
    f => path.join(f.saved, 'not created', 'app data'),
    () => 'relative/app data',
  ]) {
    const f = fixture(t);
    rejectUnchanged(t, f, [select(f)]);
  }
});

test('profile fallback and disjoint Gnosi paths remain allowed, including lookalike prefixes', t => {
  const f = fixture(t);
  const payload = snapshot(f.source);
  const neighbors = siblings(f);
  // The packaged default is the profile itself; only the reserved child tree
  // is moved, while normal application data under the profile remains intact.
  const protectedPaths = Object.freeze([
    f.profile, f.appData, path.join(f.profile, 'databases-other'), `${f.recovery}-other`,
  ]);
  assert.equal(preserveLegacyProfile(f.profile, protectedPaths).status, 'preserved');
  assertPreserved(f, payload, neighbors);
});

test('protected paths through symlink aliases cannot conceal an overlap', posixOnly, t => {
  for (const location of ['source', 'recovery', 'missing descendant']) {
    const f = fixture(t);
    const alias = path.join(f.root, 'application alias');
    if (location === 'recovery') {
      fs.mkdirSync(f.recovery);
      fs.symlinkSync(f.recovery, alias, 'dir');
    } else fs.symlinkSync(f.source, alias, 'dir');
    const protectedPath = location === 'missing descendant'
      ? path.join(alias, 'not created', 'app data') : alias;
    rejectUnchanged(t, f, [protectedPath]);
  }
});

// Six bounded fault cases exercise the actual filesystem, with exactly one
// failing operation. Post-rename failures must never trigger rollback/copy.
for (const phase of ['before', 'after']) {
  for (const code of ['EXDEV', 'EACCES', 'ENOSPC']) {
    test(`${code} ${phase} rename propagates, preserves data and safely resumes or refuses`, t => {
      const f = fixture(t);
      const payload = snapshot(f.source);
      const neighbors = siblings(f);
      const fault = Object.assign(new Error(`injected ${code} ${phase} rename`), { code });
      const rename = exclusiveRename.renameDirectoryNoReplace;
      const open = fs.openSync;
      const write = fs.writeFileSync;
      let injected = false;
      let partialJournal;
      let descriptor;
      const mocks = [];
      if (code === 'EXDEV') {
        mocks.push(t.mock.method(exclusiveRename, 'renameDirectoryNoReplace', (source, destination) => {
          assert.equal(source, f.source);
          assert.equal(destination, f.saved);
          if (phase === 'after') rename(source, destination);
          injected = true;
          throw fault;
        }));
      } else {
        const target = phase === 'before' ? f.intent : f.completed;
        mocks.push(t.mock.method(fs, 'openSync', (filename, flags, ...args) => {
          if (filename === target && flags === 'wx' && code === 'EACCES') {
            injected = true;
            throw fault;
          }
          const opened = open(filename, flags, ...args);
          if (filename === target && flags === 'wx') descriptor = opened;
          return opened;
        }));
        if (code === 'ENOSPC') {
          mocks.push(t.mock.method(fs, 'writeFileSync', (filename, ...args) => {
            if (filename === descriptor) {
              write(filename, '{"version":1,');
              partialJournal = target;
              injected = true;
              throw fault;
            }
            return write(filename, ...args);
          }));
        }
      }
      for (const method of ['copyFileSync', 'cpSync', 'rmSync', 'rmdirSync', 'unlinkSync']) {
        mocks.push(t.mock.method(fs, method, () => assert.fail(`fault must not cause ${method}`)));
      }
      try {
        assert.throws(() => preserveLegacyProfile(f.profile), error => error === fault);
      } finally { mocks.forEach(mock => mock.mock.restore()); }
      assert.ok(injected, 'fault must occur in the intended operation');
      assert.equal(fs.existsSync(phase === 'before' ? f.saved : f.source), false);
      assert.deepEqual(snapshot(phase === 'before' ? f.source : f.saved), payload);
      assert.deepEqual(siblings(f), neighbors);
      if (partialJournal) {
        assert.equal(fs.readFileSync(partialJournal, 'utf8'), '{"version":1,');
        rejectUnchanged(t, f);
        rejectUnchanged(t, f);
      } else {
        if (phase === 'after' || code === 'EXDEV') {
          assert.deepEqual(JSON.parse(fs.readFileSync(f.intent, 'utf8')),
            expectedIntent(f, phase === 'before' ? f.source : f.saved));
        }
        assert.equal(preserveLegacyProfile(f.profile).status, 'preserved');
        assertPreserved(f, payload, neighbors);
        const beforeRerun = snapshot(f.root);
        withoutWrites(t, () => assert.equal(preserveLegacyProfile(f.profile).status, 'preserved'));
        assert.deepEqual(snapshot(f.root), beforeRerun);
      }
    });
  }
}
