import { describe, expect, it } from 'vitest';

import {
  resolveResourceDocumentType,
  selectResourceTemplate,
} from './resourceTemplateSelection';

describe('resource template selection', () => {
  const templates = [
    { id: 'default', metadata: { is_default_template: true } },
    { id: 'book', metadata: { 'Item Type': 'Llibre' } },
    { id: 'report', metadata: { 'Item Type': 'Informe' } },
    {
      id: 'article',
      metadata: { 'Item Type': 'Article de revista acadèmica' },
    },
  ];

  it('normalizes canonical and localized resource document types', () => {
    expect(resolveResourceDocumentType('book')).toBe('book');
    expect(resolveResourceDocumentType('Llibre')).toBe('book');
    expect(resolveResourceDocumentType('Article científic')).toBe(
      'journalArticle',
    );
  });

  it('prefers the template matching the detected document type', () => {
    expect(
      selectResourceTemplate(templates, {
        'Item Type': 'journalArticle',
      })?.id,
    ).toBe('article');
  });

  it('falls back to the default template for an unknown document type', () => {
    expect(
      selectResourceTemplate(templates, {
        'Item Type': 'Custom record',
      })?.id,
    ).toBe('default');
  });

  it.each(['book', 'Llibre', 'Libro', 'Livre', ' book '])('selects a book template for %s', type => {
    expect(selectResourceTemplate(templates, { 'Item Type': type })?.id).toBe('book');
  });

  it.each(['report', 'Informe', 'Rapport'])('selects a report template for %s', type => {
    expect(selectResourceTemplate(templates, { itemType: type })?.id).toBe('report');
  });
});
