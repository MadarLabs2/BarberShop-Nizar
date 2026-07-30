import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Longest edge cap for anything we upload — avatars/thumbnails/story circles never render anywhere near this size. */
const MAX_DIMENSION = 1080;
const JPEG_QUALITY = 0.82;

/**
 * Downscales to MAX_DIMENSION and always re-encodes as JPEG, regardless of the source format.
 * expo-image-picker's `quality` option only recompresses JPEG — a PNG source (e.g. a simulator
 * screenshot) sails through untouched at multi-MB size otherwise, which is exactly what was
 * driving Supabase Storage egress up on this project.
 */
export async function prepareImageForUpload(
  uri: string,
  width: number | undefined,
  height: number | undefined
): Promise<{ uri: string; mimeType: string }> {
  const longestEdge = Math.max(width || 0, height || 0);
  const context = ImageManipulator.manipulate(uri);
  if (longestEdge > MAX_DIMENSION && width && height) {
    const scale = MAX_DIMENSION / longestEdge;
    context.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
  }
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return { uri: result.uri, mimeType: 'image/jpeg' };
}
