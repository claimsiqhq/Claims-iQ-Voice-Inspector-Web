import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

/** Custom storage that respects "Remember me" - uses sessionStorage when unchecked */
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

let supabase: SupabaseClient | null;

if (!supabaseUrl || !supabaseAnonKey) {
  logger.warn("Auth", "Supabase URL or Anon Key not configured. Auth will not work.");
  supabase = null;
} else {
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { storage: typeof window !== "undefined" ? claimsiqAuthStorage() : undefined },
  });
}

export { supabase };
