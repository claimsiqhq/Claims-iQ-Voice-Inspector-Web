import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const LOCAL_TOKEN_KEY = "claimsiq_local_token";
const REMEMBER_ME_KEY = "claimsiq_remember_me";

export const API_BASE =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  process.env.EXPO_PUBLIC_API_URL ??
  "http://localhost:5000";

export async function getLocalToken(): Promise<string | null> {
  return AsyncStorage.getItem(LOCAL_TOKEN_KEY);
}

export async function setLocalToken(token: string, rememberMe: boolean): Promise<void> {
  await AsyncStorage.multiRemove([LOCAL_TOKEN_KEY]);
  await AsyncStorage.setItem(LOCAL_TOKEN_KEY, token);
  await AsyncStorage.setItem(REMEMBER_ME_KEY, rememberMe ? "true" : "false");
}

export async function clearLocalToken(): Promise<void> {
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
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  return res;
}
