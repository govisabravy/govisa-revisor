/**
 * Storage S3-compatível (MinIO em produção).
 *
 * Uso:
 *   const buf = await downloadReviewPdf(reviewId);
 *   await uploadReviewPdf(reviewId, buffer, "original.pdf");
 *
 * Config via env vars:
 *   S3_ENDPOINT      ex: http://minio-xakpc4h2k6gn8203nonrn4ex:9000
 *   S3_REGION        ex: us-east-1 (MinIO ignora mas SDK exige)
 *   S3_ACCESS_KEY
 *   S3_SECRET_KEY
 *   S3_BUCKET        ex: govisa-reviews-pdfs
 *   S3_FORCE_PATH_STYLE  default true (necessário pra MinIO)
 *
 * Se S3_ENDPOINT estiver vazio, todas as funções viram no-op (graceful degrade
 * em dev local sem MinIO). Quem chama precisa testar `isStorageEnabled()`.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type GetObjectCommandOutput
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

let client: S3Client | null = null;

function getBucket(): string {
  return process.env.S3_BUCKET ?? "govisa-reviews-pdfs";
}

export function isStorageEnabled(): boolean {
  return !!process.env.S3_ENDPOINT && !!process.env.S3_ACCESS_KEY;
}

function getClient(): S3Client {
  if (client) return client;
  if (!isStorageEnabled()) {
    throw new Error("Storage S3 não configurado (S3_ENDPOINT/S3_ACCESS_KEY ausentes)");
  }
  client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!
    },
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false"
  });
  return client;
}

export function buildReviewPdfKey(reviewId: string): string {
  return `reviews/${reviewId}.pdf`;
}

export interface UploadResult {
  bucket: string;
  key: string;
  size: number;
}

/**
 * Faz upload do PDF original do review pro bucket.
 * Idempotente: chamadas repetidas sobrescrevem o objeto.
 */
export async function uploadReviewPdf(
  reviewId: string,
  buffer: Buffer,
  originalFileName?: string
): Promise<UploadResult> {
  const c = getClient();
  const bucket = getBucket();
  const key = buildReviewPdfKey(reviewId);
  await c.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "application/pdf",
      Metadata: originalFileName
        ? { "original-filename": encodeURIComponent(originalFileName) }
        : undefined
    })
  );
  return { bucket, key, size: buffer.byteLength };
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Baixa o PDF original de um review (pra rerodar).
 * Throw se não existir.
 */
export async function downloadReviewPdf(
  reviewIdOrKey: string
): Promise<{ buffer: Buffer; key: string; originalFileName: string | null }> {
  const c = getClient();
  const bucket = getBucket();
  const key = reviewIdOrKey.includes("/")
    ? reviewIdOrKey
    : buildReviewPdfKey(reviewIdOrKey);
  const out: GetObjectCommandOutput = await c.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  if (!out.Body) {
    throw new Error(`PDF vazio em ${bucket}/${key}`);
  }
  const buffer = await streamToBuffer(out.Body as Readable);
  const rawName = out.Metadata?.["original-filename"] ?? null;
  const originalFileName = rawName ? decodeURIComponent(rawName) : null;
  return { buffer, key, originalFileName };
}

export async function reviewPdfExists(reviewId: string): Promise<boolean> {
  if (!isStorageEnabled()) return false;
  const c = getClient();
  const bucket = getBucket();
  const key = buildReviewPdfKey(reviewId);
  try {
    await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}
