// InboxPage — Smartlead Master Inbox layout integration: folder rail, list,
// reading pane; folder selection drives the API filter and URL (?filter=);
// folder counts render as badges.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { InboxPage } from "./InboxPage";
import { inboxService } from "@/services/inbox";
import { ToastProvider } from "@/components/ui/Toast";

vi.mock("@/services/inbox", () => ({
  inboxService: {
    list: vi.fn(),
    get: vi.fn(),
    counts: vi.fn(),
    listMembers: vi.fn(),
    markRead: vi.fn(),
    markUnread: vi.fn(),
    markAllRead: vi.fn(),
    star: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    snooze: vi.fn(),
  },
}));

const conversations = [
  {
    id: "c1", subject: "Quick idea for ProspectCo", status: "needs_reply", unread: 2,
    isStarred: false, isArchived: false, snoozedUntil: null, threadStatus: "matched",
    tags: [], assigneeId: null, assigneeName: null, accountEmail: "sales@myco.test",
    campaignId: "camp1", campaignName: "US Outreach",
    lead: { id: "l1", firstName: "Jane", lastName: "Prospect", companyName: "ProspectCo", email: "jane@prospect.test", status: "contacted" },
    snippet: "This looks interesting…", lastMessageAt: "2026-11-18T10:00:00.000Z",
    createdAt: "2026-11-17T09:00:00.000Z",
  },
];

const LocationProbe = () => {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
};

const renderPage = (initial = "/campaigns/inbox") =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <ToastProvider>
        <Routes>
          <Route path="/campaigns/inbox" element={<><InboxPage /><LocationProbe /></>} />
          <Route path="/campaigns/inbox/:conversationId" element={<><InboxPage /><LocationProbe /></>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );

const mockList = (total = 1) =>
  vi.mocked(inboxService.list).mockResolvedValue({
    data: conversations.slice(0, total),
    pagination: { page: 1, pages: 1, total, pageSize: 25 },
  } as never);

describe("InboxPage — mailbox layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(inboxService.counts).mockResolvedValue({
      data: { all: 7, unread: 2, starred: 1, replied: 0, snoozed: 0, archived: 3, mine: 0, needs_reply: 4, assigned: 1, closed: 0 },
    } as never);
    vi.mocked(inboxService.listMembers).mockResolvedValue({ data: [] } as never);
    vi.mocked(inboxService.get).mockResolvedValue({ data: null } as never);
  });

  it("renders the three mailbox panes: folder rail, conversation list, reading pane", async () => {
    mockList();
    renderPage();
    // folder rail (counts arrive async)
    const nav = await screen.findByRole("navigation", { name: /mailboxes/i });
    expect(nav).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Inbox, 7 conversations/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unread, 2 conversations/ })).toBeInTheDocument();
    // conversation list
    expect(await screen.findByText("Quick idea for ProspectCo")).toBeInTheDocument();
    // reading pane empty state
    expect(screen.getByText("Select a conversation")).toBeInTheDocument();
  });

  it("switching folder calls the API with the folder filter and updates the URL", async () => {
    mockList();
    renderPage();
    await screen.findByText("Quick idea for ProspectCo");
    vi.mocked(inboxService.list).mockClear();
    mockList();
    fireEvent.click(await screen.findByRole("button", { name: /Archived, 3 conversations/ }));
    await waitFor(() =>
      expect(inboxService.list).toHaveBeenCalledWith(expect.objectContaining({ filter: "archived", page: 1 })),
    );
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("?filter=archived"));
  });

  it("honours a deep-linked ?filter= on load", async () => {
    mockList();
    renderPage("/campaigns/inbox?filter=starred");
    await screen.findByText("Quick idea for ProspectCo");
    expect(inboxService.list).toHaveBeenCalledWith(expect.objectContaining({ filter: "starred" }));
    expect(await screen.findByRole("button", { name: /Starred, 1 conversation/ })).toHaveAttribute("aria-current", "true");
  });

  it("passes sort changes to the list API", async () => {
    mockList();
    renderPage();
    await screen.findByText("Quick idea for ProspectCo");
    vi.mocked(inboxService.list).mockClear();
    mockList();
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "unread" } });
    await waitFor(() =>
      expect(inboxService.list).toHaveBeenCalledWith(expect.objectContaining({ sort: "unread" })),
    );
  });

  it("shows list errors with retry", async () => {
    vi.mocked(inboxService.list).mockRejectedValueOnce(new Error("boom"));
    renderPage();
    expect(await screen.findByText("boom")).toBeInTheDocument();
    mockList();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Quick idea for ProspectCo")).toBeInTheDocument();
  });

  it("opens the mobile mailboxes drawer from the header", async () => {
    mockList();
    renderPage();
    await screen.findByText("Quick idea for ProspectCo");
    fireEvent.click(screen.getByRole("button", { name: "Open mailboxes" }));
    // drawer dialog contains its own folder rail
    expect(screen.getByRole("dialog", { name: "Mailboxes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close mailboxes" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Mailboxes" })).not.toBeInTheDocument());
  });
});
