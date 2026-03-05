import type { Response } from "express";
import { supabase, DOCUMENTS_BUCKET } from "./supabase";
import { logger } from "./logger";

/** Normalize Express route param (string | string[]) to string */
export function param(v: string | string[]): string {
  return Array.isArray(v) ? v[0] : v;
}

/** Parse int from route param; sends 400 and returns null if invalid */
export function parseIntParam(value: string, res: Response, label = "id"): number | null {
  const n = parseInt(value, 10);
  if (isNaN(n)) {
    res.status(400).json({ message: `Invalid ${label}: must be a number` });
    return null;
  }
  return n;
}

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

export function sanitizeStorageFileName(fileName: string): string {
  const basename = fileName.split(/[\\/]/).pop() || "document.pdf";
  const cleaned = basename
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  const safeName = cleaned || "document.pdf";
  return safeName.toLowerCase().endsWith(".pdf") ? safeName : `${safeName}.pdf`;
}

/**
 * Decode a base64 payload (optionally with data-URI prefix).
 * Returns the raw buffer and whether it exceeds the byte limit.
 */
export function decodeBase64Payload(
  base64Input: string,
  maxBytes: number
): { buffer: Buffer; wasTruncated: boolean } {
  const base64Data = base64Input.includes(",") ? base64Input.split(",")[1] : base64Input;
  const buffer = Buffer.from(base64Data, "base64");
  return { buffer, wasTruncated: buffer.length > maxBytes };
}

/**
 * Upload a file buffer to Supabase storage under the documents bucket.
 * Returns the storage path on success.
 */
export async function uploadToSupabase(
  claimId: number,
  documentType: string,
  fileBuffer: Buffer,
  fileName: string
): Promise<string> {
  const safeFileName = sanitizeStorageFileName(fileName);
  const storagePath = `claims/${claimId}/${documentType}/${safeFileName}`;
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}

/**
 * Download a file from Supabase storage and return it as a Buffer.
 */
export async function downloadFromSupabase(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(storagePath);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Validate image magic bytes to ensure the buffer contains a real image.
 * Supported: JPEG (FFD8FF), PNG (89504E47), WebP (RIFF...WEBP).
 * Returns true if valid image, false otherwise.
 */
export function validateImageMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;

  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;

  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return true;

  return false;
}

/**
 * Standard error response handler for route handlers.
 */
export function handleRouteError(res: Response, error: unknown, context?: string): void {
  logger.error(context || "Server", "Server error", error);
  if (!res.headersSent) {
    res.status(500).json({ message: "Internal server error" });
  }
}
