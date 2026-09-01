export const GRAPH_KEYBOARD_ACTIONS = Object.freeze({
  ZOOM_IN: 'zoom-in',
  ZOOM_OUT: 'zoom-out',
  CENTER: 'center',
  PAN_LEFT: 'pan-left',
  PAN_RIGHT: 'pan-right',
  PAN_UP: 'pan-up',
  PAN_DOWN: 'pan-down',
} as const);

type GraphKeyboardAction =
  (typeof GRAPH_KEYBOARD_ACTIONS)[keyof typeof GRAPH_KEYBOARD_ACTIONS];

interface EditableTargetLike {
  closest?: (selector: string) => unknown;
  isContentEditable?: unknown;
  tagName?: unknown;
}

interface GraphKeyboardEventLike {
  altKey?: boolean;
  code?: string;
  ctrlKey?: boolean;
  defaultPrevented?: boolean;
  key?: string;
  metaKey?: boolean;
  target?: unknown;
}

interface CameraStateLike {
  ratio?: unknown;
  x?: unknown;
  y?: unknown;
}

interface PannedCameraState {
  x: number;
  y: number;
}

const EDITABLE_TAGS = new Set(['input', 'textarea', 'select']);
const PAN_FRACTION = 0.1;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEditableTarget(target: unknown): boolean {
  if (
    target === null ||
    (typeof target !== 'object' && typeof target !== 'function')
  ) {
    return false;
  }
  const candidate = target as EditableTargetLike;

  const tagName =
    typeof candidate.tagName === 'string'
      ? candidate.tagName.toLowerCase()
      : '';
  if (EDITABLE_TAGS.has(tagName) || candidate.isContentEditable) return true;

  return (
    typeof candidate.closest === 'function' &&
    Boolean(candidate.closest('[contenteditable="true"], [role="textbox"]'))
  );
}

export function getGraphKeyboardAction(
  event: GraphKeyboardEventLike | null | undefined,
): GraphKeyboardAction | null {
  if (
    !event ||
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isEditableTarget(event.target)
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

  const arrowActions: Readonly<Record<string, GraphKeyboardAction>> = {
    ArrowLeft: GRAPH_KEYBOARD_ACTIONS.PAN_LEFT,
    ArrowRight: GRAPH_KEYBOARD_ACTIONS.PAN_RIGHT,
    ArrowUp: GRAPH_KEYBOARD_ACTIONS.PAN_UP,
    ArrowDown: GRAPH_KEYBOARD_ACTIONS.PAN_DOWN,
  };
  return event.key ? (arrowActions[event.key] ?? null) : null;
}

export function getPannedCameraState(
  state: CameraStateLike | null | undefined,
  action: string | null | undefined,
): PannedCameraState | null {
  const directions: Readonly<Record<string, readonly [number, number]>> = {
    [GRAPH_KEYBOARD_ACTIONS.PAN_LEFT]: [-1, 0],
    [GRAPH_KEYBOARD_ACTIONS.PAN_RIGHT]: [1, 0],
    [GRAPH_KEYBOARD_ACTIONS.PAN_UP]: [0, -1],
    [GRAPH_KEYBOARD_ACTIONS.PAN_DOWN]: [0, 1],
  };
  const direction = action ? directions[action] : undefined;
  if (!direction) return null;

  const x = isFiniteNumber(state?.x) ? state.x : 0.5;
  const y = isFiniteNumber(state?.y) ? state.y : 0.5;
  const ratio =
    isFiniteNumber(state?.ratio) && state.ratio > 0 ? state.ratio : 1;
  const step = ratio * PAN_FRACTION;

  return {
    x: x + direction[0] * step,
    y: y + direction[1] * step,
  };
}
