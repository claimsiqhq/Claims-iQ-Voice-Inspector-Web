/**
 * Lightweight input sanitization for string fields.
 * Zod handles type validation; this handles content safety.
 */

export function sanitizeString(input: string): string {
  return input.replace(/\0/g, "");
}

export function sanitizeBody<T extends Record<string, any>>(body: T): T {
  const sanitized = { ...body };
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === "string") {
      (sanitized as any)[key] = sanitizeString(value);
    }
  }
  return sanitized;
}

export function parseId(param: string): number | null {
  const id = parseInt(param, 10);
  if (isNaN(id) || id <= 0 || id > 2_147_483_647) return null;
  return id;
}
