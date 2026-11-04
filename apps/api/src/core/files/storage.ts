import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../../env';
import { hmacHex, safeEqual } from '../crypto';

/** Storage adapter (SPEC §13): S3-compatible (MinIO) or local filesystem. */
export interface Storage {
  readonly bucket: string;
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** URL valid for `ttlSeconds` that serves the object. */
  signedUrl(key: string, filename: string, fileId: string, ttlSeconds?: number): Promise<string>;
}

export class S3Storage implements Storage {
  private client: S3Client;
  private ready?: Promise<void>;
  constructor(
    private env: Env,
    public readonly bucket = env.S3_BUCKET,
  ) {
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: env.S3_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY ?? '' } : undefined,
    });
  }
  private ensureBucket(): Promise<void> {
    this.ready ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      }
    })();
    return this.ready;
  }
  async put(key: string, body: Buffer, mime: string) {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mime }));
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async signedUrl(key: string, filename: string, _fileId: string, ttlSeconds = 300) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"` }),
      { expiresIn: ttlSeconds },
    );
  }
}

/** Filesystem storage; downloads are served by GET /v1/files/{id}/raw with an HMAC-signed expiry. */
export class FsStorage implements Storage {
  public readonly bucket = 'fs';
  constructor(
    private dir: string,
    private signingKey: string,
    private publicBase: string,
  ) {}
  private p(key: string) {
    const full = path.resolve(this.dir, key);
    if (!full.startsWith(path.resolve(this.dir))) throw new Error('invalid key');
    return full;
  }
  async put(key: string, body: Buffer) {
    await mkdir(path.dirname(this.p(key)), { recursive: true });
    await writeFile(this.p(key), body);
  }
  get(key: string) {
    return readFile(this.p(key));
  }
  async signedUrl(_key: string, _filename: string, fileId: string, ttlSeconds = 300) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `${this.publicBase}/v1/files/${fileId}/raw?exp=${exp}&sig=${signFileUrl(this.signingKey, fileId, exp)}`;
  }
}

export const signFileUrl = (key: string, fileId: string, exp: number, wm = '') => hmacHex(key, `${fileId}.${exp}${wm ? `.${wm}` : ''}`);
export function verifyFileUrl(key: string, fileId: string, exp: number, sig: string, wm = ''): boolean {
  return exp >= Math.floor(Date.now() / 1000) && safeEqual(signFileUrl(key, fileId, exp, wm), sig);
}

/** API-served signed URL that stamps a watermark on PDFs (used for non-owner downloads of data-room PDFs). */
export function watermarkedUrl(signingKey: string, publicBase: string, fileId: string, text: string, ttlSeconds = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const wm = Buffer.from(text, 'utf8').toString('base64url');
  return `${publicBase}/v1/files/${fileId}/raw?exp=${exp}&wm=${wm}&sig=${signFileUrl(signingKey, fileId, exp, wm)}`;
}

export function createStorage(env: Env): Storage {
  return env.STORAGE_DRIVER === 's3'
    ? new S3Storage(env)
    : new FsStorage(env.FS_STORAGE_DIR, env.FILE_URL_SIGNING_KEY, env.API_PUBLIC_URL);
}
