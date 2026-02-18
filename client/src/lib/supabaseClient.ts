import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

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

const CONFIG_FETCH_TIMEOUT_MS = 5000;
const SUPABASE_HTTP_TIMEOUT_MS = 15000;

function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: {
      // Prevent auth calls from hanging forever when the Supabase URL is unreachable.
      fetch: (input, init) => fetchWithTimeout(input, init, SUPABASE_HTTP_TIMEOUT_MS),
    },
    auth: { storage: typeof window !== "undefined" ? claimsiqAuthStorage() : undefined },
  });
}

async function initSupabase(): Promise<SupabaseClient | null> {
  if (supabase) return supabase;

  try {
    const res = await fetchWithTimeout("/api/config", {}, CONFIG_FETCH_TIMEOUT_MS);
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
