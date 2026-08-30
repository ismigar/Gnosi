import { installSandboxRuntime } from './runtime';
import { stringValue } from '../host-model';

export function sandboxRuntimeSource(): string {
  return `(${installSandboxRuntime.toString()})(window);`;
}

export function buildPluginSrcdoc(pluginCode: unknown): string {
  // Direct networking is blocked even with a network grant; only host RPC is allowed.
  const csp = [
    "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
    "connect-src 'none'", "img-src data:",
  ].join('; ');
  const safeRuntime = sandboxRuntimeSource().replace(/<\/(script)/gi, '<\\/$1');
  const safeCode = stringValue(pluginCode).replace(/<\/(script)/gi, '<\\/$1');
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + '</head><body>'
    + `<script>${safeRuntime}</script>`
    + `<script type="module">${safeCode}</script>`
    + '</body></html>';
}
