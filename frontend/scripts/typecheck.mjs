import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const worker = fileURLToPath(new URL('./typecheck-worker.mjs', import.meta.url));

function typecheck() {
  if (process.argv.length !== 2) throw new Error('This command checks the complete frontend tsconfig.json; use tsc directly for other compiler arguments');
  const temporary = mkdtempSync(join(tmpdir(), 'gnosi-typecheck-'));
  const diagnostics = new Set();
  try {
    const requestPath = join(temporary, 'request.json');
    const resultPath = join(temporary, 'result.json');
    function run(request) {
      writeFileSync(requestPath, JSON.stringify(request));
      rmSync(resultPath, { force: true });
      const child = spawnSync(process.execPath, [worker, requestPath, resultPath], { cwd, stdio: 'inherit' });
      if (child.error || child.signal || child.status !== 0) {
        throw new Error(`TypeScript worker failed: ${child.error?.message ?? child.signal ?? child.status}`);
      }
      const result = JSON.parse(readFileSync(resultPath, 'utf8'));
      if (!Array.isArray(result.diagnostics) || result.diagnostics.some(item => typeof item !== 'string')) {
        throw new Error('TypeScript worker did not return diagnostics');
      }
      if (request.phase !== 'discover' && (result.fingerprint !== request.fingerprint
          || JSON.stringify(result.checked) !== JSON.stringify(request.files))) {
        throw new Error('TypeScript inputs changed or a worker returned incomplete coverage');
      }
      for (const diagnostic of result.diagnostics) diagnostics.add(diagnostic);
      return result;
    }

    const project = run({ phase: 'discover' });
    if (!project.checkTypes) return 1;
    if (!/^[a-f0-9]{64}$/.test(project.fingerprint) || !Array.isArray(project.batches)
        || project.batches.length === 0 || project.batches.some(batch => !Array.isArray(batch)
          || batch.length === 0 || batch.some(file => typeof file !== 'string'))) {
      throw new Error('TypeScript discovery did not return a complete project manifest');
    }
    const files = project.batches.flat();
    if (new Set(files).size !== files.length) throw new Error('Duplicate TypeScript coverage');
    let semanticErrors = false;
    // Each worker loads the SAME complete program. Only diagnostic requests are
    // partitioned; globals, imports and cross-file relationships remain intact.
    for (const phase of ['semantic', ...(project.declarations ? ['declaration'] : [])]) {
      if (phase === 'declaration' && semanticErrors) break;
      for (const [index, batch] of project.batches.entries()) {
        console.log(`TypeScript ${phase} batch ${index + 1}/${project.batches.length} (${batch.length} files)`);
        const result = run({ phase, files: batch, fingerprint: project.fingerprint });
        if (phase === 'semantic' && result.diagnostics.length) semanticErrors = true;
      }
    }
    return diagnostics.size ? 1 : 0;
  } finally {
    for (const diagnostic of [...diagnostics].sort()) process.stdout.write(diagnostic);
    rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  process.exitCode = typecheck();
} catch (error) {
  console.error(`TypeScript verification incomplete: ${error.message}`);
  process.exitCode = 1;
}
