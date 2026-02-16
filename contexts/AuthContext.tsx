import React, { createContext, useContext, useState, useEffect } from "react";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";

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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(supabaseUser: any): Promise<AuthUser | null> {
    if (!supabaseUser) return null;
    // Get profile from users table
    const { data } = await supabase
      .from("users")
      .select("id, email, full_name, role, title, avatar_url")
      .eq("supabase_auth_id", supabaseUser.id)
      .limit(1)
      .single();

    if (data) {
      return {
        id: data.id,
        email: data.email || supabaseUser.email || "",
        fullName: data.full_name,
        role: data.role || "adjuster",
        title: data.title,
        avatarUrl: data.avatar_url,
      };
    }

    // Fallback: create user row
    const { data: newUser } = await supabase
      .from("users")
      .insert({
        username: supabaseUser.email?.split("@")[0] || `user_${Date.now()}`,
        password: "supabase",
        email: supabaseUser.email,
        full_name: supabaseUser.user_metadata?.full_name || null,
        supabase_auth_id: supabaseUser.id,
        role: "adjuster",
      })
      .select()
      .single();

    if (newUser) {
      return {
        id: newUser.id,
        email: newUser.email || "",
        fullName: newUser.full_name,
        role: newUser.role || "adjuster",
        title: newUser.title,
        avatarUrl: newUser.avatar_url,
      };
    }

    return null;
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const profile = await loadProfile(session.user);
        if (profile) setUser(profile);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const profile = await loadProfile(session.user);
        if (profile) setUser(profile);
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(emailOrUsername: string, password: string): Promise<void> {
    const email = emailOrUsername.includes("@") ? emailOrUsername : `${emailOrUsername}@claimsiq.local`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    if (data.user) {
      const profile = await loadProfile(data.user);
      if (profile) setUser(profile);
      router.replace("/(tabs)");
    }
  }

  async function signUp(email: string, password: string, fullName: string): Promise<void> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw new Error(error.message);
    if (data.user) {
      const profile = await loadProfile(data.user);
      if (profile) setUser(profile);
      router.replace("/(tabs)");
    }
  }

  async function signOut(): Promise<void> {
    await supabase.auth.signOut();
    setUser(null);
    router.replace("/login");
  }

  async function refreshSession(): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const profile = await loadProfile(session.user);
      if (profile) setUser(profile);
    }
  }

  return (
    <AuthContext.Provider value={{
      isAuthenticated: !!user,
      user,
      role: user?.role ?? null,
      loading,
      signIn,
      signUp,
      signOut,
      refreshSession,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
