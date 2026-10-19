export interface MaskState {
  width: number;
  height: number;
  strokes: unknown[];
  position: number;
}
export function createMaskEditor(
  canvas: HTMLCanvasElement,
  onChange: () => void,
): {
  pause(): void;
  resume(): void;
  dispose(): void;
  snapshot(): MaskState;
  restore(state: MaskState): void;
  resize(width: number, height: number): void;
  setBrush(size: number, erase: boolean): void;
  setLocked(value: boolean): void;
  undo(): void;
  redo(): void;
  clear(): void;
  cancel(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  isDrawing(): boolean;
  getMask(): string | null;
};
export type MaskEditor = ReturnType<typeof createMaskEditor>;
