import React, { createContext, useContext, useState, useEffect } from "react";
import { router } from "expo-router";
import {
  getLocalToken,
  setLocalToken,
  clearLocalToken,
  API_BASE,
} from "@/lib/api";

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

  async function fetchUserProfile(): Promise<AuthUser | null> {
    const token = await getLocalToken();
    if (!token) return null;
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getLocalToken();
      if (!token) {
        setLoading(false);
        return;
      }
      const profile = await fetchUserProfile();
      if (!cancelled && profile) setUser(profile);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn(
    emailOrUsername: string,
    password: string,
    rememberMe = true
  ): Promise<void> {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emailOrUsername: emailOrUsername.trim(),
        password,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? "Invalid email/username or password");
    }
    const { token, user: profile } = await res.json();
    await setLocalToken(token, rememberMe);
    setUser(profile);
    router.replace("/(tabs)");
  }

  async function signUp(
    email: string,
    password: string,
    fullName: string,
    username?: string
  ): Promise<void> {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username || email.split("@")[0],
        email: email || undefined,
        password,
        fullName: fullName || undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? "Registration failed");
    }
    const { token, user: profile } = await res.json();
    await setLocalToken(token, true);
    setUser(profile);
    router.replace("/(tabs)");
  }

  async function signOut(): Promise<void> {
    await clearLocalToken();
    setUser(null);
    router.replace("/login");
  }

  async function refreshSession(): Promise<void> {
    const profile = await fetchUserProfile();
    if (profile) setUser(profile);
  }

  const value: AuthContextType = {
    isAuthenticated: !!user,
    user,
    role: user?.role ?? null,
    loading,
    signIn,
    signUp,
    signOut,
    refreshSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
