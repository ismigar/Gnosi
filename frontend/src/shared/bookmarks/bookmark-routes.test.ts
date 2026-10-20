import { afterEach, describe, expect, it } from 'vitest';
import { resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { bookmarkGraphHref, bookmarkRouteHref, currentBookmarkRoute, isBookmarkPageId, isBookmarkRoute, pageIdFromBookmarkRoute } from './bookmark-routes';

afterEach(() => { resetApiTestStorage(); window.history.replaceState({}, '', '/'); });

describe('portable Gnosi destinations', () => {
  it('recognizes whole-page identities while retaining query/hash-specific view destinations', () => {
    expect(pageIdFromBookmarkRoute('/knowledge/page/note')).toBe('note');
    expect(pageIdFromBookmarkRoute('/knowledge/dashboard/dashboard/')).toBe('dashboard');
    expect(pageIdFromBookmarkRoute('/knowledge/page/note?mode=source')).toBeNull();
    expect(pageIdFromBookmarkRoute('/knowledge/page/note#section')).toBeNull();
    expect(pageIdFromBookmarkRoute('/knowledge/page/Resum%20d%27%C3%A8tica%20%232%20%5BUNED%5D.md')).toBe("Resum d'ètica #2 [UNED].md");
    expect(pageIdFromBookmarkRoute('/knowledge/page/%2Foutside')).toBeNull();
    expect(isBookmarkPageId("Resum d'ètica #2 [UNED].md")).toBe(true);
    expect(isBookmarkPageId('../outside')).toBe(false);
  });
  it.each(['/knowledge/table/t/view/v', '/knowledge/drawing/d', '/knowledge/tags', '/knowledge/trash',
    '/knowledge/document?src=Assets%2Fbook.pdf&kind=pdf&page=8', '/notebooks/n', '/calendar',
    '/planning', '/resources', '/contacts?id=one', '/reader?article=12', '/mail',
    '/automations', '/social/compose', '/media', '/graph?focus=p#node'])('accepts the stable destination %s', target => {
    expect(isBookmarkRoute(target)).toBe(true);
  });
  it.each(['https://example.test/knowledge', '//evil.test/knowledge', '/@other/knowledge',
    '/api/vault/pages', '/settings', '/knowledge/../mail', '/knowledge/%2e%2e/mail',
    '/knowledge/%252e%252e/mail', '/knowledge/\\evil', '/knowledge/%255cevil',
    '/knowledge/%00bad', '/knowledge%2ftable/id'])('rejects unsafe or non-vault destination %s', target => {
    expect(isBookmarkRoute(target)).toBe(false);
    expect(bookmarkRouteHref(target)).toBe('#');
  });
  it('rebases the same destination to each device vault slug without changing the view or location', () => {
    writeApiTestStorage('gnosi_active_vault_slug', 'first-device');
    expect(bookmarkRouteHref('/knowledge/table/t/view/v?filter=x#row')).toBe('/@first-device/knowledge/table/t/view/v?filter=x#row');
    writeApiTestStorage('gnosi_active_vault_slug', 'second-device');
    expect(bookmarkRouteHref('/knowledge/table/t/view/v?filter=x#row')).toBe('/@second-device/knowledge/table/t/view/v?filter=x#row');
    expect(bookmarkRouteHref('/reader?article=12')).toBe('/@second-device/reader?article=12');
    expect(bookmarkGraphHref('/@old-device/graph?focus=p')).toBe('/@second-device/graph?focus=p');
  });
  it('captures the current view only inside the selected vault', () => {
    writeApiTestStorage('gnosi_active_vault_slug', 'research');
    window.history.replaceState({}, '', '/@research/notebooks/notebook?tab=sources#one');
    expect(currentBookmarkRoute()).toBe('/notebooks/notebook?tab=sources#one');
    window.history.replaceState({}, '', '/@other/notebooks/notebook');
    expect(currentBookmarkRoute()).toBeNull();
  });
});
