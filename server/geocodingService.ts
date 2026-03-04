import { logger } from "./logger";

interface GeocodingResult {
  latitude: number;
  longitude: number;
  displayName: string;
}

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "ClaimsIQ/1.0";
const RATE_LIMIT_MS = 1100;

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
}

export async function geocodeAddress(
  address: string,
  city?: string | null,
  state?: string | null,
  zip?: string | null,
): Promise<GeocodingResult | null> {
  const parts = [address, city, state, zip].filter(Boolean);
  if (parts.length === 0) return null;

  const q = parts.join(", ");
  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`;

  try {
    const res = await rateLimitedFetch(url);
    if (!res.ok) {
      logger.warn(`Nominatim returned ${res.status} for query: ${q}`);
      return null;
    }

    const data = await res.json() as Array<{ lat: string; lon: string; display_name: string }>;
    if (!data || data.length === 0) {
      logger.info(`No geocoding results for: ${q}`);
      return null;
    }

    const result = data[0];
    return {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      displayName: result.display_name,
    };
  } catch (error: any) {
    logger.error(`Geocoding error for "${q}": ${error.message}`);
    return null;
  }
}

export async function geocodeClaimAddress(claim: {
  propertyAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): Promise<{ latitude: number; longitude: number } | null> {
  if (!claim.propertyAddress && !claim.city && !claim.zip) return null;

  const result = await geocodeAddress(
    claim.propertyAddress || "",
    claim.city,
    claim.state,
    claim.zip,
  );

  if (!result) return null;
  return { latitude: result.latitude, longitude: result.longitude };
}
