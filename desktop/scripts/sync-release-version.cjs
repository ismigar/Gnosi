#!/usr/bin/env node

const fs = require('node:fs');

const [, , releaseVersion, rootManifest, desktopManifest, frontendManifest, pyprojectPath] =
  process.argv;

if (
  !releaseVersion ||
  !rootManifest ||
  !desktopManifest ||
  !frontendManifest ||
  !pyprojectPath
) {
  process.stderr.write(
    'Usage: sync-release-version.cjs <version> <root-package> <desktop-package> ' +
      '<frontend-package> <pyproject>\n',
  );
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?(?![\s\S])/.test(releaseVersion)) {
  process.stderr.write(`Invalid release version: ${releaseVersion}\n`);
  process.exit(1);
}

// Walk only JSON already accepted by JSON.parse. String tokens are indivisible,
// so braces and escaped property names cannot confuse the nesting depth.
function rootVersionRange(source) {
  const tokens = /"(?:[^"\\]|\\.)*"|[{}\[\]:,]/g;
  let depth = 0;
  let keys = 0;
  const ranges = [];
  for (let token = tokens.exec(source); token; token = tokens.exec(source)) {
    const text = token[0];
    if (text === '{' || text === '[') depth += 1;
    else if (text === '}' || text === ']') depth -= 1;
    else if (depth === 1 && text.startsWith('"') && JSON.parse(text) === 'version') {
      const rest = source.slice(tokens.lastIndex);
      if (/^\s*:/.test(rest)) keys += 1;
      const value = rest.match(/^\s*:\s*("(?:[^"\\]|\\.)*")/);
      if (value) {
        const end = tokens.lastIndex + value[0].length;
        ranges.push([end - value[1].length, end]);
      }
    }
  }
  if (keys !== 1 || ranges.length !== 1) throw new Error('Expected exactly one top-level version string');
  return ranges[0];
}

function planManifest(source) {
  const manifest = JSON.parse(source);
  if (!manifest || Array.isArray(manifest) || typeof manifest.version !== 'string') {
    throw new Error('Missing top-level version string');
  }
  const [start, end] = rootVersionRange(source);
  if (manifest.version === releaseVersion) return source;
  return source.slice(0, start) + JSON.stringify(releaseVersion) + source.slice(end);
}

// This locates structural lines, not arbitrary TOML values. In particular,
// apparent table headers inside quoted descriptions must never be editable.
function structuralLines(source) {
  const lines = [];
  let quote = '';
  let nesting = 0;
  let offset = 0;
  for (const rawLine of source.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!quote && nesting === 0) lines.push({ line, offset });
    for (let index = 0; index < line.length; index += 1) {
      if (quote) {
        if (quote.startsWith('"') && line[index] === '\\') index += 1;
        else if (line.startsWith(quote, index)) {
          index += quote.length - 1;
          if (quote.length === 3) {
            // TOML permits one or two content quotes just before the closing
            // triple delimiter (four or five consecutive quotes in total).
            for (let extra = 0; extra < 2 && line[index + 1] === quote[0]; extra += 1) index += 1;
          }
          quote = '';
        }
      } else if (line[index] === '#') break;
      else if (line[index] === '"' || line[index] === "'") {
        quote = line.startsWith(line[index].repeat(3), index)
          ? line[index].repeat(3) : line[index];
        index += quote.length - 1;
      } else if (line[index] === '[' || line[index] === '{') nesting += 1;
      else if (line[index] === ']' || line[index] === '}') nesting -= 1;
      if (nesting < 0) throw new Error('Unbalanced TOML container');
    }
    if (quote.length === 1) throw new Error('Unterminated single-line TOML string');
    offset += rawLine.length + 1;
  }
  if (quote) throw new Error('Unterminated multiline TOML string');
  if (nesting !== 0) throw new Error('Unbalanced TOML container');
  return lines;
}

function planPyproject(source) {
  let inProject = false;
  let projects = 0;
  const ranges = [];
  for (const { line, offset } of structuralLines(source)) {
    if (/^\s*\[/.test(line)) {
      const header = line.match(/^\s*\[([^\]\r\n]+)\]\s*(?:#.*)?$/);
      inProject = !!header && /^(?:project|"project"|'project')$/.test(header[1].trim());
      if (inProject) projects += 1;
    } else if (inProject && /^\s*(?:version|"version"|'version')\s*=/.test(line)) {
      const value = line.match(/^(\s*(?:version|"version"|'version')\s*=\s*)(["'])([^"'\\\r\n]*)\2\s*(?:#.*)?$/);
      if (!value) throw new Error('Expected a single-line quoted [project].version');
      const start = offset + value[1].length + 1;
      ranges.push([start, start + value[3].length]);
    }
  }
  if (projects !== 1 || ranges.length !== 1) {
    throw new Error('Expected exactly one [project] table and version assignment');
  }
  const [start, end] = ranges[0];
  return source.slice(0, start) + releaseVersion + source.slice(end);
}

try {
  const plans = [rootManifest, desktopManifest, frontendManifest, pyprojectPath].map((file, index) => {
    try {
      const source = fs.readFileSync(file, 'utf8');
      const next = index === 3 ? planPyproject(source) : planManifest(source);
      return { file, source, next };
    } catch (error) {
      throw new Error(`Cannot prepare ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  // Validate every input before the first write. Separate file writes are not
  // a crash-safe transaction; release preparation still requires diff review.
  for (const { file, source, next } of plans) {
    if (source !== next) fs.writeFileSync(file, next);
  }
  process.stdout.write(`Synchronized release version ${releaseVersion}.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
