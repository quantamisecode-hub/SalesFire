// MailboxSidebar — Smartlead-style folder rail: sections, counts, selection.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MailboxSidebar, INBOX_FOLDERS } from "./MailboxSidebar";

describe("MailboxSidebar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders MAILBOXES and VIEWS sections with every folder", () => {
    render(<MailboxSidebar value="all" onChange={() => {}} counts={null} />);
    expect(screen.getByText("Mailboxes")).toBeInTheDocument();
    expect(screen.getByText("Views")).toBeInTheDocument();
    for (const folder of INBOX_FOLDERS) {
      expect(screen.getByRole("button", { name: new RegExp(`^${folder.label}`) })).toBeInTheDocument();
    }
  });

  it("splits folders into mailboxes (Inbox/Sent/…) and views (Mine/Needs Reply/…)", () => {
    render(<MailboxSidebar value="all" onChange={() => {}} counts={null} />);
    const nav = screen.getByRole("navigation", { name: /mailboxes/i });
    const labels = [...nav.querySelectorAll("button")].map((b) => b.textContent?.replace(/\d+$/, "").trim());
    expect(labels).toContain("Inbox");
    expect(labels).toContain("Sent");
    expect(labels).toContain("Starred");
    expect(labels).toContain("Archived");
    expect(labels).toContain("Mine");
    expect(labels).toContain("Needs Reply");
    expect(labels).toContain("Closed");
  });

  it("shows live counts as badges and hides zero counts", () => {
    render(
      <MailboxSidebar
        value="all"
        onChange={() => {}}
        counts={{ all: 12, unread: 3, starred: 0, replied: 0, snoozed: 0, archived: 0, mine: 0, needs_reply: 0, assigned: 0, closed: 0 }}
      />
    );
    expect(screen.getByRole("button", { name: /Inbox, 12 conversations/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unread, 3 conversations/ })).toBeInTheDocument();
    // zero-count folders render without a badge in their accessible name
    expect(screen.getByRole("button", { name: "Starred" })).toBeInTheDocument();
  });

  it("selects a folder and reports it via onChange (aria-current on active)", () => {
    const onChange = vi.fn();
    render(<MailboxSidebar value="all" onChange={onChange} counts={null} />);
    const active = screen.getByRole("button", { name: "Inbox" });
    expect(active).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(onChange).toHaveBeenCalledWith("archived");
    expect(screen.getByRole("button", { name: "Archived" })).not.toHaveAttribute("aria-current");
  });

  it("marks the active folder with aria-current", () => {
    render(<MailboxSidebar value="snoozed" onChange={() => {}} counts={null} />);
    expect(screen.getByRole("button", { name: "Snoozed" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Inbox" })).not.toHaveAttribute("aria-current");
  });
});
