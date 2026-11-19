// AddAccountWizard — SalesBlink-style "Add mailbox" 5-step connection flow.
// Covers: provider presets auto-filling SMTP+IMAP, step gating/validation,
// reply-sync (IMAP) same-as-SMTP logic, create payload, honest test failure + retry.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddAccountWizard } from "./AddAccountWizard";
import { emailSendingService } from "@/services/emailSending";
import type { SmtpAccount } from "@/types/prompt6";

vi.mock("@/services/emailSending", () => ({
  emailSendingService: {
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    testConnection: vi.fn(),
  },
}));

const noop = vi.fn();

const renderWizard = (over: Partial<Parameters<typeof AddAccountWizard>[0]> = {}) =>
  render(
    <AddAccountWizard
      open
      mode="create"
      signatures={[]}
      onClose={noop}
      onSaved={noop}
      {...over}
    />,
  );

/** Advance from the Connect step with a minimal valid identity. */
const fillConnectStep = () => {
  fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Prateek Sales" } });
  fireEvent.change(screen.getByLabelText("From email"), { target: { value: "sales@acme.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2secret" } });
};

const next = () => fireEvent.click(screen.getByRole("button", { name: /next/i }));

describe("AddAccountWizard — provider presets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Google preset auto-fills SMTP and IMAP servers on the Connect step", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("radio", { name: /google workspace/i }));
    expect(screen.getByRole("radio", { name: /google workspace/i })).toHaveAttribute("aria-checked", "true");
    next();

    expect(screen.getByLabelText("SMTP host")).toHaveValue("smtp.gmail.com");
    expect(screen.getByLabelText("Port")).toHaveValue(587);
    expect(screen.getByLabelText("Security")).toHaveValue("tls");
    // IMAP section: enabling reply sync reveals the preset IMAP host too
    fireEvent.click(screen.getByLabelText(/sync replies into the unified inbox/i));
    expect(screen.getByLabelText("IMAP host")).toHaveValue("imap.gmail.com");
  });

  it("Microsoft preset fills Microsoft 365 servers", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("radio", { name: /microsoft 365/i }));
    next();
    expect(screen.getByLabelText("SMTP host")).toHaveValue("smtp.office365.com");
    fireEvent.click(screen.getByLabelText(/sync replies into the unified inbox/i));
    expect(screen.getByLabelText("IMAP host")).toHaveValue("outlook.office365.com");
  });

  it("Custom provider leaves servers blank for the user to fill", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("radio", { name: /any other smtp provider/i }));
    next();
    expect(screen.getByLabelText("SMTP host")).toHaveValue("");
  });
});

describe("AddAccountWizard — step gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks advancing past Provider until a provider is chosen", () => {
    renderWizard();
    next();
    expect(screen.getByText("Choose a provider to continue")).toBeInTheDocument();
    // still on step 1 — Connect fields not rendered
    expect(screen.queryByLabelText("From email")).not.toBeInTheDocument();
  });

  it("blocks advancing past Connect until identity + password are valid", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("radio", { name: /google workspace/i }));
    next();
    next(); // empty form
    expect(screen.getByText("Account name is required")).toBeInTheDocument();
    expect(screen.getByText("A valid from email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(screen.queryByText("Sending limits")).not.toBeInTheDocument();
  });

  it("rejects an invalid from-email with an inline error", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("radio", { name: /google workspace/i }));
    next();
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Box" } });
    fireEvent.change(screen.getByLabelText("From email"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    next();
    expect(screen.getByText("A valid from email is required")).toBeInTheDocument();
  });

  it("walks Provider → Connect → Sending → Warmup → Done", () => {
    renderWizard();
    expect(screen.getByLabelText("Setup progress")).toHaveTextContent("Provider");
    fireEvent.click(screen.getByRole("radio", { name: /google workspace/i }));
    next();
    expect(screen.getByText("Sender identity")).toBeInTheDocument();
    fillConnectStep();
    next();
    expect(screen.getByText("Sending limits")).toBeInTheDocument();
    next(); // defaults are valid
    expect(screen.getByText("Warm-up")).toBeInTheDocument();
    next();
    expect(screen.getByText("Review before creating")).toBeInTheDocument();
  });
});

