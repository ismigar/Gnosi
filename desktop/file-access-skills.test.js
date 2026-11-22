const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { build } = require('./scripts/file-access-build.cjs');

test('verify coordinated personal skill sources on macOS', { skip: process.platform !== 'darwin' }, async (t) => {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gnosi-skill-access-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const helper = build(path.join(temp, 'helper'));
  const root = path.join(temp, 'vault', '.gnosi', 'agent', 'skills');
  const makeFile = (parent, name, text) => {
    fs.mkdirSync(parent, { recursive: true });
    const file = path.join(parent, name);
    fs.writeFileSync(file, text);
    return file;
  };
  const a = makeFile(path.join(root, 'user.first'), 'skill.yaml', 'id: user.first');
  const b = makeFile(path.join(root, 'user.second'), 'SKILL.md', 'Segona instrucció.');
  const invoke = (paths) => spawnSync(helper, ['--verify-skill-sources'], {
    input: JSON.stringify(paths), encoding: 'utf8', timeout: 15_000,
  });
  const assertRejected = (paths) => {
    const result = invoke(paths);
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    return result.status;
  };

  await t.test('returns complete descriptor stamps in request order, through the supported maximum', () => {
    const paths = Array.from({ length: 256 }, (_, i) => i % 2 ? a : b);
    const result = invoke(paths);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(result.stdout);
    assert.equal(rows.length, paths.length);
    rows.forEach((row, i) => {
      assert.equal(row.length, 20);
      assert.ok(row.every(Number.isInteger));
      const info = fs.statSync(paths[i]);
      assert.deepEqual([row[0], row[1], row[2], row[6]], [info.mode, info.ino, info.dev, info.size]);
    });
    const ordinary = spawnSync(helper, [a, '--snapshot'], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(ordinary.status, 0, ordinary.stderr);
    assert.equal(ordinary.stdout, fs.readFileSync(a, 'utf8'));
    assert.equal(JSON.parse(ordinary.stderr).length, 20);
  });

  await t.test('loss of directory read permission invalidates every result with unchanged file identity',
    { skip: process.getuid() === 0 }, () => {
      const original = fs.statSync(b, { bigint: true });
      fs.chmodSync(path.dirname(b), 0o111);
      try {
        assert.deepEqual(fs.statSync(b, { bigint: true }), original);
        assert.equal(assertRejected([a, b]), 77);
      } finally {
        fs.chmodSync(path.dirname(b), 0o700);
      }
      assert.equal(invoke([a, b]).status, 0);
    });

  await t.test('rejects invalid sets, missing members, symbolic links and mixed vaults without partial stamps', () => {
    const other = makeFile(path.join(temp, 'other', '.gnosi', 'agent', 'skills', 'user.x'), 'skill.yaml', 'other');
    const outside = makeFile(path.join(temp, 'user.safe'), 'skill.yaml', 'outside');
    const link = path.join(root, 'user.linked');
    fs.symlinkSync(path.dirname(a), link);
    const fileLink = path.join(path.dirname(a), 'SKILL.md');
    fs.symlinkSync(b, fileLink);
    const malformed = [
      [], Array(257).fill(a), ['relative/skill.yaml'], [42], [a, other], [a, outside],
      [a, path.join(link, 'skill.yaml')], [a, fileLink], [a, path.join(path.dirname(b), 'skill.yaml')],
      [a, root + '/x/../user.first/skill.yaml'], [a, path.join(root, 'user.Bad', 'skill.yaml')],
      [a, path.join(path.dirname(a), 'other.md')], [a + '\0hidden'],
    ];
    for (const paths of malformed) assertRejected(paths);
    const oversized = spawnSync(helper, ['--verify-skill-sources'], {
      input: ' '.repeat(2 * 1024 * 1024), encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(oversized.status, 64);
    assert.equal(oversized.stdout, '');
  });
});
