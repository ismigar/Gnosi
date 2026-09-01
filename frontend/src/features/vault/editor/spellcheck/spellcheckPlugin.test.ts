import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import type { Speller } from './nspellManager';
import {
  createSpellcheckPlugin,
  spellErrorAt,
} from './spellcheckPlugin';


const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: {},
  },
});


const speller: Speller = {
  add() {},
  correct: (word) => word !== 'wrng',
  suggest: () => [],
};


function editorState(ignored: ReadonlySet<string> = new Set()): EditorState {
  const document = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text("Hello wrng PDF l'home")]),
  ]);
  return EditorState.create({
    doc: document,
    plugins: [createSpellcheckPlugin(() => ({
      enabled: true,
      ignored,
      speller,
    }))],
  });
}


describe('spellcheck ProseMirror plugin', () => {
  it('decorates a misspelling and exposes its exact range and word', () => {
    expect(spellErrorAt(editorState(), 8)).toEqual({
      from: 7,
      to: 11,
      word: 'wrng',
    });
  });

  it('honors the ignored-word set', () => {
    expect(spellErrorAt(editorState(new Set(['wrng'])), 8)).toBeNull();
  });
});
