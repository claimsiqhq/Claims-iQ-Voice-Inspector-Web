import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, SUPABASE_URL, callEdgeFunction } from "./supabase";

const LOCAL_TOKEN_KEY = "claimsiq_local_token";
const REMEMBER_ME_KEY = "claimsiq_remember_me";

export const API_BASE = SUPABASE_URL;

export async function getLocalToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) return session.access_token;
  return AsyncStorage.getItem(LOCAL_TOKEN_KEY);
}

export async function setLocalToken(token: string, rememberMe: boolean): Promise<void> {
  await AsyncStorage.setItem(LOCAL_TOKEN_KEY, token);
  await AsyncStorage.setItem(REMEMBER_ME_KEY, rememberMe ? "true" : "false");
}

export async function clearLocalToken(): Promise<void> {
  await supabase.auth.signOut();
  await AsyncStorage.multiRemove([LOCAL_TOKEN_KEY, REMEMBER_ME_KEY]);
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getLocalToken();
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

export async function apiRequest(
  method: string,
  path: string,
  data?: unknown
): Promise<Response> {
  const token = await getLocalToken();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
  const url = `${SUPABASE_URL}/rest/v1${path}`;

  const headers: Record<string, string> = {
    apikey: anonKey,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(data ? { "Content-Type": "application/json" } : {}),
    Prefer: method === "POST" ? "return=representation" : "return=minimal",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  return res;
}

export { callEdgeFunction };
