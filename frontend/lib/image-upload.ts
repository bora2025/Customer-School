/**
 * Turns a picked image into a data URL small enough for the marketplace API, which caps JSON bodies
 * at 256kb and checks the decoded bytes of every image it is given.
 *
 * Re-drawing through a canvas does two jobs: it shrinks large phone screenshots to a sensible size,
 * and it always produces a genuine PNG or JPEG. Whatever the picked file really was, what is sent is
 * a freshly drawn raster, never the original bytes.
 *
 * Both encodings are tried and the smaller one that fits is sent. A bank receipt is mostly flat
 * colour and text, which PNG compresses far better than JPEG -- a 6 KB screenshot re-encoded as JPEG
 * came out at 63 KB -- while a photo of a paper receipt goes the other way. A QR code (`preferPng`) is
 * kept lossless whenever it fits, because JPEG artefacts are what make a code fail to scan.
 */
export async function imageFileToDataUrl(file: File, options: { maxDimension: number; maxBytes: number; preferPng?: boolean }): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, options.maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare images for upload.');
  // White ground first: a transparent PNG flattened to JPEG would otherwise come out black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const decodedBytes = (dataUrl: string) => Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
  const png = canvas.toDataURL('image/png');
  const pngFits = decodedBytes(png) <= options.maxBytes;
  if (options.preferPng && pngFits) return png;
  const jpeg = [0.92, 0.85, 0.75, 0.65, 0.55].map((quality) => canvas.toDataURL('image/jpeg', quality)).find((candidate) => decodedBytes(candidate) <= options.maxBytes);
  const fitting = [pngFits ? png : null, jpeg ?? null].filter((candidate): candidate is string => candidate !== null);
  if (fitting.length === 0) throw new Error(`That image is too large even after shrinking; the limit is ${Math.floor(options.maxBytes / 1024)} KB.`);
  return fitting.reduce((smallest, candidate) => (decodedBytes(candidate) < decodedBytes(smallest) ? candidate : smallest));
}
