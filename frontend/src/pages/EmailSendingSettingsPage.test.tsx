// EmailSendingSettingsPage — SalesBlink-style status tabs + search over the
// mailbox list, and launching the Add mailbox wizard.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { EmailSendingSettingsPage } from "./EmailSendingSettingsPage";
import { emailSendingService } from "@/services/emailSending";
import { inboxService } from "@/services/inbox";
import { signatureService } from "@/services/signature";
import { ToastProvider } from "@/components/ui/Toast";
import type { SmtpAccount } from "@/types/prompt6";

vi.mock("@/services/emailSending", () => ({
  emailSendingService: {
    listAccounts: vi.fn(),
    getOverview: vi.fn(),
    getUsage: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    deleteAccount: vi.fn(),
    pauseAccount: vi.fn(),
    resumeAccount: vi.fn(),
    testConnection: vi.fn(),
    sendTestEmail: vi.fn(),
  },
}));
vi.mock("@/services/inbox", () => ({
  inboxService: { syncStatus: vi.fn(), triggerSync: vi.fn() },
}));
vi.mock("@/services/signature", () => ({
  signatureService: { list: vi.fn() },
}));
vi.mock("@/components/WarmupPanel", () => ({ WarmupPanel: () => null }));

const acct = (over: Partial<SmtpAccount> & { id: string; fromEmail: string }): SmtpAccount => ({
  name: over.fromEmail.split("@")[0],
  smtpHost: "smtp.example.test",
  smtpPort: 587,
  security: "tls",
  hasPassword: true,
  isEnabled: true,
  status: "verified",
  healthStatus: "healthy",
  warmupStatus: "not_started",
  ...over,
  createdAt: over.createdAt ?? "2026-11-01T00:00:00.000Z",
});

// 1 ready, 1 with error, 1 paused, 1 warming
const accounts: SmtpAccount[] = [
  acct({ id: "a1", fromEmail: "ready@acme.test" }),
  acct({ id: "a2", fromEmail: "broken@acme.test", status: "error", healthStatus: "critical" }),
  acct({ id: "a3", fromEmail: "paused@acme.test", isEnabled: false, status: "unverified", healthStatus: "unknown" }),
  acct({ id: "a4", fromEmail: "warming@acme.test", warmupStatus: "active" }),
];

const renderPage = () =>
  render(
    <ToastProvider>
      <EmailSendingSettingsPage />
    </ToastProvider>,
  );

const stubServices = () => {
  vi.mocked(emailSendingService.listAccounts).mockResolvedValue({ success: true, data: accounts });
  vi.mocked(emailSendingService.getOverview).mockResolvedValue({
    success: true,
    data: {
      totalAccounts: 4, activeAccounts: 3, accountsWithErrors: 1,
      emailsSentToday: 12, remainingCapacityToday: 48, bounces: 0, replies: 2, failedSends: 1,
    },
  });
  vi.mocked(inboxService.syncStatus).mockResolvedValue({ data: [] });
  vi.mocked(signatureService.list).mockResolvedValue({ success: true, data: [] });
};

describe("EmailSendingSettingsPage — status tabs + search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders all mailboxes under the All tab with per-tab counts", async () => {
    stubServices();
    renderPage();
    expect(await screen.findByText("ready@acme.test")).toBeInTheDocument();

    const tabs = within(screen.getByTestId("account-tabs"));
    expect(tabs.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
    expect(tabs.getByRole("tab", { name: /Ready for outreach/ })).toBeInTheDocument();
    expect(tabs.getByRole("tab", { name: /Has error/ })).toBeInTheDocument();
    expect(tabs.getByRole("tab", { name: /Paused/ })).toBeInTheDocument();
    expect(tabs.getByRole("tab", { name: /Warmup active/ })).toBeInTheDocument();
    // counts are real: 4 total, 1 error, 1 paused, 1 warming
    expect(tabs.getByRole("tab", { name: /Has error\s*1/ })).toBeInTheDocument();
    expect(tabs.getByRole("tab", { name: /Paused\s*1/ })).toBeInTheDocument();
    expect(tabs.getByRole("tab", { name: /Warmup active\s*1/ })).toBeInTheDocument();
    expect(screen.getByText("warming@acme.test")).toBeInTheDocument();
  });

  it("filters rows by status tab", async () => {
    stubServices();
    renderPage();
    await screen.findByText("ready@acme.test");

    fireEvent.click(screen.getByRole("tab", { name: /Has error/ }));
    await waitFor(() => {
      expect(screen.getByText("broken@acme.test")).toBeInTheDocument();
      expect(screen.queryByText("ready@acme.test")).not.toBeInTheDocument();
      expect(screen.queryByText("paused@acme.test")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: /Has error/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: /Warmup active/ }));
    await waitFor(() => {
      expect(screen.getByText("warming@acme.test")).toBeInTheDocument();
      expect(screen.queryByText("broken@acme.test")).not.toBeInTheDocument();
    });
  });

  it("search narrows rows across name and address", async () => {
    stubServices();
    renderPage();
    await screen.findByText("ready@acme.test");

    fireEvent.change(screen.getByLabelText("Search sending accounts"), { target: { value: "warming" } });
    await waitFor(() => {
      expect(screen.getByText("warming@acme.test")).toBeInTheDocument();
      expect(screen.queryByText("ready@acme.test")).not.toBeInTheDocument();
    });
  });

  it("shows a clear-filters empty state when nothing matches", async () => {
    stubServices();
    renderPage();
    await screen.findByText("ready@acme.test");

    fireEvent.change(screen.getByLabelText("Search sending accounts"), { target: { value: "no-such-mailbox" } });
    expect(await screen.findByTestId("accounts-empty-filter")).toHaveTextContent(
      /No mailboxes match these filters/i,
    );

    fireEvent.click(screen.getByRole("button", { name: /Clear filters/i }));
    await waitFor(() => expect(screen.getByText("ready@acme.test")).toBeInTheDocument());
    expect(screen.getByLabelText("Search sending accounts")).toHaveValue("");
  });

  it("combines tab + search (search applies within the selected tab)", async () => {
    stubServices();
    renderPage();
    await screen.findByText("ready@acme.test");

    fireEvent.click(screen.getByRole("tab", { name: /Paused/ }));
    await waitFor(() => expect(screen.getByText("paused@acme.test")).toBeInTheDocument());

    // searching an address outside the Paused tab yields the empty state
    fireEvent.change(screen.getByLabelText("Search sending accounts"), { target: { value: "ready@" } });
    expect(await screen.findByTestId("accounts-empty-filter")).toBeInTheDocument();
    expect(screen.queryByText("ready@acme.test")).not.toBeInTheDocument();
  });

  it("Add Sending Account opens the mailbox wizard", async () => {
    stubServices();
    renderPage();
    await screen.findByText("ready@acme.test");

    fireEvent.click(screen.getByRole("button", { name: /Add Sending Account/i }));
    const dialog = await screen.findByRole("dialog", { name: "Add sending account" });
    expect(within(dialog).getByText("Add a mailbox")).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: /google workspace/i })).toBeInTheDocument();
  });
});

