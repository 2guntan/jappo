/** MIME sniffing by magic bytes (SPEC §10.2, §18.1). Returns the detected MIME or null. */
export const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/geo+json',
  'application/vnd.google-earth.kml+xml',
  'application/zip',
]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const startsWith = (b: Buffer, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

export function sniffMime(buf: Buffer, filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return 'application/zip';
  }
  // Text formats: must be valid UTF-8 without NUL bytes.
  const head = buf.subarray(0, Math.min(buf.length, 64 * 1024));
  if (head.includes(0)) return null;
  const text = head.toString('utf8').trimStart();
  if (ext === 'geojson' || ext === 'json') return text.startsWith('{') ? 'application/geo+json' : null;
  if (ext === 'kml') return text.startsWith('<') ? 'application/vnd.google-earth.kml+xml' : null;
  if (ext === 'csv') return 'text/csv';
  return null;
}

/** Antivirus hook (SPEC §18.1): no-op in V1; replace with a ClamAV adapter in deployment. */
export async function scanForMalware(_buf: Buffer): Promise<{ clean: boolean }> {
  return { clean: true };
}
