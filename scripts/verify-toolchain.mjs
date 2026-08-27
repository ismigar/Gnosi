import { execFileSync } from 'node:child_process';

const requiredNode = '22.22.2';
const requiredPnpm = '11.19.0';
const userAgent = process.env.npm_config_user_agent ?? '';

if (process.versions.node !== requiredNode) {
  process.stderr.write(
    `Gnosi requires Node ${requiredNode}; found ${process.versions.node}.\n`,
  );
  process.exit(1);
}

let activePnpm = '';
try {
  activePnpm = userAgent
    ? userAgent.match(/^pnpm\/([^ ]+)/)?.[1] ?? ''
    : execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim();
} catch {
  // The actionable error below also covers pnpm not being available.
}

if (activePnpm !== requiredPnpm) {
  process.stderr.write(
    `Gnosi requires pnpm ${requiredPnpm}; found ${activePnpm || 'none'}. ` +
      `Run corepack use pnpm@${requiredPnpm}.\n`,
  );
  process.exit(1);
}
