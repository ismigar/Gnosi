export const GRAPH_KEYBOARD_ACTIONS = Object.freeze({
  ZOOM_IN: 'zoom-in',
  ZOOM_OUT: 'zoom-out',
  CENTER: 'center',
  PAN_LEFT: 'pan-left',
  PAN_RIGHT: 'pan-right',
  PAN_UP: 'pan-up',
  PAN_DOWN: 'pan-down',
});

const EDITABLE_TAGS = new Set(['input', 'textarea', 'select']);
const PAN_FRACTION = 0.1;

function isEditableTarget(target) {
  if (!target) return false;

  const tagName = typeof target.tagName === 'string'
    ? target.tagName.toLowerCase()
    : '';
  if (EDITABLE_TAGS.has(tagName) || target.isContentEditable) return true;

  return typeof target.closest === 'function'
    && Boolean(target.closest('[contenteditable="true"], [role="textbox"]'));
}

export function getGraphKeyboardAction(event) {
  if (
    !event
    || event.defaultPrevented
    || event.metaKey
    || event.ctrlKey
    || event.altKey
    || isEditableTarget(event.target)
  ) {
    return null;
  }

  if (event.key === '+' || event.code === 'NumpadAdd') {
    return GRAPH_KEYBOARD_ACTIONS.ZOOM_IN;
  }
  if (event.key === '-' || event.code === 'NumpadSubtract') {
    return GRAPH_KEYBOARD_ACTIONS.ZOOM_OUT;
  }
  if (event.key === '0' || event.code === 'Numpad0') {
    return GRAPH_KEYBOARD_ACTIONS.CENTER;
  }

  const arrowActions = {
    ArrowLeft: GRAPH_KEYBOARD_ACTIONS.PAN_LEFT,
    ArrowRight: GRAPH_KEYBOARD_ACTIONS.PAN_RIGHT,
    ArrowUp: GRAPH_KEYBOARD_ACTIONS.PAN_UP,
    ArrowDown: GRAPH_KEYBOARD_ACTIONS.PAN_DOWN,
  };
  return arrowActions[event.key] || null;
}

export function getPannedCameraState(state, action) {
  const directions = {
    [GRAPH_KEYBOARD_ACTIONS.PAN_LEFT]: [-1, 0],
    [GRAPH_KEYBOARD_ACTIONS.PAN_RIGHT]: [1, 0],
    [GRAPH_KEYBOARD_ACTIONS.PAN_UP]: [0, -1],
    [GRAPH_KEYBOARD_ACTIONS.PAN_DOWN]: [0, 1],
  };
  const direction = directions[action];
  if (!direction) return null;

  const x = Number.isFinite(state?.x) ? state.x : 0.5;
  const y = Number.isFinite(state?.y) ? state.y : 0.5;
  const ratio = Number.isFinite(state?.ratio) && state.ratio > 0
    ? state.ratio
    : 1;
  const step = ratio * PAN_FRACTION;

  return {
    x: x + direction[0] * step,
    y: y + direction[1] * step,
  };
}
