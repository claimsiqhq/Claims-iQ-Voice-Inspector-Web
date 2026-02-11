import { vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Suppress console.error in tests (routes.ts logs every caught error)
vi.spyOn(console, "error").mockImplementation(() => {});
