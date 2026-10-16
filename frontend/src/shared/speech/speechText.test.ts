import { describe, expect, it } from 'vitest';
import { speechChunks, speechText } from './speechText';

describe('spoken prose', () => {
  it('reads labels and prose without Markdown syntax, URL destinations or fenced code', () => {
    expect(speechText('# Hola\n**Prova** [Gnosi](https://example.test/private)\n```js\nsecret();\n```\nFinal.'))
      .toBe('Hola\nProva Gnosi\nFinal.');
  });
  it('retains accents and punctuation in all supported languages', () => {
    expect(speechText('És una notícia. ¿Cómo estás? Français: très bien!')).toBe('És una notícia. ¿Cómo estás? Français: très bien!');
  });
  it('bounds long prose at a sentence while retaining readable chunk boundaries', () => {
    const text = speechText('A complete sentence. '.repeat(1000));
    expect(text.length).toBeLessThanOrEqual(12000);
    expect(text.endsWith('.')).toBe(true);
    const chunks = speechChunks(text);
    expect(chunks.every(chunk => chunk.length > 0 && chunk.length <= 2800)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });
  it('bounds a single long token without an infinite loop', () => {
    const chunks = speechChunks('x'.repeat(6000));
    expect(chunks.map(chunk => chunk.length)).toEqual([2800, 2800, 400]);
  });
});
