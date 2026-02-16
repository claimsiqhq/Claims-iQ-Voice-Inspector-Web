import { createClient } from "@supabase/supabase-js";
import { logger } from "./logger";

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

export const DOCUMENTS_BUCKET = "claim-documents";
export const PHOTOS_BUCKET = "inspection-photos";

export async function ensureStorageBuckets() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketNames = buckets?.map((b) => b.name) || [];

  if (!bucketNames.includes(DOCUMENTS_BUCKET)) {
    await supabase.storage.createBucket(DOCUMENTS_BUCKET, {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024,
      allowedMimeTypes: ["application/pdf"],
    });
    logger.info("Supabase", `Created storage bucket: ${DOCUMENTS_BUCKET}`);
  }

  if (!bucketNames.includes(PHOTOS_BUCKET)) {
    await supabase.storage.createBucket(PHOTOS_BUCKET, {
      public: false,
      fileSizeLimit: 25 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/heic"],
    });
    logger.info("Supabase", `Created storage bucket: ${PHOTOS_BUCKET}`);
  }
}
