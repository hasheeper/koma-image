/** Read-only directory port. No handles, writers, or credentials enter ASK. */
export interface RefEntry { readonly path: string; readonly bytes: number }
export interface RefIndex {
  readonly available: boolean;
  readonly files: readonly RefEntry[];
  readonly total: number;
  readonly omitted: number;
  /** More files may exist beyond the bounded scan; total is then a lower bound. */
  readonly limited: boolean;
  readonly error?: string;
}
export interface RefOrigin { readonly path: string; readonly version: string; readonly modified: number }
export interface RefFile { readonly file: File; readonly origin: RefOrigin }
export interface RefSnapshot {
  readonly index: RefIndex;
  resolve(path: string): string;
  kind(path: string): "text" | "image";
  read(path: string, signal: AbortSignal, maxBytes: number): Promise<RefFile>;
}
export interface RefSource { index(): RefIndex; snapshot(): RefSnapshot | null }
export const emptyRefs = (): RefIndex => ({ available: false, files: [], total: 0, omitted: 0, limited: false });
