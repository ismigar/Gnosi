// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const lint = new ESLint({ cwd: fileURLToPath(new URL('../..', import.meta.url)) });
const rule = 'gnosi/modal-layers';
async function messages(code: string) {
  const result = await lint.lintText(code, { filePath: 'src/features/alpha/Modal.jsx' });
  expect(result.flatMap(item => item.messages).filter(item => item.fatal)).toEqual([]);
  return result.flatMap(item => item.messages).filter(item => item.ruleId === rule);
}

describe('modal placement enforced by the actual frontend lint configuration', () => {
  it.each([
    'const View = () => <div role="dialog" aria-modal="true" />;',
    'import { createPortal } from "react-dom"; const View = () => createPortal(<div role="dialog" aria-modal={true} />, document.body);',
    'import { PanePortal } from "../../shared/ui/PanePortal"; const View = () => <PanePortal container={document.body}><div role="dialog" aria-modal="true" /></PanePortal>;',
    'const ModalPortal = ({children}) => children; const View = () => <ModalPortal><div role="dialog" aria-modal="true" /></ModalPortal>;',
    'import { ModalPortal } from "./ModalPortal"; const View = () => <ModalPortal><div role="dialog" aria-modal="true" /></ModalPortal>;',
  ])('rejects an unowned blocking layer: %s', async code => {
    expect(await messages(code)).toEqual([expect.objectContaining({ messageId: 'layer' })]);
  });

  it('accepts the shared layer, including an imported alias', async () => {
    expect(await messages('import { ModalPortal as Layer } from "../../shared/ui/ModalPortal"; const View = () => <Layer><div role="dialog" aria-modal={true} /></Layer>;')).toEqual([]);
  });

  it('rejects escaping the shared layer through an inner generic portal', async () => {
    expect(await messages('import { ModalPortal } from "../../shared/ui/ModalPortal"; import { PanePortal } from "../../shared/ui/PanePortal"; const View = () => <ModalPortal><PanePortal container={document.body}><div role="dialog" aria-modal="true" /></PanePortal></ModalPortal>;'))
      .toEqual([expect.objectContaining({ messageId: 'layer' })]);
  });

  it('keeps explicitly nonblocking popovers outside the modal contract', async () => {
    expect(await messages('const View = () => <aside role="dialog" aria-modal={false} />;')).toEqual([]);
    expect(await messages('const View = () => <aside role="dialog" />;')).toEqual([expect.objectContaining({ messageId: 'modality' })]);
  });
});
