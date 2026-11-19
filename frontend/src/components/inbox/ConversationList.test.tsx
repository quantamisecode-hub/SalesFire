// ConversationList — mailbox list pane: rows, search, sort, pagination, states.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ConversationList, type InboxSort } from "./ConversationList";
import type { InboxConversationListItem } from "@/services/inbox";

const conv = (over: Partial<InboxConversationListItem> & { id: string }): InboxConversationListItem => ({
  subject: "Quick idea for ProspectCo",
  status: "needs_reply",
  unread: 0,
  isStarred: false,
  isArchived: false,
  snoozedUntil: null,
  threadStatus: "matched",
  tags: [],
  assigneeId: null,
  assigneeName: null,
  accountEmail: "sales@myco.test",
  campaignId: "camp1",
  campaignName: "US Outreach",
  lead: { id: "l1", firstName: "Jane", lastName: "Prospect", companyName: "ProspectCo", email: "jane@prospect.test", status: "contacted" },
  snippet: "This looks interesting…",
  lastMessageAt: "2026-11-18T10:00:00.000Z",
  ...over,
});

const base = {
  selectedId: null as string | null,
  onSelect: vi.fn(),
  search: "",
  onSearchChange: vi.fn(),
  sort: "last_message_at" as InboxSort,
  onSortChange: vi.fn(),
  page: 1, pages: 3, total: 61,
  onPageChange: vi.fn(),
  isLoading: false,
  error: null as string | null,
  onRetry: vi.fn(),
};

describe("ConversationList", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders conversation rows with sender, subject, snippet, campaign and time", () => {
    render(<ConversationList conversations={[conv({ id: "c1" }), conv({ id: "c2", subject: "Re: pricing", unread: 2, lead: null, snippet: "Following up on my last note…", campaignName: "EMEA Launch" })]} {...base} />);
    expect(screen.getByText("Jane Prospect")).toBeInTheDocument();
    expect(screen.getByText("Quick idea for ProspectCo")).toBeInTheDocument();
    expect(screen.getByText("This looks interesting…")).toBeInTheDocument();
    expect(screen.getByText("US Outreach")).toBeInTheDocument();
    // second row has no lead — falls back to Unknown sender, unread badge
    expect(screen.getByText("Unknown sender")).toBeInTheDocument();
    expect(screen.getByText("Re: pricing")).toBeInTheDocument();
    expect(screen.getByText("EMEA Launch")).toBeInTheDocument();
    expect(screen.getByLabelText("2 unread")).toBeInTheDocument();
  });

  it("search input reports through onSearchChange", () => {
    render(<ConversationList conversations={[]} {...base} />);
    fireEvent.change(screen.getByLabelText("Search conversations"), { target: { value: "acme" } });
    expect(base.onSearchChange).toHaveBeenCalledWith("acme");
  });

  it("sort select reports Smartlead-style sort orders", () => {
    render(<ConversationList conversations={[]} {...base} />);
    const select = screen.getByLabelText("Sort");
    fireEvent.change(select, { target: { value: "unread" } });
    expect(base.onSortChange).toHaveBeenCalledWith("unread");
    fireEvent.change(select, { target: { value: "oldest" } });
    expect(base.onSortChange).toHaveBeenCalledWith("oldest");
  });

  it("marks the selected row with aria-selected", () => {
    render(<ConversationList conversations={[conv({ id: "c1" }), conv({ id: "c2" })]} {...base} selectedId="c2" />);
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  it("wires row clicks and pagination", () => {
    render(<ConversationList conversations={[conv({ id: "c1" })]} {...base} />);
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option"));
    expect(base.onSelect).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(base.onPageChange).toHaveBeenCalledWith(2);
    expect(screen.getByText("Page 1/3")).toBeInTheDocument();
    expect(screen.getByText("61 conversations")).toBeInTheDocument();
  });

  it("shows loading skeletons while fetching", () => {
    render(<ConversationList conversations={[]} {...base} isLoading />);
    expect(screen.getByLabelText("Loading conversations")).toBeInTheDocument();
  });

  it("shows an honest empty state", () => {
    render(<ConversationList conversations={[]} {...base} />);
    expect(screen.getByText("No conversations yet.")).toBeInTheDocument();
  });

  it("shows a distinct no-match state when searching", () => {
    render(<ConversationList conversations={[]} {...base} search="zzz" />);
    expect(screen.getByText("No conversations match these filters.")).toBeInTheDocument();
  });

  it("shows errors with a retry that calls onRetry", () => {
    render(<ConversationList conversations={[]} {...base} error="Unable to load conversations." />);
    expect(screen.getByText("Unable to load conversations.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(base.onRetry).toHaveBeenCalledTimes(1);
  });
});
