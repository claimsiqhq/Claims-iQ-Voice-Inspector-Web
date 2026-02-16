/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, PerilBadge } from "../../../client/src/components/StatusBadge";

describe("StatusBadge", () => {
  it("renders Draft status with correct label", () => {
    render(<StatusBadge status="draft" />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("renders Inspecting status with correct label", () => {
    render(<StatusBadge status="inspecting" />);
    expect(screen.getByText("Inspecting")).toBeInTheDocument();
  });

  it("renders Complete status with correct label", () => {
    render(<StatusBadge status="complete" />);
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("renders unknown status as-is", () => {
    render(<StatusBadge status="custom_status" />);
    expect(screen.getByText("custom_status")).toBeInTheDocument();
  });

  it("normalizes status with spaces to underscores", () => {
    render(<StatusBadge status="documents uploaded" />);
    expect(screen.getByText("Uploaded")).toBeInTheDocument();
  });
});

describe("PerilBadge", () => {
  it("renders hail peril with capitalized display", () => {
    render(<PerilBadge peril="hail" />);
    expect(screen.getByText("Hail")).toBeInTheDocument();
  });

  it("renders wind peril", () => {
    render(<PerilBadge peril="wind" />);
    expect(screen.getByText("Wind")).toBeInTheDocument();
  });

  it("renders unknown peril with capitalized first letter", () => {
    render(<PerilBadge peril="earthquake" />);
    expect(screen.getByText("Earthquake")).toBeInTheDocument();
  });
});
