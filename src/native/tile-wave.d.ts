export function tileWave(
  frame: HTMLElement,
  options?: { cell?: number; fade?: boolean },
): {
  resize(): void;
  draw(now: number): void;
  reveal(source: CanvasImageSource): Promise<boolean>;
  reset(): void;
  destroy(): void;
};
