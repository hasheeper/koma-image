/** Read-only directory port. No handles, writers, or credentials enter ASK. */
import type { ProjectCharacter, ProjectReference } from '../bridge/project/model.ts';
export interface RefEntry { readonly path: string; readonly bytes: number; readonly modified?: number }
export interface RefIndex {
  readonly available: boolean;
  readonly files: readonly RefEntry[];
  readonly total: number;
  readonly omitted: number;
  /** More files may exist beyond the bounded scan; total is then a lower bound. */
  readonly limited: boolean;
  readonly error?: string;
  readonly project?: { readonly title: string; readonly description: string };
  readonly characters?: readonly Omit<ProjectCharacter, 'tagContent'>[];
  readonly lore?: readonly ProjectReference[];
  readonly references?: readonly ProjectReference[];
  readonly groups?: Readonly<Record<string, { total: number; omitted: number; path: string }>>;
}
export interface RefOrigin { readonly path: string; readonly version: string; readonly modified: number; readonly projectId?: string }
export interface RefFile { readonly file: File; readonly origin: RefOrigin }
export interface RefSnapshot {
  readonly index: RefIndex;
  resolve(path: string): string;
  kind(path: string): "text" | "image";
  list?(path: string, offset: number): { type: 'directory'; path: string; items: readonly unknown[]; total: number; offset: number; next_offset: number | null; limited: boolean };
  read(path: string, signal: AbortSignal, maxBytes: number): Promise<RefFile>;
}
export interface RefSource { index(): RefIndex; snapshot(): RefSnapshot | null }
export const emptyRefs = (): RefIndex => ({ available: false, files: [], total: 0, omitted: 0, limited: false });
