import catalog from '../../../../desktop/help-links.json';
import { vaultAppFromPath } from '../routing/vaultRouting';

export function helpLocale(language?: string): string {
    const base = language?.trim().toLowerCase().replaceAll('_', '-').split('-')[0] ?? 'en';
    return catalog.locales.includes(base) ? base : 'en';
}

export function helpUrl(language?: string, topic = '', engineering = false): string {
    const locale = helpLocale(language);
    const suffix = locale === 'en' ? '' : `${locale}/`;
    const article = !engineering && catalog.topics.includes(topic) ? `${topic}/` : '';
    return `${catalog.origin}${engineering ? catalog.engineeringPath : catalog.learnPath}${suffix}${article}`;
}

export function contextualHelpTopic(pathname: string): string {
    const resource = pathname.match(/^\/(?:@[^/]+\/knowledge|vault)\/([^/?#]+)/)?.[1] ?? '';
    const knowledge: Readonly<Record<string, string>> = catalog.knowledgeSections;
    if (knowledge[resource]) return knowledge[resource];
    const section = vaultAppFromPath(pathname) || pathname.split('/')[1] || '';
    const sections: Readonly<Record<string, string>> = catalog.sections;
    return sections[section] ?? '';
}
