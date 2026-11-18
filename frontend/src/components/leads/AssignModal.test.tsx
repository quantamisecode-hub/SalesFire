// AssignModal — round-robin assignment over org members (Instantly parity).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssignModal } from "./AssignModal";
import { memberService } from "@/services/members";
import { leadService } from "@/services/lead";

vi.mock("@/services/members", () => ({
  memberService: { list: vi.fn() },
}));
vi.mock("@/services/lead", () => ({
  leadService: { bulkAssign: vi.fn() },
}));

const members = [
  { id: "u1", email: "ann@example.com", fullName: "Ann Owner", role: "owner" },
  { id: "u2", email: "ben@example.com", fullName: "Ben Member", role: "member" },
];

describe("AssignModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(memberService.list).mockResolvedValue(members);
  });

  it("assigns round-robin to the checked members", async () => {
    vi.mocked(leadService.bulkAssign).mockResolvedValue({ data: { assigned: 4, perMember: { u1: 2, u2: 2 } } });
    const onAssigned = vi.fn();
    const onClose = vi.fn();
    render(<AssignModal open onClose={onClose} count={4} leadIds={["l1", "l2", "l3", "l4"]} onAssigned={onAssigned} />);

    // Both members are pre-checked once loaded
    await waitFor(() => expect(screen.getByText("Ann Owner")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^assign$/i }));

    await waitFor(() => expect(leadService.bulkAssign).toHaveBeenCalledWith(["l1", "l2", "l3", "l4"], ["u1", "u2"], undefined));
    expect(onAssigned).toHaveBeenCalledWith(4);
    expect(onClose).toHaveBeenCalled();
  });

  it("unchecking everyone blocks the call with an inline error", async () => {
    render(<AssignModal open onClose={vi.fn()} count={2} leadIds={["l1", "l2"]} />);
    await waitFor(() => expect(screen.getByText("Ann Owner")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: /assign to ann/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /assign to ben/i }));
    fireEvent.click(screen.getByRole("button", { name: /^assign$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/select at least one member/i);
    expect(leadService.bulkAssign).not.toHaveBeenCalled();
  });

  it("surfaces the backend error instead of faking success", async () => {
    vi.mocked(leadService.bulkAssign).mockRejectedValue({ data: { error: "members must belong to this organization" } });
    render(<AssignModal open onClose={vi.fn()} count={1} leadIds={["l1"]} />);
    await waitFor(() => expect(screen.getByText("Ann Owner")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^assign$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/members must belong/i);
  });

  it("failed to load members shows a real error", async () => {
    vi.mocked(memberService.list).mockRejectedValue(new Error("network"));
    render(<AssignModal open onClose={vi.fn()} count={1} leadIds={["l1"]} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to load members/i);
  });
});
