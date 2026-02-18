import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { supabase } from "./supabaseClient";
import { enqueueMutation } from "./offlineQueue";

const LOCAL_TOKEN_KEY = "claimsiq_local_token";

export function getLocalToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LOCAL_TOKEN_KEY) || sessionStorage.getItem(LOCAL_TOKEN_KEY);
}

export function setLocalToken(token: string, rememberMe: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LOCAL_TOKEN_KEY);
  sessionStorage.removeItem(LOCAL_TOKEN_KEY);
  if (rememberMe) {
    localStorage.setItem(LOCAL_TOKEN_KEY, token);
  } else {
    sessionStorage.setItem(LOCAL_TOKEN_KEY, token);
  }
}

export function clearLocalToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LOCAL_TOKEN_KEY);
  sessionStorage.removeItem(LOCAL_TOKEN_KEY);
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const localToken = getLocalToken();
  if (localToken) {
    headers["Authorization"] = `Bearer ${localToken}`;
    return headers;
  }
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    } catch {}
  }
  return headers;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const headers: Record<string, string> = {
    ...authHeaders,
    ...(data ? { "Content-Type": "application/json" } : {}),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

/**
 * Wrapper around apiRequest that queues mutations when offline.
 * Use this for non-critical mutations that can be safely retried.
 */
export async function resilientMutation(
  method: string,
  url: string,
  data?: unknown,
  options?: {
    /** Human-readable label for the queue UI */
    label?: string;
    /** Max retries if request fails (default: 5) */
    maxRetries?: number;
    /** If true, never queue — always throw on failure */
    skipQueue?: boolean;
  }
): Promise<Response> {
  try {
    return await apiRequest(method, url, data);
  } catch (err: unknown) {
    if (typeof navigator === "undefined" || navigator.onLine || options?.skipQueue) {
      throw err;
    }

    const authHeaders = await getAuthHeaders();
    await enqueueMutation({
      method,
      url,
      body: data,
      headers: authHeaders,
      maxRetries: options?.maxRetries ?? 5,
      label: options?.label || `${method} ${url}`,
    });

    return new Response(
      JSON.stringify({ queued: true, message: "Saved offline — will sync when connected" }),
      { status: 202, headers: { "Content-Type": "application/json" } }
    );
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const authHeaders = await getAuthHeaders();
    const url = queryKey.join("/") as string;
    let res = await fetch(url, {
      credentials: "include",
      headers: authHeaders,
    });

    if (res.status === 401 && authHeaders["Authorization"]) {
      const freshHeaders = await getAuthHeaders();
      if (freshHeaders["Authorization"] && freshHeaders["Authorization"] !== authHeaders["Authorization"]) {
        res = await fetch(url, {
          credentials: "include",
          headers: freshHeaders,
        });
      }
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60_000,
      retry: (failureCount, error) => {
        if (failureCount >= 3) return false;
        const msg = error instanceof Error ? error.message : "";
        if (msg.startsWith("401:")) return failureCount < 2;
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    },
    mutations: {
      retry: false,
    },
  },
});
