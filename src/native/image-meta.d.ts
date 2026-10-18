export interface ImageMetadata {
  name: string;
  dialect: string;
  source?: string;
  fields: Record<string, string | number | null>;
  extras: { label: string; value: string }[];
}
export function readImageParams(
  file: Blob & { name?: string },
): Promise<ImageMetadata>;
export const DIALECTS: { NAI: string; WEBUI: string };
