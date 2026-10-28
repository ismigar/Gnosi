"""Conservative finalization for receipt-bound local component installations.

Dry-run is the default. Native success must be recorded in install/native-verification.json:
status='passed', source_commit, app (absolute), manifest_sha256 (current app),
installation_manifest_sha256 (installation-result.json's manifest_sha256), and true
signature_verified, components_verified, native_startup_verified. This independent,
current verification can supersede an older 'pending' marker in the signed manifest.
Only direct <root>/<run>/install artifacts are eligible. Incomplete/foreign runs
are reported and preserved. This helper never extracts archives or edits the app.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import stat
import sys
import tarfile

LOCK = Path('/private/tmp/gnosi-desktop-install.lock')
COMPONENTS = ('frontend', 'python', 'extensions/web-publishing')


class RetentionError(RuntimeError):
    """Evidence cannot authorize finalization."""


def require(condition, message):
    if not condition:
        raise RetentionError(message)


def safe_path(path):
    path = Path(os.path.abspath(path))
    for part in (path, *path.parents):
        require(not part.is_symlink(), f'Symlink path: {part}')
    return path


def identity(path, allow_link=False):
    info = path.lstat()
    require(info.st_uid == os.getuid(), f'Unowned path: {path}')
    require(allow_link or not stat.S_ISLNK(info.st_mode), f'Symlink path: {path}')
    require(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1,
            f'Hard-linked file: {path}')
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns)


def read_bytes(path):
    safe_path(path)
    before = identity(path)
    require(stat.S_ISREG(before[2]), f'Regular file required: {path}')
    with path.open('rb') as stream:
        data = stream.read()
    require(identity(path) == before, f'File changed: {path}')
    return data


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    value = json.loads(read_bytes(path))
    require(isinstance(value, dict), f'Object receipt required: {path}')
    return value


def member_name(name):
    require(isinstance(name, str) and '\\' not in name and '\x00' not in name,
            'Unsafe archive/inventory name')
    require(name == '.' or (not name.startswith('/') and
            all(part not in ('', '.', '..') for part in name.split('/'))),
            f'Unsafe archive/inventory name: {name}')


def verify_archive(install):
    receipt = load(install / 'backup-result.json')
    archive = safe_path(receipt['archive'])
    require(archive.parent == install and archive.name.endswith(('.tar.gz', '.tgz')),
            'Backup must be a compressed archive directly inside install')
    require(receipt.get('verified') is True and
            receipt.get('bytes_modes_links_verified') is True, 'Missing backup verification')
    expected = load(install / 'original-inventory.json')
    require(expected and receipt.get('entries') == len(expected), 'Backup entry count mismatch')
    for name in expected:
        member_name(name)
    before = identity(archive)
    require(stat.S_ISREG(before[2]), 'Regular backup required')
    hasher = hashlib.sha256()
    with archive.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(block)
        require(hasher.hexdigest() == receipt['sha256'], 'Backup archive digest mismatch')
        stream.seek(0)
        actual = {}
        with tarfile.open(fileobj=stream, mode='r:gz') as bundle:
            for member in bundle:
                member_name(member.name)
                require(member.name not in actual, 'Duplicate archive member')
                entry = {'mode': member.mode}
                if member.isfile():
                    content_hash = hashlib.sha256()
                    size = 0
                    with bundle.extractfile(member) as content:
                        for block in iter(lambda: content.read(1024 * 1024), b''):
                            size += len(block)
                            content_hash.update(block)
                    entry.update(type='file', size=size, sha256=content_hash.hexdigest())
                elif member.isdir():
                    entry.update(type='directory')
                elif member.issym():
                    entry.update(type='link', target=member.linkname)
                else:
                    raise RetentionError('Unsupported archive member type')
                actual[member.name] = entry
    require(actual == expected, 'Archive differs from original inventory')
    require(identity(archive) == before, 'Backup changed during verification')
    return archive, receipt, expected


def success(install, app, current=False):
    result = load(install / 'installation-result.json')
    source = result.get('source_commit', '')
    require(re.fullmatch(r'[0-9a-f]{40}', source) is not None, 'Full source commit required')
    require(result.get('signature_verified') is True and
            result.get('components_verified') is True, 'Installation not successful')
    require(re.fullmatch(r'[0-9a-f]{64}', result.get('manifest_sha256', '')) is not None,
            'Installation manifest digest required')
    native = load(install / 'native-verification.json')
    require(re.fullmatch(r'[0-9a-f]{64}', native.get('installation_manifest_sha256', '')) is not None,
            'Native installation manifest digest required')
    require(native.get('status') == 'passed' and native.get('source_commit') == source and
            native.get('app') == str(app) and
            native.get('installation_manifest_sha256') == result.get('manifest_sha256') and
            all(native.get(key) is True for key in
                ('signature_verified', 'components_verified', 'native_startup_verified')),
            'Native verification is incomplete or not bound to installation')
    require(re.fullmatch(r'[0-9a-f]{64}', native.get('manifest_sha256', '')) is not None,
            'Native manifest digest required')
    if current:
        raw = read_bytes(app / 'Contents/Resources/reconciled-build.json')
        require(digest(raw) == native['manifest_sha256'], 'Installed manifest changed')
        require(json.loads(raw).get('source_commit') == source, 'Installed source differs')
    return result


def tree_snapshot(directory):
    """Record all entries without following links; reject mounts and special files."""
    safe_path(directory)
    require(stat.S_ISDIR(identity(directory)[2]), 'Cleanup root must be a normal directory')
    records = {}
    device = directory.stat().st_dev
    def walk(path):
        token = identity(path, allow_link=True)
        require(token[0] == device, f'Mounted cleanup path: {path}')
        require(stat.S_ISDIR(token[2]) or stat.S_ISREG(token[2]) or stat.S_ISLNK(token[2]),
                f'Unexpected cleanup type: {path}')
        records[path] = token
        if stat.S_ISDIR(token[2]):
            for child in sorted(path.iterdir()):
                walk(child)
    walk(directory)
    return records


def derived_paths(install, original):
    staged = load(install / 'staged.json')
    result = load(install / 'installation-result.json')
    require(staged.get('source_commit') == result['source_commit'], 'Stage source mismatch')
    declared = staged.get('components')
    require(isinstance(declared, dict) and bool(declared) and
            set(declared).issubset(set(COMPONENTS) | {'app.asar'}) and
            all(isinstance(entries, dict) for entries in declared.values()),
            'Unknown stage components')
    components = tuple(declared)
    candidates = []
    for name in ('stage', 'rollback-components', 'rollback-signature'):
        directory = install / name
        if not directory.exists() and not directory.is_symlink():
            continue
        records = tree_snapshot(directory)
        # Every file must be a byte-for-byte derived installer artifact. Directories
        # may be empty scaffolding left by rename; no unrelated files are admitted.
        for path, token in records.items():
            rel = path.relative_to(directory).as_posix()
            if rel == '.':
                continue
            if name == 'stage':
                matches = [(component, rel[len(component):].lstrip('/') or '.')
                           for component in components
                           if rel == component or rel.startswith(component + '/')]
                if not matches:
                    require(stat.S_ISDIR(token[2]) and
                            any(c.startswith(rel + '/') for c in components), 'Foreign stage entry')
                    continue
                component, suffix = matches[0]
                expected = staged['components'][component].get(suffix)
            else:
                if name == 'rollback-components':
                    key = 'Contents/Resources/' + rel
                    scaffold = any(c.startswith(rel + '/') for c in components)
                    require(any(rel == c or rel.startswith(c + '/') for c in components) or
                            (stat.S_ISDIR(token[2]) and scaffold), 'Foreign rollback component')
                else:
                    first = rel.split('/')[0]
                    require(first in ('Gnosi', '_CodeSignature') or rel == 'Info.plist',
                            'Foreign signature rollback entry')
                    key = ('Contents/MacOS/' if first == 'Gnosi' else 'Contents/') + rel
                expected = original.get(key)
                if expected is None and stat.S_ISDIR(token[2]) and name == 'rollback-components' and scaffold:
                    continue
            require(expected is not None, f'Unrecorded cleanup entry: {path}')
            actual = {'mode': stat.S_IMODE(token[2]), 'type': 'directory'}
            if stat.S_ISLNK(token[2]):
                target = os.readlink(path)
                require(not Path(target).is_absolute() and
                        Path(os.path.abspath(path.parent / target)).is_relative_to(directory),
                        f'External cleanup link: {path}')
                actual.update(type='link', target=target)
            elif stat.S_ISREG(token[2]):
                data = read_bytes(path)
                actual.update(type='file', size=len(data), sha256=digest(data))
            require(actual == expected, f'Derived content mismatch: {path}')
        candidates.append((directory, records))
    return candidates



def open_directory(path):
    """Open every absolute ancestor without following a symlink."""
    descriptor = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in Path(path).parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def stat_token(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def check_relative(parent_fd, name, expected, directory_changed=False):
    observed = stat_token(os.stat(name, dir_fd=parent_fd, follow_symlinks=False))
    require(observed[:3] == expected[:3] if directory_changed else observed == expected,
            f'Cleanup identity changed: {name}')


def verify_tree_fd(parent_fd, directory, records):
    """Verify the complete quarantined snapshot before deleting any descendant."""
    def visit(parent, path):
        expected = records[path]
        check_relative(parent, path.name, expected)
        if stat.S_ISDIR(expected[2]):
            fd = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                children = [p for p in records if p.parent == path]
                require(set(os.listdir(fd)) == {p.name for p in children}, 'Quarantine content changed')
                for child in children:
                    visit(fd, child)
            finally:
                os.close(fd)
    visit(parent_fd, directory)


def delete_tree(parent_fd, directory, records, retained_check):
    """Unlink snapshot entries using pinned descriptors, never path traversal."""
    def visit(parent, path):
        expected = records[path]
        check_relative(parent, path.name, expected)
        retained_check()
        if stat.S_ISDIR(expected[2]):
            descriptor = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                 dir_fd=parent)
            try:
                require(stat_token(os.fstat(descriptor)) == expected, 'Directory changed on open')
                children = [p for p in records if p.parent == path]
                require(set(os.listdir(descriptor)) == {p.name for p in children},
                        'Directory entries changed')
                for child in children:
                    visit(descriptor, child)
            finally:
                os.close(descriptor)
            retained_check()
            check_relative(parent, path.name, expected, directory_changed=True)
            os.rmdir(path.name, dir_fd=parent)
        else:
            os.unlink(path.name, dir_fd=parent)
    visit(parent_fd, directory)


def finalize(root, run, app, apply=False):
    root, run, app = map(safe_path, (root, run, app))
    require(root.is_dir() and run.is_dir() and run.parent == root,
            'Run must be a direct child of the specific gauntlet root')
    require(not app.is_relative_to(root) and not root.is_relative_to(app), 'App overlaps cleanup root')
    install = run / 'install'
    safe_path(install)
    require(install.is_dir(), 'Install directory required')
    lock_fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'r+') as lock:
        lock_token = identity(LOCK)
        require(stat.S_ISREG(lock_token[2]), 'Regular install lock required')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        success(install, app, current=True)
        retained, backup, original = verify_archive(install)
        retained_identity = identity(retained)
        cleanup = derived_paths(install, original)
        remove_archives = []
        archive_digests = {}
        skipped = []
        for other in sorted(root.iterdir()):
            if other == run:
                continue
            try:
                safe_path(other)
                require(other.is_dir(), 'Not a run directory')
                older = other / 'install'
                safe_path(older)
                success(older, app)
                archive, old_backup, old_inventory = verify_archive(older)
                # Only installations on the retained backup's source ancestry can
                # be pruned: the current original manifest is the immediate predecessor.
                current_original = load(install / 'original-manifest.json')
                old_result = load(older / 'installation-result.json')
                ancestors = set(current_original.get('preserved_installed_source_commits', []))
                ancestors.add(current_original.get('source_commit'))
                require(old_result['source_commit'] in ancestors, 'Unrelated installation')
                cleanup.extend(derived_paths(older, old_inventory))
                remove_archives.append((archive, identity(archive)))
                archive_digests[archive] = old_backup['sha256']
            except (OSError, ValueError, KeyError, RetentionError, tarfile.TarError) as error:
                skipped.append({'run': str(other), 'reason': str(error)})
        # Preflight the entire plan before touching any path. Lock-cooperating
        # installers cannot race this operation; identity checks detect changes.
        for _, records in cleanup:
            for path, token in records.items():
                require(identity(path, allow_link=True) == token, f'Cleanup changed: {path}')
        for path, token in remove_archives:
            require(identity(path) == token, f'Archive changed: {path}')
        success(install, app, current=True)
        require(identity(LOCK) == lock_token, 'Lock changed')
        # The selected rollback must still be the same fully verified archive
        # after all receipt checks and potentially slow historical scans.
        require(identity(retained) == retained_identity, 'Retained backup changed')
        verified_path, verified_backup, _ = verify_archive(install)
        require(verified_path == retained and verified_backup == backup and
                identity(retained) == retained_identity, 'Retained backup changed')
        report = {'version': 1, 'applied': apply, 'retained_archive': str(retained),
                  'retained_sha256': backup['sha256'],
                  'removed_archives': [str(p) for p, _ in remove_archives],
                  'removed_directories': [str(p) for p, _ in cleanup], 'skipped': skipped,
                  'quarantine_leftovers': [str(p) for p in sorted(install.iterdir())
                                           if p.name.startswith('.retention-quarantine-')]}
        receipt = install / 'retention-result.json'
        previous = None
        if receipt.exists() or receipt.is_symlink():
            previous = load(receipt)
            require(previous.get('retained_sha256') == backup['sha256'], 'Conflicting cleanup receipt')
        if apply:
            def retained_check():
                require(identity(retained) == retained_identity, 'Retained backup changed')
            with ExitStack() as descriptors:
                # Open every ancestor before the first unlink; replacing any
                # ancestor with a symlink fails without touching its target.
                parents = {}
                for path in [p for p, _ in cleanup] + [p for p, _ in remove_archives] + [receipt]:
                    if path.parent not in parents:
                        fd = open_directory(path.parent)
                        descriptors.callback(os.close, fd)
                        parents[path.parent] = fd
                for directory, records in cleanup:
                    check_relative(parents[directory.parent], directory.name, records[directory])
                for path, token in remove_archives:
                    check_relative(parents[path.parent], path.name, token)
                retained_check()
                # The installation lock serializes cooperating installers. An
                # unpredictable private quarantine also confines ordinary path
                # replacement races. Arbitrary same-user adversarial code is not
                # a security boundary; unknown quarantine content is preserved.
                quarantine_name = '.retention-quarantine-' + secrets.token_hex(16)
                install_fd = parents[install]
                quarantine_fd = None
                quarantined_trees = []
                quarantined_archives = []
                if cleanup or remove_archives:
                    os.mkdir(quarantine_name, mode=0o700, dir_fd=install_fd)
                    quarantine_fd = os.open(quarantine_name, os.O_RDONLY | os.O_DIRECTORY |
                                            os.O_NOFOLLOW, dir_fd=install_fd)
                    descriptors.callback(os.close, quarantine_fd)
                    for index, (directory, records) in enumerate(cleanup):
                        destination = 'tree-' + str(index)
                        retained_check()
                        os.rename(directory.name, destination, src_dir_fd=parents[directory.parent],
                                  dst_dir_fd=quarantine_fd)
                        moved = stat_token(os.stat(destination, dir_fd=quarantine_fd,
                                                   follow_symlinks=False))
                        require(moved[:3] == records[directory][:3], 'Quarantined root changed')
                        # Rename changes the root ctime, but not its descendants.
                        relocated = Path(destination)
                        moved_records = {relocated / p.relative_to(directory): token
                                         for p, token in records.items()}
                        moved_records[relocated] = moved
                        verify_tree_fd(quarantine_fd, relocated, moved_records)
                        quarantined_trees.append((relocated, moved_records))
                    for index, (path, token) in enumerate(remove_archives):
                        destination = 'archive-' + str(index) + '.tar.gz'
                        retained_check()
                        os.rename(path.name, destination, src_dir_fd=parents[path.parent],
                                  dst_dir_fd=quarantine_fd)
                        observed = stat_token(os.stat(destination, dir_fd=quarantine_fd,
                                                     follow_symlinks=False))
                        require(observed[:5] == token[:5], 'Quarantined archive changed')
                        fd = os.open(destination, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=quarantine_fd)
                        hasher = hashlib.sha256()
                        with os.fdopen(fd, 'rb') as stream:
                            for block in iter(lambda: stream.read(1024 * 1024), b''):
                                hasher.update(block)
                        require(hasher.hexdigest() == archive_digests[path],
                                'Quarantined archive digest changed')
                        check_relative(quarantine_fd, destination, observed)
                        quarantined_archives.append((destination, observed))
                    for directory, records in quarantined_trees:
                        delete_tree(quarantine_fd, directory, records, retained_check)
                    for name, token in quarantined_archives:
                        retained_check()
                        check_relative(quarantine_fd, name, token)
                        os.unlink(name, dir_fd=quarantine_fd)
                    os.rmdir(quarantine_name, dir_fd=install_fd)
                if previous is not None and not cleanup and not remove_archives:
                    return previous
                payload = (json.dumps(report, indent=2) + '\n').encode()
                install_fd = parents[install]
                temporary = 'retention-result.json.tmp'
                fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW,
                             0o600, dir_fd=install_fd)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(payload)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, receipt.name, src_dir_fd=install_fd, dst_dir_fd=install_fd)
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    command = sub.add_parser('finalize')
    for name in ('root', 'run', 'app'):
        command.add_argument('--' + name, required=True, type=Path)
    command.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        report = finalize(args.root, args.run, args.app, args.apply)
    except (OSError, ValueError, KeyError, RetentionError, tarfile.TarError) as error:
        sys.stderr.write(f'Finalization refused: {error}\n')
        return 1
    sys.stdout.write(json.dumps(report, indent=2) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
