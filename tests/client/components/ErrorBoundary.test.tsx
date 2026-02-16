/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "../../../client/src/components/ErrorBoundary";

const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) throw new Error("Test error");
  return <div>No error</div>;
};

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Child content</div>
      </ErrorBoundary>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("renders full-page fallback when child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("error-boundary-fallback")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload page/i })).toBeInTheDocument();
  });

  it("renders custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom error message</div>}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("custom-fallback")).toBeInTheDocument();
    expect(screen.getByText("Custom error message")).toBeInTheDocument();
  });

  it("renders inline fallback when inline prop is true", () => {
    render(
      <ErrorBoundary inline>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("retry button is present and clickable", () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    const tryAgainBtn = screen.getByRole("button", { name: /try again/i });
    expect(tryAgainBtn).toBeInTheDocument();
    fireEvent.click(tryAgainBtn);
    // After retry, child re-mounts and throws again; fallback still shown
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
