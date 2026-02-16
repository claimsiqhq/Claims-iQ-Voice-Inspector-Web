import type { Request, Response, NextFunction } from "express";

/**
 * Default test user (adjuster role).
 */
export const defaultTestUser = {
  id: "user-1",
  email: "adjuster@test.com",
  role: "adjuster",
  fullName: "Test Adjuster",
  supabaseAuthId: "supa-auth-123",
};

/**
 * Admin test user.
 */
export const adminTestUser = {
  id: "admin-1",
  email: "admin@test.com",
  role: "admin",
  fullName: "Test Admin",
  supabaseAuthId: "supa-auth-admin",
};

/**
 * Mock authenticateRequest that injects a test user.
 */
export function mockAuthMiddleware(user = defaultTestUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = user;
    next();
  };
}

/**
 * Mock requireRole that always passes.
 */
export function mockRequireRole(..._roles: string[]) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    next();
  };
}
