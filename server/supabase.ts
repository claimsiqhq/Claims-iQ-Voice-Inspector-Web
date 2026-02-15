import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase: SupabaseClient | null =
  url && serviceKey ? createClient(url, serviceKey) : null;
export const DOCUMENTS_BUCKET = "claim-documents";
export const PHOTOS_BUCKET = "inspection-photos";
