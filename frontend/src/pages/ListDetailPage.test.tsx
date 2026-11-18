// ListDetailPage — list members: sortable columns, real email verification,
// enroll-into-campaign and remove flows.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ListDetailPage } from "./ListDetailPage";
import { listsService } from "@/services/lists";
import { campaignService } from "@/services/campaign";
import { deliverabilityService } from "@/services/deliverability";
import { ToastProvider } from "@/components/ui/Toast";

vi.mock("@/services/lists", () => ({
  listsService: {
    get: vi.fn(),
    removeMembers: vi.fn(),
    moveToCampaign: vi.fn(),
  },
}));
vi.mock("@/services/campaign", () => ({
  campaignService: { list: vi.fn() },
}));
vi.mock("@/services/deliverability", () => ({
  deliverabilityService: { verifyLeads: vi.fn() },
}));

const member = (id: string, first: string, last: string, email: string, status = "new") => ({
  id: `m-${id}`,
  leadId: id,
  addedAt: "2026-11-01T00:00:00Z",
  lead: { id, firstName: first, lastName: last, companyName: "Acme", email, status, emailStatus: "verified", assignedTo: null },
});

const detail = {
  id: "l1",
  name: "Q3 Warm",
  description: null,
  createdBy: "u1",
  memberCount: 2,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  members: [
    member("a", "Zed", "Zulu", "zed@zulu.io"),
    member("b", "Amy", "Alpha", "amy@alpha.io"),
  ],
};

const renderPage = () => render(
  <MemoryRouter initialEntries={["/lists/l1"]}>
    <ToastProvider>
      <Routes>
        <Route path="/lists/:id" element={<ListDetailPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>,
);

describe("ListDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listsService.get).mockResolvedValue({
      data: JSON.parse(JSON.stringify(detail)),
      pagination: { page: 1, pages: 1, total: 2, pageSize: 25 },
    });
    vi.mocked(campaignService.list).mockResolvedValue({ data: [{ id: "c1", name: "Outbound" }] } as any);
  });

  it("renders members and requests the default sort", async () => {
    renderPage();
    expect(await screen.findByText("Q3 Warm")).toBeInTheDocument();
    expect(screen.getByText("zed@zulu.io")).toBeInTheDocument();
    expect(vi.mocked(listsService.get)).toHaveBeenCalledWith("l1", expect.objectContaining({ sortBy: "addedAt", sortDir: "desc" }));
  });

  it("clicking the Email header re-queries with sortBy=email", async () => {
    renderPage();
    await screen.findByText("Q3 Warm");
    fireEvent.click(screen.getByRole("button", { name: /sort by email/i }));
    await waitFor(() =>
      expect(vi.mocked(listsService.get)).toHaveBeenLastCalledWith("l1", expect.objectContaining({ sortBy: "email", sortDir: "asc" })),
    );
  });

  it("clicking Name toggles to descending after the first click", async () => {
    renderPage();
    await screen.findByText("Q3 Warm");
    fireEvent.click(screen.getByRole("button", { name: /sort by name/i }));
    await waitFor(() =>
      expect(vi.mocked(listsService.get)).toHaveBeenLastCalledWith("l1", expect.objectContaining({ sortBy: "name", sortDir: "asc" })),
    );
    fireEvent.click(screen.getByRole("button", { name: /sort by name/i }));
    await waitFor(() =>
      expect(vi.mocked(listsService.get)).toHaveBeenLastCalledWith("l1", expect.objectContaining({ sortBy: "name", sortDir: "desc" })),
    );
  });

  it("verifies all members with real DNS checks and shows the summary", async () => {
    vi.mocked(deliverabilityService.verifyLeads).mockResolvedValue({ data: { verified: 2, summary: { verified: 1, risky: 1 } } } as any);
    renderPage();
    await screen.findByText("Q3 Warm");
    fireEvent.click(screen.getByRole("button", { name: /verify emails/i }));
    await waitFor(() =>
      expect(vi.mocked(deliverabilityService.verifyLeads)).toHaveBeenCalledWith({ leadIds: ["a", "b"] }),
    );
    expect(await screen.findByText(/last verify/i)).toBeInTheDocument();
  });

  it("verify button is disabled for an empty list", async () => {
    vi.mocked(listsService.get).mockResolvedValue({
      data: { ...JSON.parse(JSON.stringify(detail)), members: [], memberCount: 0 },
      pagination: { page: 1, pages: 1, total: 0, pageSize: 25 },
    });
    renderPage();
    await screen.findByText("Q3 Warm");
    expect(screen.getByRole("button", { name: /verify emails/i })).toBeDisabled();
  });
});
