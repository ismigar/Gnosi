/** Public history lives on the project's GitHub Pages site. */
export function releaseNotesUrl(language: string | undefined, version: string): string {
    const locale = language?.toLowerCase().split(/[-_]/)[0];
    const suffix = locale === 'ca' || locale === 'es' ? `.${locale}` : '';
    return `https://ismigar.github.io/changelog${suffix}.html#v${encodeURIComponent(version)}`;
}
