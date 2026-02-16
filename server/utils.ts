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
  const storagePath = `claims/${claimId}/${documentType}/${fileName}`;
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
 * Standard error response handler for route handlers.
 */
export function handleRouteError(res: Response, error: unknown, context?: string): void {
  logger.error(context || "Server", "Server error", error);
  if (!res.headersSent) {
    res.status(500).json({ message: "Internal server error" });
  }
}
