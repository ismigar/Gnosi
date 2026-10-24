import { useEffect, useMemo, useState } from 'react';
import { previewSiteFont, type SiteFont } from '../../shared/api/sites';
import type { RequestContext } from '../../shared/api/request-context';

export function useWebsiteFontSamples(siteId: string, fonts: readonly SiteFont[], context: RequestContext) {
  const choices = useMemo(() => {
    const families = new Map<string, SiteFont>();
    const priority = (font: SiteFont) => (font.style === 'normal' ? 2 : 0) + (font.weight === '400' ? 1 : 0);
    for (const font of fonts) {
      const previous = families.get(font.family);
      if (font.family && font.src && (!previous || priority(font) >= priority(previous))) families.set(font.family, font);
    }
    return [...families.values()];
  }, [fonts]);
  const key = JSON.stringify([siteId, [context.userId, context.userEmail, context.workspaceId, context.vaultId], choices]);
  const [loaded, setLoaded] = useState<{ key: string; aliases: Record<string, string>; failed: boolean }>({ key: '', aliases: {}, failed: false });
  const supported = typeof FontFace !== 'undefined' && typeof document.fonts.add === 'function';
  useEffect(() => {
    if (!supported || !choices.length) return undefined;
    let active = true;
    const abort = new AbortController();
    const faces: FontFace[] = [];
    const isCurrent = () => active && !abort.signal.aborted;
    const timer = setTimeout(() => { abort.abort(); }, 20_000);
    const load = async () => {
      const aliases = new Map<string, string>();
      let failed = false;
      try {
        for (const [index, font] of choices.entries()) {
          try {
            const blob = await previewSiteFont(siteId, font.src, context, abort.signal);
            if (!isCurrent()) break;
            const alias = `GnosiWebFont-${siteId}-${String(index)}`;
            const face = await new FontFace(alias, await blob.arrayBuffer(), { style: font.style, weight: font.weight }).load();
            if (!isCurrent()) break;
            document.fonts.add(face); faces.push(face);
            aliases.set(font.family, `"${alias}"`);
          } catch { if (active) failed = true; }
        }
      } finally {
        clearTimeout(timer);
        if (active) setLoaded({ key, aliases: Object.fromEntries(aliases), failed: failed || abort.signal.aborted });
      }
    };
    void load();
    return () => { active = false; clearTimeout(timer); abort.abort(); faces.forEach(face => { document.fonts.delete(face); }); };
  }, [choices, context, key, siteId, supported]);
  return { aliases: loaded.key === key ? loaded.aliases : {}, failed: Boolean(choices.length && (!supported || (loaded.key === key && loaded.failed))) };
}