describe("EmailSendingSettingsPage — filter chips + first-run empty state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a removable status chip when a non-default tab is active", async () => {
    stubServices();
    renderPage();
    await screen.findByText("ready@acme.test");

    expect(screen.queryByTestId("account-filter-chips")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Has error/ }));
    const chips = await screen.findByTestId("account-filter-chips");
    expect(chips).toHaveTextContent("Status: Has error");

    fireEvent.click(within(chips).getByRole("button", { name: "Remove filter Status: Has error" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
      expect(screen.queryByTestId("account-filter-chips")).not.toBeInTheDocument();
    });
  });

  it("shows a search chip and Clear all resets tab + search together", async () => {
    stubServices();
    renderPage();
    await screen.findByText("ready@acme.test");

    fireEvent.click(screen.getByRole("tab", { name: /Paused/ }));
    fireEvent.change(screen.getByLabelText("Search sending accounts"), { target: { value: "quantam" } });

    const chips = await screen.findByTestId("account-filter-chips");
    expect(chips).toHaveTextContent("Status: Paused");
    expect(chips).toHaveTextContent("Search: quantam");

    fireEvent.click(within(chips).getByRole("button", { name: "Clear all" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByLabelText("Search sending accounts")).toHaveValue("");
      expect(screen.queryByTestId("account-filter-chips")).not.toBeInTheDocument();
      expect(screen.getByText("ready@acme.test")).toBeInTheDocument();
    });
  });

  it("keeps chips visible above the no-match empty state", async () => {
    stubServices();
    renderPage();
    await screen.findByText("ready@acme.test");

    fireEvent.change(screen.getByLabelText("Search sending accounts"), { target: { value: "ghost@example.test" } });
    expect(await screen.findByTestId("accounts-empty-filter")).toBeInTheDocument();
    const chips = screen.getByTestId("account-filter-chips");
    expect(chips).toHaveTextContent("Search: ghost@example.test");
    // removing the chip alone restores the list
    fireEvent.click(within(chips).getByRole("button", { name: "Remove filter Search: ghost@example.test" }));
    await waitFor(() => expect(screen.getByText("ready@acme.test")).toBeInTheDocument());
  });

  it("first-run shows the connect-your-first-mailbox CTA which opens the wizard", async () => {
    stubServices();
    vi.mocked(emailSendingService.listAccounts).mockResolvedValue({ success: true, data: [] });
    vi.mocked(emailSendingService.getOverview).mockResolvedValue({
      success: true,
      data: {
        totalAccounts: 0, activeAccounts: 0, accountsWithErrors: 0,
        emailsSentToday: 0, remainingCapacityToday: 0, bounces: 0, replies: 0, failedSends: 0,
      },
    });
    renderPage();

    expect(await screen.findByTestId("accounts-empty-first")).toHaveTextContent(/Connect your first mailbox/i);
    // tabs/search hidden with no accounts; no filter chips either
    expect(screen.queryByTestId("account-tabs")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Connect mailbox/i }));
    const dialog = await screen.findByRole("dialog", { name: "Add sending account" });
    expect(within(dialog).getByText("Add a mailbox")).toBeInTheDocument();
  });
});
