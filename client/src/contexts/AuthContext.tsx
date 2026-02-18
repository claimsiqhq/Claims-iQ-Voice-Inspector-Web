import { createContext, useContext, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { supabase as initialSupabase, getSupabaseAsync } from "@/lib/supabaseClient";
import { getLocalToken, setLocalToken, clearLocalToken } from "@/lib/queryClient";
import { fetchWithTimeout, readErrorMessage, TimeoutError } from "@/lib/fetchWithTimeout";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@/lib/logger";
import type { SupabaseClient } from "@supabase/supabase-js";

const AUTH_BOOTSTRAP_TIMEOUT_MS = 12000;
const AUTH_REQUEST_TIMEOUT_MS = 15000;

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  title: string | null;
  avatarUrl: string | null;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: AuthUser | null;
  role: string | null;
  loading: boolean;
  signIn: (emailOrUsername: string, password: string, rememberMe?: boolean) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, username?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  updateProfile: (updates: Partial<Pick<AuthUser, "fullName" | "title" | "avatarUrl">>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sb, setSb] = useState<SupabaseClient | null>(initialSupabase);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const rememberMe = localStorage.getItem("claimsiq_remember_me") === "true";
      const sessionActive = sessionStorage.getItem("claimsiq_session_active") === "true";

      const localToken = getLocalToken();
      if (localToken) {
        try {
          const res = await fetchWithTimeout(
            "/api/auth/me",
            {
            headers: { Authorization: `Bearer ${localToken}` },
            },
            AUTH_BOOTSTRAP_TIMEOUT_MS
          );
          if (res.ok) {
            const profile = await res.json();
            if (!cancelled) setUser(profile);
          } else if (res.status === 401 || res.status === 403) {
            clearLocalToken();
          }
        } catch {
          logger.warn("Auth", "Bootstrap /api/auth/me failed (timeout or network) — keeping token for retry");
        }
        if (!cancelled) setLoading(false);
        return;
      }

      const supabase = await getSupabaseAsync();
      if (cancelled) return;
      if (supabase) setSb(supabase);

      if (!supabase) {
        setLoading(false);
        return;
      }

      if (!rememberMe && !sessionActive) {
        try {
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            await supabase.auth.signOut().catch(() => {});
          }
        } catch {}
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        let session = (await supabase.auth.getSession()).data.session;
        if (!session) {
          const { data: refreshData } = await supabase.auth.refreshSession();
          session = refreshData.session;
        }
        if (!session) {
          if (!cancelled) setLoading(false);
          return;
        }

        const tokenAge = session.expires_at
          ? session.expires_at * 1000 - Date.now()
          : Infinity;
        if (tokenAge < 60_000) {
          const { data: refreshData } = await supabase.auth.refreshSession();
          if (refreshData.session) session = refreshData.session;
        }

        const profile = await syncUserToBackendWithClient(
          supabase,
          session.user.id,
          session.user.email || "",
          "",
          session.access_token,
          rememberMe
        );
        if (!cancelled) {
          if (!profile) {
            const fetched = await fetchUserProfileHelper(supabase);
            if (fetched) setUser(fetched);
          }
        }
      } catch (err) {
        logger.error("Auth", "Session init failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }

      const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (cancelled) return;
        if (event === "SIGNED_OUT") {
          setUser(null);
          clearLocalToken();
          return;
        }
        if (session) {
          const rm = localStorage.getItem("claimsiq_remember_me") === "true";
          await syncUserToBackendWithClient(supabase, session.user.id, session.user.email || "", "", session.access_token, rm);
        }
      });

      return () => { listener.subscription.unsubscribe(); };
    }

    const cleanupPromise = init();
    return () => {
      cancelled = true;
      cleanupPromise?.then((cleanup) => cleanup?.());
    };
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading((prev) => {
        if (prev) {
          logger.warn("Auth", "Auth loading timed out — forcing login screen");
          return false;
        }
        return prev;
      });
    }, 15000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const handler = () => {
      setUser(null);
    };
    window.addEventListener("auth:unauthorized", handler);
    return () => window.removeEventListener("auth:unauthorized", handler);
  }, []);

  async function fetchUserProfileHelper(client?: SupabaseClient | null, token?: string): Promise<AuthUser | null> {
    try {
      const supabaseClient = client || sb;
      const authToken = token || getLocalToken() || (supabaseClient ? (await supabaseClient.auth.getSession()).data.session?.access_token : null);
      if (!authToken) return null;
      const response = await fetchWithTimeout(
        "/api/auth/me",
        { headers: { Authorization: `Bearer ${authToken}` } },
        AUTH_REQUEST_TIMEOUT_MS
      );
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  async function syncUserToBackendWithClient(
    client: SupabaseClient | null,
    supabaseId: string,
    email: string,
    fullName: string,
    accessToken?: string,
    rememberMe: boolean = true
  ): Promise<AuthUser | null> {
    try {
      const token = accessToken || (client ? (await client.auth.getSession()).data.session?.access_token : null) || "";
      const response = await fetchWithTimeout(
        "/api/auth/sync",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ supabaseId, email, fullName }),
        },
        AUTH_REQUEST_TIMEOUT_MS
      );
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.message || "Failed to sync user");
      }
      const data = (await response.json()) as { token?: string; user?: AuthUser } & AuthUser;
      const profile = data.user ?? data;
      const localToken = data.token;
      if (localToken) {
        setLocalToken(localToken, rememberMe);
      }
      setUser(profile);
      return profile;
    } catch (error) {
      logger.error("Auth", "Sync failed", error);
      return null;
    }
  }

  async function signIn(emailOrUsername: string, password: string, rememberMe: boolean = true) {
    try {
      if (rememberMe) {
        localStorage.setItem("claimsiq_remember_me", "true");
        sessionStorage.removeItem("claimsiq_session_active");
      } else {
        localStorage.removeItem("claimsiq_remember_me");
        sessionStorage.setItem("claimsiq_session_active", "true");
      }

      const identifier = emailOrUsername.trim();

      // Prefer the backend local auth first (supports username OR email).
      // This prevents sign-in hangs when Supabase Auth isn't configured client-side.
      let localFailureMessage: string | null = null;
      try {
        const localRes = await fetchWithTimeout(
          "/api/auth/login",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emailOrUsername: identifier, password }),
          },
          AUTH_REQUEST_TIMEOUT_MS
        );

        if (localRes.ok) {
          const { token, user: profile } = await localRes.json();
          setLocalToken(token, rememberMe);
          setUser(profile);
          setLocation("/");
          toast({ title: "Signed in successfully" });
          return;
        }

        localFailureMessage = await readErrorMessage(localRes);

        // If the backend explicitly blocks sign-in, don't attempt alternate providers.
        if (localRes.status === 403 || localRes.status === 429) {
          throw new Error(localFailureMessage);
        }

        // Fall through to Supabase (if configured) for email-based auth.
      } catch (err: unknown) {
        // If the local auth call timed out or failed, we can still try Supabase (if configured).
        if (err instanceof TimeoutError) {
          localFailureMessage = "Sign in timed out. Please check your connection and try again.";
        } else {
          localFailureMessage = err instanceof Error ? err.message : "Local sign in failed.";
        }
      }

      // Username-based sign-in can only work via local auth.
      if (!identifier.includes("@")) {
        throw new Error(localFailureMessage || "Sign in failed");
      }

      const supabase = sb || await getSupabaseAsync();
      if (!supabase) {
        throw new Error(localFailureMessage || "Authentication service is not configured.");
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email: identifier, password });
      if (error) throw error;
      if (data.session && data.user) {
        const token = data.session.access_token;
        const profile =
          (await syncUserToBackendWithClient(supabase, data.user.id, data.user.email || "", "", token, rememberMe)) ||
          (await fetchUserProfileHelper(supabase, token));
        if (!profile) throw new Error("Unable to load your profile. Please try again.");
        setUser(profile);
        setLocation("/");
        toast({ title: "Signed in successfully" });
      }
    } catch (error: unknown) {
      toast({ title: "Sign in failed", description: error instanceof Error ? error.message : "Sign in failed", variant: "destructive" });
    }
  }

  async function signUp(email: string, password: string, fullName: string, username?: string) {
    try {
      localStorage.setItem("claimsiq_remember_me", "true");
      sessionStorage.removeItem("claimsiq_session_active");

      let registerRes: Response | null = null;
      try {
        registerRes = await fetchWithTimeout(
          "/api/auth/register",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: username || email.split("@")[0],
              email: email || undefined,
              password,
              fullName: fullName || undefined,
            }),
          },
          AUTH_REQUEST_TIMEOUT_MS
        );
      } catch (err: unknown) {
        // We'll attempt Supabase fallback below if configured.
        logger.warn("Auth", "Local register request failed", err);
      }

      if (registerRes?.ok) {
        const { token, user: profile } = await registerRes.json();
        setLocalToken(token, true);
        setUser(profile);
        setLocation("/");
        toast({ title: "Account created successfully" });
        return;
      }

      // If the backend validated and rejected the request (4xx), surface that error directly.
      if (registerRes && registerRes.status >= 400 && registerRes.status < 500 && registerRes.status !== 404) {
        throw new Error(await readErrorMessage(registerRes));
      }

      const supabase = sb || await getSupabaseAsync();
      if (supabase) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        if (data.session && data.user) {
          const token = data.session.access_token;
          const profile = await syncUserToBackendWithClient(supabase, data.user.id, email, fullName, token, true);
          if (!profile) {
            throw new Error("Unable to complete registration. Please try again.");
          }
          setLocation("/");
          toast({ title: "Account created successfully" });
        } else if (data.user) {
          toast({ title: "Check your email", description: "Please verify your email address to complete registration." });
        }
      } else {
        const message = registerRes ? await readErrorMessage(registerRes) : "Registration failed";
        throw new Error(message);
      }
    } catch (error: unknown) {
      toast({ title: "Sign up failed", description: error instanceof Error ? error.message : "Sign up failed", variant: "destructive" });
    }
  }

  async function signOut() {
    try {
      clearLocalToken();
      localStorage.removeItem("claimsiq_remember_me");
      sessionStorage.removeItem("claimsiq_session_active");
      const supabase = sb || await getSupabaseAsync();
      if (supabase) await supabase.auth.signOut();
      setUser(null);
      setLocation("/login");
      toast({ title: "Signed out" });
    } catch (error: unknown) {
      toast({ title: "Sign out failed", description: error instanceof Error ? error.message : "Sign out failed", variant: "destructive" });
    }
  }

  async function refreshSession() {
    const localToken = getLocalToken();
    if (localToken) {
      const profile = await fetchUserProfileHelper(sb, localToken);
      if (profile) setUser(profile);
      return;
    }
    const supabase = sb || await getSupabaseAsync();
    if (supabase) {
      const session = await supabase.auth.getSession();
      if (session.data.session) {
        const profile = await fetchUserProfileHelper(supabase);
        if (profile) setUser(profile);
      }
    }
  }

  function updateProfile(updates: Partial<Pick<AuthUser, "fullName" | "title" | "avatarUrl">>) {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!user,
        user,
        role: user?.role || null,
        loading,
        signIn,
        signUp,
        signOut,
        refreshSession,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