describe("AddAccountWizard — reply sync (IMAP)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("same-as-SMTP shortcuts hide the duplicate IMAP credential fields", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("radio", { name: /google workspace/i }));
    next();
    fireEvent.click(screen.getByLabelText(/sync replies into the unified inbox/i));
    // both shortcuts checked by default → no separate username/password inputs
    expect(screen.queryByLabelText("IMAP username")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("IMAP password")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Same username as SMTP")).toBeChecked();
    expect(screen.getByLabelText("Same password as SMTP")).toBeChecked();
    // unchecking reveals the field
    fireEvent.click(screen.getByLabelText("Same password as SMTP"));
    expect(screen.getByLabelText("IMAP password")).toBeInTheDocument();
  });

  it("requires the IMAP password when reply sync is on and the shortcut is off", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("radio", { name: /google workspace/i }));
    next();
    fillConnectStep();
    fireEvent.click(screen.getByLabelText(/sync replies into the unified inbox/i));
    fireEvent.click(screen.getByLabelText("Same password as SMTP"));
    next();
    expect(screen.getByText("IMAP password is required")).toBeInTheDocument();
    expect(screen.queryByText("Sending limits")).not.toBeInTheDocument();
  });

  it("sends resolved IMAP credentials in the create payload", async () => {
    vi.mocked(emailSendingService.createAccount).mockResolvedValue({
      success: true,
      data: { id: "acc-1" } as SmtpAccount,
    });
    vi.mocked(emailSendingService.testConnection).mockResolvedValue({
      success: true,
      message: "SMTP connection verified.",
    });

    renderWizard();
    fireEvent.click(screen.getByRole("radio", { name: /google workspace/i }));
    next();
    fillConnectStep();
    fireEvent.click(screen.getByLabelText(/sync replies into the unified inbox/i));
    // separate IMAP identity: uncheck username shortcut, provide own user
    fireEvent.click(screen.getByLabelText("Same username as SMTP"));
    fireEvent.change(screen.getByLabelText("IMAP username"), { target: { value: "imap-user@acme.test" } });
    next();
    next(); // Sending defaults
    next(); // Warmup defaults
    expect(screen.getByText("Review before creating")).toBeInTheDocument();
    expect(screen.getByText("IMAP imap.gmail.com:993")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /create account & test connection/i }));

    await waitFor(() => expect(emailSendingService.createAccount).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(emailSendingService.createAccount).mock.calls[0][0];
    expect(payload).toMatchObject({
      name: "Prateek Sales",
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      security: "tls",
      fromEmail: "sales@acme.test",
      imapEnabled: true,
      imapHost: "imap.gmail.com",
      imapPort: 993,
      imapSecure: true,
      imapUsername: "imap-user@acme.test",
      imapPassword: "hunter2secret", // same-password shortcut resolved to SMTP password
    });
    await waitFor(() => expect(emailSendingService.testConnection).toHaveBeenCalledWith("acc-1"));
    expect(await screen.findByText("Connection successful")).toBeInTheDocument();
  });

  it("omits IMAP fields entirely when reply sync is off", async () => {
    vi.mocked(emailSendingService.createAccount).mockResolvedValue({
      success: true,
      data: { id: "acc-2" } as SmtpAccount,
    });
    vi.mocked(emailSendingService.testConnection).mockResolvedValue({
      success: true,
      message: "ok",
    });

    renderWizard();
    fireEvent.click(screen.getByRole("radio", { name: /google workspace/i }));
    next();
    fillConnectStep();
    next();
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: /create account & test connection/i }));

    await waitFor(() => expect(emailSendingService.createAccount).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(emailSendingService.createAccount).mock.calls[0][0];
    expect(payload.imapEnabled).toBe(false);
    expect(payload.imapHost).toBeUndefined();
    expect(payload.imapPassword).toBeUndefined();
  });
});

describe("AddAccountWizard — create + test", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports a failed SMTP handshake honestly and offers retry", async () => {
    vi.mocked(emailSendingService.createAccount).mockResolvedValue({
      success: true,
      data: { id: "acc-3" } as SmtpAccount,
    });
    vi.mocked(emailSendingService.testConnection)
      .mockResolvedValueOnce({ success: false, message: "535 5.7.8 Authentication credentials invalid" })
      .mockResolvedValueOnce({ success: true, message: "Connection verified." });

    renderWizard();
    fireEvent.click(screen.getByRole("radio", { name: /google workspace/i }));
    next();
    fillConnectStep();
    next();
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: /create account & test connection/i }));

    // account is kept, failure is surfaced honestly
    expect(await screen.findByText("Connection failed")).toBeInTheDocument();
    expect(screen.getByText(/535 5\.7\.8 Authentication credentials invalid/)).toBeInTheDocument();
    expect(screen.getByText(/account was created and its credentials are stored encrypted/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry test/i }));
    expect(await screen.findByText("Connection successful")).toBeInTheDocument();
    expect(emailSendingService.testConnection).toHaveBeenCalledTimes(2);
  });

  it("surfaces a create API error without advancing to Done", async () => {
    vi.mocked(emailSendingService.createAccount).mockRejectedValue({
      data: { error: "name, smtpHost, smtpPort and fromEmail are required" },
    });

    renderWizard();
    fireEvent.click(screen.getByRole("radio", { name: /google workspace/i }));
    next();
    fillConnectStep();
    next();
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: /create account & test connection/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/name, smtpHost, smtpPort and fromEmail are required/);
    expect(screen.getByText("Review before creating")).toBeInTheDocument();
  });

  it("edit mode preselects the provider from the stored host and saves without re-entering the password", async () => {
    const account: SmtpAccount = {
      id: "acc-9",
      name: "Existing box",
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      security: "tls",
      smtpUsername: "sales@acme.test",
      hasPassword: true,
      fromEmail: "sales@acme.test",
      fromName: "Acme",
      isEnabled: true,
      status: "verified",
      healthStatus: "healthy",
      warmupStatus: "not_started",
      dailyLimit: 30,
      createdAt: "2026-11-01T00:00:00.000Z",
    };
    vi.mocked(emailSendingService.updateAccount).mockResolvedValue({ success: true, data: account });

    renderWizard({ mode: "edit", account });
    // provider preselected → radio already checked, host pre-filled
    expect(screen.getByRole("radio", { name: /google workspace/i })).toHaveAttribute("aria-checked", "true");
    next();
    expect(screen.getByLabelText("SMTP host")).toHaveValue("smtp.gmail.com");
    // password blank in edit mode — not required
    next();
    next();
    next();
    expect(screen.getByText("Review your changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(emailSendingService.updateAccount).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(emailSendingService.updateAccount).mock.calls[0][1];
    expect(payload.smtpPassword).toBeUndefined(); // blank = keep existing
    expect(payload.name).toBe("Existing box");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});
