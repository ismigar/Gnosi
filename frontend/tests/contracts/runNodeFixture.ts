import { execFile } from 'node:child_process';

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

// Keep the worker's event loop available for Vitest's progress messages.
export function runNodeFixture(cwd: string, args: string[], env: NodeJS.ProcessEnv, timeout: number): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { cwd, env, timeout, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error && (error.killed || typeof error.code !== 'number')) {
        reject(new Error(error.message, { cause: error }));
        return;
      }
      resolve({ status: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
}
