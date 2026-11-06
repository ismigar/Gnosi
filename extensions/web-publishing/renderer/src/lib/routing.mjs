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
