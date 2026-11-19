export function landingPath(pages, language) {
  const available=pages.filter(page=>page.language===language && !['search','map'].includes(page.template));
  const original=available.filter(page=>page.translation_id!=='generated:home');
  return original.find(page=>page.template==='home')?.path
    || original.find(page=>page.path===`/${language}`)?.path
    || original.find(page=>page.path==='/')?.path
    || original[0]?.path || available[0]?.path || `/${language}`;
}

export function importedLocalLink(pages, url) {
  return !url.search && pages.some(page=>page.path===url.pathname);
}

export function isTagPage(page) {
  return page.template === 'listing' && /^(?:imported:)?tag:/.test(page.translation_id || '');
}

export function tagPagePath(pages, tag, language) {
  return pages.find(page => page.language === language
    && ((isTagPage(page) && page.path === tag.path) || page.id === `tag-${tag.tid}-${language}`))?.path;
}

export function tagFeedAlias(page) {
  const published = page.path.match(/^\/[^/]+(\/taxonomy\/term\/[0-9]+)$/);
  if (published) return published[1] + '/feed';
  const former = page.translation_id?.match(/^imported:tag:([0-9]+)$/);
  return former ? '/taxonomy/term/' + former[1] + '/feed' : null;
}
