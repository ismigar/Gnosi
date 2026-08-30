// @ts-check
const path = require('node:path');
const { constants } = require('node:os');

/** @typedef {(source: string, destination: string) => void} Rename */
/** @type {Rename | undefined} */
let nativeRename;

/** @param {number} errno @param {boolean} [windows] @returns {never} */
function nativeFailure(errno, windows = false) {
  const code = windows
    ? `WIN32_${errno}`
    : Object.entries(constants.errno).find(([, value]) => value === errno)?.[0] ?? `ERRNO_${errno}`;
  throw Object.assign(new Error(`Atomic no-replace rename failed (${code}); original and recovery state must be retained.`), { code, errno });
}

/**
 * Fixed, synchronous OS functions only. Koffi's dynamic FFI signatures are
 * confined to this adapter; no arbitrary symbols or libraries reach callers.
 * Missing symbols or unsupported filesystems fail closed, never copy/delete.
 * @returns {Rename}
 */
function loadNativeRename() {
  const koffi = require('koffi');
  if (process.platform === 'darwin') {
    const library = koffi.load('/usr/lib/libSystem.B.dylib');
    /** @type {(source: string, destination: string, flags: number) => number} */
    const rename = library.func('int renamex_np(const char *source, const char *destination, unsigned int flags)');
    return (source, destination) => {
      if (rename(source, destination, 0x4) !== 0) nativeFailure(koffi.errno()); // RENAME_EXCL
    };
  }
  if (process.platform === 'linux') {
    const library = koffi.load('libc.so.6');
    /** @type {(sourceFd: number, source: string, destinationFd: number, destination: string, flags: number) => number} */
    const rename = library.func('int renameat2(int sourceFd, const char *source, int destinationFd, const char *destination, unsigned int flags)');
    return (source, destination) => {
      if (rename(-100, source, -100, destination, 1) !== 0) nativeFailure(koffi.errno()); // AT_FDCWD, RENAME_NOREPLACE
    };
  }
  if (process.platform === 'win32') {
    const library = koffi.load('kernel32.dll');
    /** @type {(source: string, destination: string, flags: number) => number} */
    const rename = library.func('__stdcall', 'MoveFileExW', 'int', ['str16', 'str16', 'uint']);
    /** @type {() => number} */
    const lastError = library.func('__stdcall', 'GetLastError', 'uint', []);
    return (source, destination) => {
      // WRITE_THROUGH only: neither REPLACE_EXISTING nor COPY_ALLOWED is set.
      if (rename(path.toNamespacedPath(source), path.toNamespacedPath(destination), 0x8) === 0) nativeFailure(lastError(), true);
    };
  }
  throw new Error(`Atomic no-replace rename is unsupported on ${process.platform}`);
}

/** @param {string} source @param {string} destination @returns {void} */
function renameDirectoryNoReplace(source, destination) {
  for (const filename of [source, destination]) {
    if (typeof filename !== 'string' || !path.isAbsolute(filename) || filename.includes('\0')) {
      throw new Error('Atomic rename requires absolute paths without NUL characters');
    }
  }
  nativeRename ??= loadNativeRename();
  nativeRename(source, destination);
}

module.exports = { renameDirectoryNoReplace };
