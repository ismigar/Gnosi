import { describe, expect, it } from 'vitest';
import { buildPluginSrcdoc } from './document';

describe('opaque plugin document', () => {
  it('keeps the network-blocking CSP and module entry without introducing script elements', () => {
    const code = "const message = '</ScRiPt><script>not another script</script>';";
    const document = new DOMParser().parseFromString(buildPluginSrcdoc(code), 'text/html');
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'))
      .toBe("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:");
    const scripts = document.querySelectorAll('script');
    expect(scripts).toHaveLength(2);
    expect(scripts[1]?.type).toBe('module');
    expect(scripts[1]?.textContent).toBe("const message = '<\\/ScRiPt><script>not another script<\\/script>';" );
  });

  it('preserves empty input fallback and native legacy code coercion', () => {
    for (const code of [null, undefined, 0, false, '']) {
      const document = new DOMParser().parseFromString(buildPluginSrcdoc(code), 'text/html');
      expect(document.querySelector('script[type="module"]')?.textContent).toBe('');
    }
    const document = new DOMParser().parseFromString(buildPluginSrcdoc({ toString: () => '/* legacy */' }), 'text/html');
    expect(document.querySelector('script[type="module"]')?.textContent).toBe('/* legacy */');
  });
});
