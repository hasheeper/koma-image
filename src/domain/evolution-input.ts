import type { Character } from './characters.ts';
import { readCharacters } from './characters.ts';
import { object } from './value.ts';
import type { MaskBitmap } from '../native/edit-input.ts';
import { summarizeMaskBitmap } from './mask-summary.ts';

export type EvolutionWorkspace = 'image' | 'edit' | 'chat';
export const evolutionTarget = (workspace: EvolutionWorkspace, id: string) => workspace === 'image' ? id : `${workspace}:${id}`;
export const evolutionWorkspace = (target: string | null): EvolutionWorkspace => target?.startsWith('edit:') ? 'edit' : target?.startsWith('chat:') ? 'chat' : 'image';
export const evolutionTargetId = (target: string) => evolutionWorkspace(target) === 'image' ? target : target.slice(5);
export interface InputImage { id: string; label: string }
export interface EvolutionInput {
  workspace: 'edit' | 'chat';
  operation: string;
  prompt: string | null;
  negative: string | null;
  characters: readonly Character[] | null;
  params: Record<string, unknown>;
  base?: InputImage | null;
  references?: readonly InputImage[];
  context?: readonly { id: string; text: string }[];
  /** null = known empty; absence = not recorded. Never infer identity from geometry. */
  mask?: { hash: string; summary: ReturnType<typeof summarizeMaskBitmap> } | null;
  annotations?: string;
}
export async function evolutionMask(mask: MaskBitmap | null | undefined): Promise<EvolutionInput['mask']> {
  if (mask === undefined) return undefined;
  if (!mask || !mask.bits.some(Boolean)) return null;
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(mask.bits));
  return { hash: `${mask.width}x${mask.height}:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}`, summary: summarizeMaskBitmap(mask) };
}
export function readEvolutionInput(value: unknown): EvolutionInput | null {
  const v = object(value);
  const image = (x: unknown): x is InputImage => typeof object(x).id === 'string' && typeof object(x).label === 'string';
  const json = (x: unknown, depth = 0): boolean => depth < 24 && (x === null || typeof x === 'string' || typeof x === 'boolean' ||
    typeof x === 'number' && Number.isFinite(x) || !!x && typeof x === 'object' && Object.values(x).every(child => json(child, depth + 1)));
  const mask = object(v.mask), summary = object(mask.summary);
  const box = (x: unknown, keys: string[]) => x === undefined || keys.every(k => typeof object(x)[k] === 'number' && Number.isFinite(object(x)[k]));
  if ((v.workspace !== 'edit' && v.workspace !== 'chat') || typeof v.operation !== 'string' ||
    v.prompt !== null && typeof v.prompt !== 'string' || v.negative !== null && typeof v.negative !== 'string' ||
    v.characters !== null && !Array.isArray(v.characters) || !v.params || Array.isArray(v.params) || typeof v.params !== 'object' || !json(v.params) ||
    v.base != null && !image(v.base) || v.references !== undefined && (!Array.isArray(v.references) || !v.references.every(image)) ||
    v.context !== undefined && (!Array.isArray(v.context) || !v.context.every(t => typeof object(t).id === 'string' && typeof object(t).text === 'string')) ||
    v.annotations !== undefined && typeof v.annotations !== 'string' ||
    v.mask != null && (typeof mask.hash !== 'string' || typeof summary.has_mask !== 'boolean' || summary.status !== 'ready' ||
      !box(summary.pixel_bbox, ['x','y','width','height']) || !box(summary.bbox, ['x','y','w','h']) ||
      summary.coverage_ratio !== undefined && (typeof summary.coverage_ratio !== 'number' || !Number.isFinite(summary.coverage_ratio)))) return null;
  const result = v as unknown as EvolutionInput;
  return structuredClone({ workspace: result.workspace, operation: result.operation, prompt: result.prompt, negative: result.negative,
    characters: result.characters === null ? null : readCharacters(result.characters), params: result.params,
    ...(result.base !== undefined ? {base: result.base && {id:result.base.id,label:result.base.label}} : {}),
    ...(result.references ? {references: result.references.map(({id,label})=>({id,label}))} : {}),
    ...(result.context ? {context: result.context.map(({id,text})=>({id,text}))} : {}),
    ...(result.mask !== undefined ? {mask: result.mask} : {}),
    ...(result.annotations !== undefined ? {annotations: result.annotations} : {}) });
}
/** Observers cannot change the outcome of a completed image operation. */
export function createEvolutionEvents(report: (error: unknown) => void) {
  const listeners = new Set<(target: string, parentId: string | null, advance: boolean, references: readonly string[]) => ((recordId: string) => void) | null>();
  const moves = new Set<(target: string, recordId: string) => void>();
  const handoffs = new Set<(target: string, recordId: string, inputRecordId?: string) => void>();
  return {
    onHandoff(fn: (target: string, recordId: string, inputRecordId?: string) => void) { handoffs.add(fn); return () => handoffs.delete(fn); },
    handoff(target: string, recordId: string, inputRecordId?: string) { for (const fn of handoffs) try { fn(target, recordId, inputRecordId); } catch (e) { report(e); } },
    onMove(fn: (target: string, recordId: string) => void) { moves.add(fn); return () => moves.delete(fn); },
    move(target: string, recordId: string) { for (const fn of moves) try { fn(target,recordId); } catch (e) { report(e); } },
    subscribe(fn: (target: string, parentId: string | null, advance: boolean, references: readonly string[]) => ((recordId: string) => void) | null) { listeners.add(fn); return () => listeners.delete(fn); },
    begin(target: string, parentId: string | null, advance = true, references: readonly string[] = []) {
      const completions = [...listeners].flatMap(fn => { try { const done = fn(target, parentId, advance, references); return done ? [done] : []; } catch (e) { report(e); return []; } });
      return (recordId: string) => { for (const done of completions) try { done(recordId); } catch (e) { report(e); } };
    },
    dispose() { listeners.clear(); moves.clear(); handoffs.clear(); },
  };
}
