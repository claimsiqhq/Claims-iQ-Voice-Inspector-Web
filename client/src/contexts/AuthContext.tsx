import { createContext, useContext, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";

interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: AuthUser | null;
  role: string | null;
  loading: boolean;
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    const rememberMe = localStorage.getItem("claimsiq_remember_me") === "true";
    const sessionActive = sessionStorage.getItem("claimsiq_session_active") === "true";

    if (!rememberMe && !sessionActive) {
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) {
          setLoading(false);
          return;
        }
        supabase.auth.signOut().catch(() => {});
        setLoading(false);
      }).catch(() => setLoading(false));
      return;
    }

    async function initSession() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error || !session) {
          const { data: refreshData } = await supabase.auth.refreshSession();
          if (refreshData.session) {
            const profile = await syncUserToBackend(
              refreshData.session.user.id,
              refreshData.session.user.email || "",
              "",
              refreshData.session.access_token
            );
            if (!profile) {
              const fetched = await fetchUserProfile();
              if (fetched) setUser(fetched);
            }
          }
        } else {
          const profile = await syncUserToBackend(
            session.user.id,
            session.user.email || "",
            "",
            session.access_token
          );
          if (!profile) {
            const fetched = await fetchUserProfile();
            if (fetched) setUser(fetched);
          }
        }
      } catch (err) {
        console.error("Session init failed:", err);
      } finally {
        setLoading(false);
      }
    }

    initSession();

    const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        await syncUserToBackend(session.user.id, session.user.email || "", "", session.access_token);
      } else {
        if (!localStorage.getItem("claimsiq_remember_me")) {
          setUser(null);
        }
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading((prev) => {
        if (prev) {
          console.warn("Auth loading timed out — forcing login screen");
          return false;
        }
        return prev;
      });
    }, 8000);
    return () => clearTimeout(timeout);
  }, []);

  async function checkSession() {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        const profile = await fetchUserProfile();
        if (profile) {
          setUser(profile);
        }
      }
    } catch (error) {
      console.error("Session check failed:", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchUserProfile(): Promise<AuthUser | null> {
    try {
      const response = await fetch("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ""}`,
        },
      });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  async function syncUserToBackend(
    supabaseId: string,
    email: string,
    fullName: string,
    accessToken?: string
  ): Promise<AuthUser | null> {
    try {
      const token = accessToken || (await supabase.auth.getSession()).data.session?.access_token || "";
      const response = await fetch("/api/auth/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ supabaseId, email, fullName }),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.message || "Failed to sync user");
      }
      const profile = (await response.json()) as AuthUser;
      setUser(profile);
      return profile;
    } catch (error) {
      console.error("Sync failed:", error);
      return null;
    }
  }

  async function signIn(email: string, password: string, rememberMe: boolean = true) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      if (data.session && data.user) {
        if (rememberMe) {
          localStorage.setItem("claimsiq_remember_me", "true");
        } else {
          localStorage.removeItem("claimsiq_remember_me");
          sessionStorage.setItem("claimsiq_session_active", "true");
        }
        const token = data.session.access_token;
        const profile =
          (await syncUserToBackend(data.user.id, data.user.email || "", "", token)) ||
          (await fetchUserProfile());
        if (!profile) {
          throw new Error("Unable to load your profile. Please try again.");
        }
        setUser(profile);
        setLocation("/");
        toast({ title: "Signed in successfully" });
      }
    } catch (error: any) {
      toast({ title: "Sign in failed", description: error.message, variant: "destructive" });
    }
  }

  async function signUp(email: string, password: string, fullName: string) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });
      if (error) throw error;
      if (data.session && data.user) {
        const token = data.session.access_token;
        const profile = await syncUserToBackend(data.user.id, email, fullName, token);
        if (!profile) {
          throw new Error("Unable to complete registration. Please try again.");
        }
        setLocation("/");
        toast({ title: "Account created successfully" });
      } else if (data.user) {
        toast({ title: "Check your email", description: "Please verify your email address to complete registration." });
      }
    } catch (error: any) {
      toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
    }
  }

  async function signOut() {
    try {
      localStorage.removeItem("claimsiq_remember_me");
      sessionStorage.removeItem("claimsiq_session_active");
      await supabase.auth.signOut();
      setUser(null);
      setLocation("/login");
      toast({ title: "Signed out" });
    } catch (error: any) {
      toast({ title: "Sign out failed", description: error.message, variant: "destructive" });
    }
  }

  async function refreshSession() {
    const session = await supabase.auth.getSession();
    if (session.data.session) {
      const profile = await fetchUserProfile();
      if (profile) {
        setUser(profile);
      }
    }
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
