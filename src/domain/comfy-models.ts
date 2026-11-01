import type { ComfyWorkflow } from "./comfy-workflow.ts";

// These loaders expose MODEL on output 0. CLIP/VAE-only uses must not be
// mistaken for the model that generates the selected image.
const loaderFields: Readonly<Record<string, string>> = {
  CheckpointLoader: "ckpt_name",
  CheckpointLoaderSimple: "ckpt_name",
  unCLIPCheckpointLoader: "ckpt_name",
  ImageOnlyCheckpointLoader: "ckpt_name",
  UNETLoader: "unet_name",
  UnetLoaderGGUF: "unet_name",
  UnetLoaderGGUFAdvanced: "unet_name",
};

/** Read literal model filenames on the selected output's dependency paths. */
export function comfyModelFiles({ workflow, bindings }: ComfyWorkflow): string[] {
  const pending = [{ id: bindings.output, slot: -1 }], visited = new Set<string>(), files = new Set<string>();
  for (const { id, slot } of pending) {
    const key = JSON.stringify([id, slot]), node = workflow[id];
    if (!node || visited.has(key)) continue;
    visited.add(key);
    const field = Object.hasOwn(loaderFields, node.class_type) ? loaderFields[node.class_type] : undefined;
    if (field) {
      const value = node.inputs[field];
      if (slot === 0 && typeof value === "string" && value.trim()) files.add(value);
      continue;
    }
    for (const value of Object.values(node.inputs)) {
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number" && Number.isSafeInteger(value[1]) && value[1] >= 0)
        pending.push({ id: value[0], slot: value[1] });
    }
  }
  return [...files];
}

export function comfyModelFileLabel(file: string): string {
  const name = file.split(/[\\/]/).at(-1) || file;
  return name.replace(/\.(?:safetensors|sft|ckpt|gguf|pt|pth|bin)$/i, "") || name;
}
