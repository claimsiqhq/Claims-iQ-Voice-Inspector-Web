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
  signIn: (email: string, password: string) => Promise<void>;
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
    checkSession();
    const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        await syncUserToBackend(session.user.id, session.user.email || "", "");
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
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

  async function syncUserToBackend(supabaseId: string, email: string, fullName: string) {
    try {
      const { data: session } = await supabase.auth.getSession();
      const response = await fetch("/api/auth/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.session?.access_token || ""}`,
        },
        body: JSON.stringify({ supabaseId, email, fullName }),
      });
      const profile = await response.json();
      setUser(profile);
    } catch (error) {
      console.error("Sync failed:", error);
    }
  }

  async function signIn(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      if (data.user) {
        const profile = await fetchUserProfile();
        if (profile) {
          setUser(profile);
          setLocation("/");
          toast({ title: "Signed in successfully" });
        }
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
      if (data.user) {
        await syncUserToBackend(data.user.id, email, fullName);
        setLocation("/");
        toast({ title: "Account created successfully" });
      }
    } catch (error: any) {
      toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
    }
  }

  async function signOut() {
    try {
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
