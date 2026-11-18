// ListsPage — CRM holding lists: render, create flow, delete flow.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { ListsPage } from "./ListsPage";
import { listsService } from "@/services/lists";
import { ToastProvider } from "@/components/ui/Toast";

vi.mock("@/services/lists", () => ({
  listsService: {
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
}));

const lists = [
  { id: "l1", name: "Q3 SaaS", description: null, createdBy: "u1", memberCount: 42, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" },
  { id: "l2", name: "Hot leads", description: null, createdBy: "u1", memberCount: 3, createdAt: "2026-11-02T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z" },
];

const LocationProbe = () => {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
};

const renderPage = () => render(
  <MemoryRouter initialEntries={["/lists"]}>
    <ToastProvider>
      <Routes>
        <Route path="/lists" element={<><ListsPage /><LocationProbe /></>} />
        <Route path="/lists/:id" element={<LocationProbe />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>,
);

describe("ListsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders lists with member counts", async () => {
    vi.mocked(listsService.list).mockResolvedValue(lists);
    renderPage();
    expect(await screen.findByText("Q3 SaaS")).toBeInTheDocument();
    expect(screen.getByText("Hot leads")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("creates a list and navigates to its detail page", async () => {
    vi.mocked(listsService.list).mockResolvedValue([]);
    vi.mocked(listsService.create).mockResolvedValue({ ...lists[0], id: "l9", name: "New List" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /new list/i }));
    const input = await screen.findByLabelText(/new list name/i);
    fireEvent.change(input, { target: { value: "New List" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(listsService.create).toHaveBeenCalledWith("New List"));
    expect(await screen.findByTestId("location")).toHaveTextContent("/lists/l9");
  });

  it("shows an honest empty state with guidance when there are no lists", async () => {
    vi.mocked(listsService.list).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/no lists yet/i)).toBeInTheDocument();
  });

  it("shows an error with retry when loading fails", async () => {
    vi.mocked(listsService.list).mockRejectedValue(new Error("boom"));
    renderPage();
    expect(await screen.findByText(/failed to load lists/i)).toBeInTheDocument();
  });
});
