import { inject, provide } from "vue";
import type { InjectionKey, Ref } from "vue";
import { useDrawing } from "./drawing";
import type { DrawingForm } from "../domain/drawing";
import type { CatalogModel } from "../domain/catalog";
import type { Character, Placement, characterCapability } from "../domain/characters";
import type { NaiReferences, ReferenceKind } from "../domain/nai-references";
import type { ImagePayload } from "../gateway/routes";

type ComposerForm = Pick<DrawingForm, "model" | "prompt" | "negative" | "naiMode" | "complexity" | "qualityPreset" | "negativePreset" | "transparentBg" | "characters" | "placement" | "width" | "height" | "tagSuggest" | "naiReferences" | "sampler" | "steps">;
/** Shared presentation controls; the provider owns writes and async upload targets. */
export interface NaiComposer {
  input?: Readonly<Ref<ImagePayload>>;
  view: Readonly<Ref<{
    form: ComposerForm;
    activeBoardId: string;
    models: CatalogModel[];
    model?: CatalogModel;
    catalogLoading?: boolean;
    catalogError?: string;
    referenceSupported: boolean;
    referenceKinds?: readonly ReferenceKind[];
    referenceProblem: string;
    characterCapability: ReturnType<typeof characterCapability>;
    characterProblem: string | boolean;
    locked?: boolean;
  }>>;
  drawing: {
    patch(values: Partial<ComposerForm>): void | Promise<void>;
    editReferences(value: NaiReferences, owner?: string): Promise<void>;
    board(owner: string): { form: { naiReferences: NaiReferences } } | undefined;
    editCharacters(chars: Character[], placement?: Placement, owner?: string): Promise<void>;
    addCharacter(): Promise<string | undefined>;
  };
  id(name: string): string;
  stageTarget: string;
  stageViewport: string;
}
const key: InjectionKey<NaiComposer> = Symbol("nai-composer");
export function provideNaiComposer(composer: NaiComposer) { provide(key, composer); }
export function useNaiComposer(): NaiComposer {
  const context = inject(key, null);
  if (context) return context;
  const { drawing, view } = useDrawing();
  return { drawing, view, id: name => name, stageTarget: "body", stageViewport: ".shell .viewport" };
}
