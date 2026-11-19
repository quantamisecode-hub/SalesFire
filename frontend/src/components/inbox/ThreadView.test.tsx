// ThreadView — mailbox reading pane: email cards (not chat), collapse/expand,
// From/To/Date headers, sanitized HTML bodies, attachments, action buttons.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThreadView } from "./ThreadView";
import type { InboxConversationDetail, InboxMessage } from "@/services/inbox";

const msg = (over: Partial<InboxMessage> & { id: string; direction: "inbound" | "outbound" }): InboxMessage => ({
  fromEmail: over.direction === "inbound" ? "jane@prospect.test" : "sales@myco.test",
  fromName: over.direction === "inbound" ? "Jane Prospect" : undefined,
  toEmails: over.direction === "inbound" ? ["sales@myco.test"] : ["jane@prospect.test"],
  subject: "Re: Quick idea",
  textBody: undefined,
  htmlBody: null,
  snippet: undefined,
  sentAt: null,
  receivedAt: "2026-11-18T10:00:00.000Z",
  isRead: true,
  messageType: "HUMAN_REPLY",
  status: "received",
  attachments: [],
  createdAt: "2026-11-18T10:00:00.000Z",
  ...over,
});

const conversation = (messages: InboxMessage[]): InboxConversationDetail => ({
  id: "c1",
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
  lead: null,
  snippet: "sounds interesting",
  lastMessageAt: "2026-11-18T10:00:00.000Z",
  lastInboundAt: "2026-11-18T10:00:00.000Z",
  lastOutboundAt: "2026-11-17T10:00:00.000Z",
  messages,
  insights: [],
});

const baseProps = {
  pendingAction: null as string | null,
  onToggleStar: vi.fn(),
  onToggleArchive: vi.fn(),
  onSnooze: vi.fn(),
  onToggleRead: vi.fn(),
};

describe("ThreadView — mailbox (not chat) rendering", () => {
  beforeEach(() => vi.clearAllMocks());

  const twoMessages = [
    msg({ id: "m1", direction: "outbound", textBody: "Hi Jane — quick idea. Are you free Thursday?", snippet: "Hi Jane — quick idea.", sentAt: "2026-11-17T10:00:00.000Z", receivedAt: null }),
    msg({ id: "m2", direction: "inbound", textBody: "This looks interesting — tell me more.", snippet: "This looks interesting — tell me more." }),
  ];

  it("renders every message as a full-width email card (not a chat stream)", () => {
    const { container } = render(<ThreadView conversation={conversation(twoMessages)} {...baseProps} />);
    expect(screen.getByTestId("email-thread")).toBeInTheDocument();
    const cards = screen.getAllByTestId("email-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("data-direction", "outbound");
    expect(cards[1]).toHaveAttribute("data-direction", "inbound");
    // block-level cards in a single column (mailbox style) with the sender in
    // the card header — not side-by-side avatar bubble rows
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="email-thread"] > li')).toBe(cards[0]);
  });

  it("shows From (name + address), To recipients and a date on expanded cards", () => {
    render(<ThreadView conversation={conversation(twoMessages)} {...baseProps} />);
    // newest message is expanded by default
    expect(screen.getByText("Jane Prospect")).toBeInTheDocument();
    expect(screen.getByText("<jane@prospect.test>")).toBeInTheDocument();
    expect(screen.getByText("To:")).toBeInTheDocument();
    // To: recipient + header account email both show this address
    expect(screen.getAllByText("sales@myco.test").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/This looks interesting/)).toBeInTheDocument();
  });

  it("collapses earlier messages to a one-line preview and expands on click", () => {
    render(<ThreadView conversation={conversation(twoMessages)} {...baseProps} />);
    // m1 starts collapsed: its body is hidden (preview snippet shows instead),
    // while m2 (newest) is open
    expect(screen.queryByText(/Are you free Thursday/)).toBeNull();
    const expanders = screen.getAllByRole("button", { name: /Expand message/i });
    expect(expanders).toHaveLength(1);
    fireEvent.click(expanders[0]);
    expect(screen.getByText(/Are you free Thursday/)).toBeVisible();
    expect(screen.getByRole("button", { name: /Collapse message from You/i })).toBeInTheDocument();
  });

  it("starts unread inbound messages expanded", () => {
    const msgs = [
      msg({ id: "m1", direction: "outbound", textBody: "Outreach", snippet: "Outreach", sentAt: "2026-11-17T10:00:00.000Z", receivedAt: null }),
      msg({ id: "m2", direction: "inbound", isRead: false, textBody: "Unread reply", snippet: "Unread reply" }),
    ];
    render(<ThreadView conversation={conversation(msgs)} {...baseProps} />);
    expect(screen.getByText("Unread reply")).toBeVisible();
  });

  it("renders HTML bodies sanitized (script tags stripped)", () => {
    const msgs = [msg({ id: "m1", direction: "inbound", htmlBody: '<p>Hello <strong>there</strong></p><script>alert(1)</script>' })];
    const { container } = render(<ThreadView conversation={conversation(msgs)} {...baseProps} />);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("there")).toBeInTheDocument();
    expect(container.innerHTML).toContain("Hello");
  });

  it("renders attachments as chips and auto-reply message type badges", () => {
    const msgs = [msg({
      id: "m1", direction: "inbound",
      attachments: [{ filename: "proposal.pdf", contentType: "application/pdf", size: 2048 }],
      messageType: "AUTO_REPLY",
    })];
    render(<ThreadView conversation={conversation(msgs)} {...baseProps} />);
    expect(screen.getByText("proposal.pdf")).toBeInTheDocument();
    expect(screen.getByText(/\(2 KB\)/)).toBeInTheDocument();
    expect(screen.getByText("AUTO REPLY")).toBeInTheDocument();
  });

  it("wires header actions to their handlers", () => {
    render(<ThreadView conversation={conversation(twoMessages)} {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Star" }));
    expect(baseProps.onToggleStar).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(baseProps.onToggleArchive).toHaveBeenCalledTimes(1);
    // unread = 0 → toggle back to unread
    fireEvent.click(screen.getByRole("button", { name: "Mark as unread" }));
    expect(baseProps.onToggleRead).toHaveBeenCalledTimes(1);
  });

  it("shows thread subject, campaign and needs-review state", () => {
    const c = conversation(twoMessages);
    c.threadStatus = "needs_review";
    render(<ThreadView conversation={c} {...baseProps} />);
    expect(screen.getByRole("heading", { name: "Quick idea for ProspectCo" })).toBeInTheDocument();
    expect(screen.getByText("US Outreach")).toBeInTheDocument();
    expect(screen.getByText("Thread needs review")).toBeInTheDocument();
  });
});
