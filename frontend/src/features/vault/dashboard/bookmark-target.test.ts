import { describe, expect, it } from 'vitest';
import { tabBookmarkTarget } from './bookmark-target';

describe('bookmark destinations for document tabs', () => {
  it('keeps dashboards, templates and records as page identities', () => {
    for (const metadata of [{ is_dashboard: true }, { is_template: true }, { table_id: 'table' }]) {
      expect(tabBookmarkTarget({ id: 'note', title: 'Title', metadata })).toEqual({ kind: 'page', target: 'note' });
    }
  });
  it('captures table and view identities without using the synthetic tab id as a page', () => {
    expect(tabBookmarkTarget({ id: 'table:t', title: 'Table', isTable: true }, 'kanban')).toEqual({ kind: 'route', target: '/knowledge/table/t/view/kanban' });
    expect(tabBookmarkTarget({ id: 'table:t', title: 'Table', isTable: true })).toEqual({ kind: 'route', target: '/knowledge/table/t' });
  });
  it('opens drawings with the drawing route', () => {
    expect(tabBookmarkTarget({ id: 'canvas', title: 'Canvas', isDrawing: true })).toEqual({ kind: 'route', target: '/knowledge/drawing/canvas' });
  });
  it.each(['pdf', 'epub', 'snapshot'] as const)('keeps the %s source and reader position', kind => {
    const destination = tabBookmarkTarget({ id: 'document:synthetic', title: 'Book', isPdf: true, kind, src: 'Assets/book.pdf', location: { pageNumber: 8 } });
    expect(destination?.kind).toBe('route');
    const parsed = new URL(destination?.target ?? '', 'https://example.test');
    expect(parsed.pathname).toBe('/knowledge/document');
    expect(parsed.searchParams.get('kind')).toBe(kind);
    expect(parsed.searchParams.get('src')).toBe('Assets/book.pdf');
    expect(parsed.searchParams.get('page')).toBe('8');
  });
  it('does not offer an unusable bookmark when no document source is available', () => {
    expect(tabBookmarkTarget({ id: 'document:missing', title: 'Missing', isPdf: true })).toBeNull();
  });
  it('does not serialize an opaque reader location as a page number', () => {
    const destination = tabBookmarkTarget({ id: 'doc', title: 'Book', isPdf: true, src: 'Assets/book.pdf', location: { pageNumber: { index: 8 } } });
    expect(destination?.target).not.toContain('page=');
  });
});
