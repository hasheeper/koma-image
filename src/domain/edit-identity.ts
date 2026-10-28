import type { DirectorVariant } from "./director-tools.ts";
export const editVariantLetter = (variant?: DirectorVariant) => variant ? ({ masked: "a", generated: "b", blend: "c" } as const)[variant] : undefined;
export const editLabel = (version: { sequence: number; director?: { variant?: DirectorVariant } }, member = true) =>
  `#e${version.sequence}${member && version.director?.variant ? editVariantLetter(version.director.variant) : ""}`;
export const qualifiedEditLabel = (board: { boardSeq: number }, version: Parameters<typeof editLabel>[0], member = true) =>
  `#e${board.boardSeq}.${version.sequence}${member && version.director?.variant ? editVariantLetter(version.director.variant) : ""}`;
