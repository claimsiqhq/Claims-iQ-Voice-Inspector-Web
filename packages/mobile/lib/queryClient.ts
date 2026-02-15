import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getAuthHeaders, API_BASE } from "./api";

async function throwIfNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
}

export const getQueryFn: QueryFunction<unknown> = async ({ queryKey }) => {
  const path = Array.isArray(queryKey) ? queryKey.join("") : String(queryKey);
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = await getAuthHeaders();
  const res = await fetch(url, { headers });
  if (res.status === 401) throw new Error("Unauthorized");
  await throwIfNotOk(res);
  return res.json();
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn,
      staleTime: 5 * 60_000,
      retry: 2,
    },
  },
});
