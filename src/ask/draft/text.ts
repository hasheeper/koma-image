import type { TextStep } from "./types.ts";

/** An empty insertion changes nothing; empty replace/rewrite still delete text. */
export const isEmptyInsertion = (step: Pick<TextStep, "mode" | "text">) =>
  step.text === "" && ["before", "after", "append"].includes(step.mode);
