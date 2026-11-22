import type { Rect } from './project.ts';

export type GuideChannel = 'alpha' | 'occluded';
export type MaskAction = 'draw' | 'erase' | 'import';

interface GuideEdit extends Rect {
  channel: GuideChannel;
  action: MaskAction;
  xor: Uint8Array;
  guideXor?: Uint8Array;
}

export interface GuideHistory {
  edits: GuideEdit[];
  position: number;
}

export interface GuideState {
  width: number;
  height: number;
  alpha: Uint8Array;
  occluded?: Uint8Array;
  guides?: Uint8Array;
  history?: GuideHistory;
}

export function recordGuide(
  state: GuideState,
  channel: GuideChannel,
  next: Uint8Array,
  action: MaskAction,
  dirty?: Rect,
  guides = channel === 'alpha' && action === 'import' ? undefined : state.guides,
): GuideState {
  const old = state[channel] ?? new Uint8Array(state.alpha.length);
  const { width, height } = state;
  if (next.length !== old.length) throw new Error('选区与画布尺寸不一致');
  const area = dirty ?? { x: 0, y: 0, width, height };
  let left = area.x + area.width,
    right = -1,
    top = area.y + area.height,
    bottom = -1;
  for (let y = area.y; y < area.y + area.height; y++)
    for (let x = area.x; x < area.x + area.width; x++) {
      const i = y * width + x;
      if (old[i] === next[i] && (guides?.[i] ?? 0) === (state.guides?.[i] ?? 0)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  if (right < 0) return state;
  const w = right - left + 1,
    h = bottom - top + 1,
    xor = new Uint8Array(w * h),
    guideXor = guides !== state.guides ? new Uint8Array(w * h) : undefined;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (top + y) * width + left + x;
      xor[y * w + x] = old[i] ^ next[i];
      if (guideXor) guideXor[y * w + x] = (guides?.[i] ?? 0) ^ (state.guides?.[i] ?? 0);
    }
  const prev = state.history;
  const edits = prev ? prev.edits.slice(0, prev.position) : [];
  edits.push({ channel, action, x: left, y: top, width: w, height: h, xor, guideXor });
  const retained = edits.slice(-40);
  return {
    ...state,
    [channel]: next,
    guides,
    history: { edits: retained, position: retained.length },
  };
}

export function travelGuide(state: GuideState, direction: 'undo' | 'redo'): GuideState {
  const history = state.history;
  if (!history) return state;
  const undo = direction === 'undo';
  const index = history.position - (undo ? 1 : 0);
  const edit = history.edits[index];
  if (!edit) return state;
  const channel = state[edit.channel]?.slice() ?? new Uint8Array(state.alpha.length);
  const guides = edit.guideXor ? (state.guides?.slice() ?? new Uint8Array(channel.length)) : state.guides;
  for (let y = 0; y < edit.height; y++)
    for (let x = 0; x < edit.width; x++) {
      const i = (edit.y + y) * state.width + edit.x + x;
      channel[i] ^= edit.xor[y * edit.width + x];
      if (edit.guideXor && guides) guides[i] ^= edit.guideXor[y * edit.width + x];
    }
  return {
    ...state,
    [edit.channel]: channel,
    guides,
    history: { edits: history.edits, position: history.position + (undo ? -1 : 1) },
  };
}
