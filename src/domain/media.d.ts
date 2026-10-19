import type { CatalogModel } from "./catalog";
import type { ImagePayload } from "../gateway/routes";
export const MAX_INPUT_BYTES: number, MAX_TOTAL_BYTES: number;
export type EditMode = "img2img" | "inpaint";
export type EditorMode = EditMode | "upscale";
export function chatModels(c: { models: CatalogModel[] }): CatalogModel[];
export function isDedicatedUpscaler(model?: CatalogModel): boolean;
export function upscaleModels(c: { models: CatalogModel[] }): CatalogModel[];
export function buildChatPayload(
  model: CatalogModel,
  prompt: string,
  options: Record<string, string>,
  images?: string[],
): ImagePayload;
export function naiEditModels(
  c: { models: CatalogModel[] },
  tool?: string,
): CatalogModel[];
export function editorModels(
  c: { models: CatalogModel[] },
  mode: EditorMode,
): CatalogModel[];
export function validateEditorSource(
  mode: EditorMode,
  model: CatalogModel | undefined,
  size: { width: number; height: number; bytes?: number },
): string | null;
export interface EditorFields {
  prompt?: string;
  negative_prompt?: string;
  sampler?: string;
  steps?: number;
  scale?: number;
  seed?: number;
  strength?: number;
  noise?: number;
  detail?: string;
  options?: Record<string, string>;
}
export function buildEditorPayload(
  mode: EditorMode,
  model: CatalogModel,
  source: { original?: string; png?: string },
  fields?: EditorFields,
  mask?: string | null,
): ImagePayload;
