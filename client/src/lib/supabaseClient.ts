import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

function claimsiqAuthStorage() {
  return {
    getItem: (key: string) => {
      const useLocal = typeof window !== "undefined" && localStorage.getItem("claimsiq_remember_me") === "true";
      const storage = useLocal ? localStorage : sessionStorage;
      return storage.getItem(key);
    },
    setItem: (key: string, value: string) => {
      const useLocal = typeof window !== "undefined" && localStorage.getItem("claimsiq_remember_me") === "true";
      const storage = useLocal ? localStorage : sessionStorage;
      storage.setItem(key, value);
    },
    removeItem: (key: string) => {
      if (typeof window !== "undefined") {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      }
    },
  };
}

let supabase: SupabaseClient | null = null;
let supabaseInitPromise: Promise<SupabaseClient | null> | null = null;

function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { storage: typeof window !== "undefined" ? claimsiqAuthStorage() : undefined },
  });
}

const buildTimeUrl = import.meta.env.VITE_SUPABASE_URL || "";
const buildTimeKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

if (buildTimeUrl && buildTimeKey) {
  supabase = createSupabaseClient(buildTimeUrl, buildTimeKey);
}

async function initSupabase(): Promise<SupabaseClient | null> {
  if (supabase) return supabase;

  try {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("Config fetch failed");
    const config = await res.json();
    if (config.supabaseUrl && config.supabaseAnonKey) {
      supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey);
      logger.info("Auth", "Supabase initialized from server config");
      return supabase;
    }
  } catch (err) {
    logger.warn("Auth", "Failed to fetch server config for Supabase");
  }

  logger.warn("Auth", "Supabase URL or Anon Key not configured. Auth will not work.");
  return null;
}

function getSupabaseAsync(): Promise<SupabaseClient | null> {
  if (supabase) return Promise.resolve(supabase);
  if (!supabaseInitPromise) {
    supabaseInitPromise = initSupabase();
  }
  return supabaseInitPromise;
}

export { supabase, getSupabaseAsync };
