export type PngValidation =
  | {ok: true; width: number; height: number}
  | {ok: false; reason: 'render_error' | 'output_too_large'};

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function validatePngOutput(
  png: Uint8Array,
  limits: {maxOutputEdge: number; maxOutputPixels: number; maxPngBytes: number},
): PngValidation {
  if (png.byteLength > limits.maxPngBytes) return {ok: false, reason: 'output_too_large'};
  if (png.byteLength < 33 || !hasPngSignature(png)) {
    return {ok: false, reason: 'render_error'};
  }

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (
    view.getUint32(8) !== 13 ||
    png[12] !== 73 ||
    png[13] !== 72 ||
    png[14] !== 68 ||
    png[15] !== 82
  ) {
    return {ok: false, reason: 'render_error'};
  }

  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const pixels = width * height;
  if (
    width === 0 ||
    height === 0 ||
    width > limits.maxOutputEdge ||
    height > limits.maxOutputEdge ||
    !Number.isFinite(pixels) ||
    pixels > limits.maxOutputPixels
  ) {
    return {ok: false, reason: 'output_too_large'};
  }

  return {ok: true, width, height};
}

function hasPngSignature(value: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => value[index] === byte);
}
