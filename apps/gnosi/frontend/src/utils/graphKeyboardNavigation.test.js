import { describe, expect, it } from 'vitest';

import {
  GRAPH_KEYBOARD_ACTIONS,
  getGraphKeyboardAction,
  getPannedCameraState,
} from './graphKeyboardNavigation';

describe('graph keyboard navigation', () => {
  it.each([
    [{ key: '+' }, GRAPH_KEYBOARD_ACTIONS.ZOOM_IN],
    [{ key: '-', code: 'Minus' }, GRAPH_KEYBOARD_ACTIONS.ZOOM_OUT],
    [{ key: '0' }, GRAPH_KEYBOARD_ACTIONS.CENTER],
    [{ key: 'ArrowLeft' }, GRAPH_KEYBOARD_ACTIONS.PAN_LEFT],
    [{ key: 'ArrowRight' }, GRAPH_KEYBOARD_ACTIONS.PAN_RIGHT],
    [{ key: 'ArrowUp' }, GRAPH_KEYBOARD_ACTIONS.PAN_UP],
    [{ key: 'ArrowDown' }, GRAPH_KEYBOARD_ACTIONS.PAN_DOWN],
    [{ key: 'Add', code: 'NumpadAdd' }, GRAPH_KEYBOARD_ACTIONS.ZOOM_IN],
    [{ key: 'Subtract', code: 'NumpadSubtract' }, GRAPH_KEYBOARD_ACTIONS.ZOOM_OUT],
    [{ key: 'Insert', code: 'Numpad0' }, GRAPH_KEYBOARD_ACTIONS.CENTER],
  ])('maps %o to %s', (event, expected) => {
    expect(getGraphKeyboardAction(event)).toBe(expected);
  });

  it('does not intercept editable targets or modified shortcuts', () => {
    expect(getGraphKeyboardAction({
      key: 'ArrowLeft',
      target: { tagName: 'INPUT' },
    })).toBeNull();
    expect(getGraphKeyboardAction({
      key: '+',
      target: {
        tagName: 'DIV',
        closest: () => ({ contentEditable: true }),
      },
    })).toBeNull();
    expect(getGraphKeyboardAction({ key: '-', ctrlKey: true })).toBeNull();
    expect(getGraphKeyboardAction({ key: '0', metaKey: true })).toBeNull();
  });

  it('moves by a fixed fraction of the current viewport ratio', () => {
    expect(getPannedCameraState(
      { x: 0.5, y: 0.4, ratio: 2 },
      GRAPH_KEYBOARD_ACTIONS.PAN_RIGHT,
    )).toEqual({ x: 0.7, y: 0.4 });
    expect(getPannedCameraState(
      { x: 0.5, y: 0.4, ratio: 2 },
      GRAPH_KEYBOARD_ACTIONS.PAN_UP,
    )).toEqual({ x: 0.5, y: 0.2 });
  });

  it('ignores non-pan actions when calculating movement', () => {
    expect(getPannedCameraState(
      { x: 0.5, y: 0.5, ratio: 1 },
      GRAPH_KEYBOARD_ACTIONS.ZOOM_IN,
    )).toBeNull();
  });
});
