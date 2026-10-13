import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const reads = new Map();
function readFile(path) {
  const text = ts.sys.readFile(path);
  reads.set(resolve(path), text === undefined ? null : createHash('sha256').update(text).digest('hex'));
  return text;
}
const formatHost = {
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getCanonicalFileName: file => ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase(),
  getNewLine: () => ts.sys.newLine,
};
const formatted = diagnostics => ts.sortAndDeduplicateDiagnostics(diagnostics)
  .map(diagnostic => ts.formatDiagnostics([diagnostic], formatHost));
const fatal = [];
const config = ts.getParsedCommandLineOfConfigFile(resolve('tsconfig.json'), { noEmit: true }, {
  ...ts.sys, readFile, onUnRecoverableConfigFileDiagnostic: diagnostic => fatal.push(diagnostic),
});

function check() {
  if (!config) return { checkTypes: false, diagnostics: formatted(fatal) };
  const host = ts.createCompilerHost(config.options);
  host.readFile = readFile;
  const program = ts.createProgram({
    rootNames: config.fileNames, options: config.options, host,
    projectReferences: config.projectReferences,
    configFileParsingDiagnostics: ts.getConfigFileParsingDiagnostics(config),
  });
  const sources = program.getSourceFiles();
  // Include configs, package manifests, failed reads and the full resolved graph.
  // Compare content, not mtimes, so separate workers cannot accept mixed inputs.
  const fingerprint = createHash('sha256').update(JSON.stringify({
    reads: [...reads].sort(([a], [b]) => a.localeCompare(b)),
    files: sources.map(file => file.fileName), roots: config.fileNames,
  })).digest('hex');

  if (request.phase === 'discover') {
    // Match tsc's diagnostic stages, including its syntax/options early exits.
    const diagnostics = [...program.getConfigFileParsingDiagnostics()];
    const configErrors = diagnostics.length;
    diagnostics.push(...program.getSyntacticDiagnostics());
    if (diagnostics.length === configErrors) {
      diagnostics.push(...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics());
    }
    const checkTypes = diagnostics.length === configErrors;
    // noEmit is forced above; discard build-info writes and never reuse a cache.
    diagnostics.push(...program.emit(undefined, () => {}).diagnostics);
    const batches = [];
    let batch = [];
    let cost = 0;
    for (const source of sources) {
      if (cost === 256) {
        batches.push(batch);
        batch = [];
        cost = 0;
      }
      batch.push(source.fileName);
      // Still request diagnostics for EVERY declaration. With skipLibCheck,
      // TypeScript makes these requests cheap; otherwise they count in the cap.
      if (!(source.isDeclarationFile && config.options.skipLibCheck)) cost += 1;
    }
    if (batch.length) batches.push(batch);
    return { fingerprint, batches, checkTypes, diagnostics: formatted(diagnostics),
      declarations: Boolean(config.options.declaration ?? config.options.composite) };
  }

  if (fingerprint !== request.fingerprint) throw new Error('TypeScript inputs changed during verification');
  const diagnostics = [];
  for (const name of request.files) {
    const source = program.getSourceFile(name);
    if (!source) throw new Error(`TypeScript source disappeared: ${name}`);
    if (request.phase === 'semantic') diagnostics.push(...program.getSemanticDiagnostics(source));
    else if (request.phase === 'declaration') diagnostics.push(...program.getDeclarationDiagnostics(source));
    else throw new Error(`Unknown TypeScript diagnostic phase: ${request.phase}`);
  }
  return { fingerprint, checked: request.files, diagnostics: formatted(diagnostics) };
}

writeFileSync(process.argv[3], JSON.stringify(check()));
