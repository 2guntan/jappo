import type { FastifyRequest } from 'fastify';
import { badRequest } from './errors';
import { MAX_UPLOAD_BYTES } from './files/sniff';

export interface UploadedFile {
  filename: string;
  declaredMime: string;
  buffer: Buffer;
}

/** Read a multipart request: text fields + exactly one file part named `file`. */
export async function readMultipart(req: FastifyRequest): Promise<{ fields: Record<string, string>; file: UploadedFile }> {
  if (!req.isMultipart()) throw badRequest('MULTIPART_REQUIRED', 'Expected multipart/form-data');
  const fields: Record<string, string> = {};
  let file: UploadedFile | undefined;
  for await (const part of req.parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20 } })) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (part.file.truncated) throw badRequest('FILE_TOO_LARGE', 'File exceeds 25 MB');
      file = { filename: part.filename, declaredMime: part.mimetype, buffer };
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  if (!file) throw badRequest('FILE_REQUIRED', 'A file part named "file" is required', [{ path: 'body.file', message: 'required' }]);
  return { fields, file };
}
