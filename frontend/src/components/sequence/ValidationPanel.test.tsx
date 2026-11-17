// ValidationPanel (§39-§41): issues render click-to-field; a clean sequence
// renders nothing at all.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ValidationPanel } from "./ValidationPanel";
import type { ValidationIssue } from "@/types/sequence";

const issues: ValidationIssue[] = [
  { code: "undefined_variable", field: "body", message: "Step 2 contains an undefined variable {{funding_stage}}", stepId: "s2", variantId: "v1" },
  { code: "malformed_spintax", field: "body", message: "Step 3 has malformed Spintax", stepId: "s3" },
];

describe("ValidationPanel", () => {
  it("renders nothing when there are no issues", () => {
    const { container } = render(<ValidationPanel issues={[]} onJump={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every issue with a readable label", () => {
    render(<ValidationPanel issues={issues} onJump={vi.fn()} />);
    expect(screen.getByText(/2 validation issues/)).toBeInTheDocument();
    expect(screen.getByText("Undefined variable")).toBeInTheDocument();
    expect(screen.getByText("Malformed spintax")).toBeInTheDocument();
    expect(screen.getByText(/funding_stage/)).toBeInTheDocument();
  });

  it("jumps to the field when an issue is clicked", () => {
    const onJump = vi.fn();
    render(<ValidationPanel issues={issues} onJump={onJump} />);
    fireEvent.click(screen.getByText("Step 3 has malformed Spintax"));
    expect(onJump).toHaveBeenCalledWith(issues[1]);
  });
});
