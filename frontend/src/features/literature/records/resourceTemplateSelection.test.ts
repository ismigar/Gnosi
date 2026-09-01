import { describe, expect, it } from 'vitest';

import {
  resolveResourceDocumentType,
  selectResourceTemplate,
} from './resourceTemplateSelection';

describe('resource template selection', () => {
  const templates = [
    { id: 'default', metadata: { is_default_template: true } },
    { id: 'book', metadata: { 'Item Type': 'Llibre' } },
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
});
