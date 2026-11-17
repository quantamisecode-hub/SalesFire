// SendTestModal (§35): honest validation errors, Esc-to-close, and the
// recipient list it builds from comma/space separated input.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SendTestModal } from "./SendTestModal";
import { ToastProvider } from "@/components/ui/Toast";
import { sequenceService } from "@/services/sequence";

const renderModal = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

vi.mock("@/services/sequence", () => ({
  sequenceService: {
    sendTestEmail: vi.fn(),
  },
}));
vi.mock("@/services/emailSending", () => ({
  emailSendingService: { listAccounts: vi.fn().mockResolvedValue({ data: [] }) },
}));

const base = { campaignId: "c1", stepId: "s1", onClose: vi.fn() };

describe("SendTestModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an invalid recipient before calling the API", async () => {
    renderModal(<SendTestModal {...base} defaultRecipient="not-an-email" />);
    fireEvent.click(screen.getByRole("button", { name: /send real test email/i }));
    await waitFor(() => expect(screen.getByText(/not a valid email address/i)).toBeInTheDocument());
    expect(sequenceService.sendTestEmail).not.toHaveBeenCalled();
  });

  it("sends through the real API and shows the honest result", async () => {
    vi.mocked(sequenceService.sendTestEmail).mockResolvedValue({ sent: true, messageId: "m-1", to: ["a@b.co"] });
    renderModal(<SendTestModal {...base} defaultRecipient="a@b.co" />);
    fireEvent.click(screen.getByRole("button", { name: /send real test email/i }));
    await waitFor(() => expect(screen.getAllByText(/test email sent to a@b\.co/i).length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText(/m-1/)).toBeInTheDocument();
  });

  it("surfaces the backend's real SMTP error instead of faking success", async () => {
    vi.mocked(sequenceService.sendTestEmail).mockRejectedValue({ data: { error: "SMTP authentication failed" } });
    renderModal(<SendTestModal {...base} defaultRecipient="a@b.co" />);
    fireEvent.click(screen.getByRole("button", { name: /send real test email/i }));
    await waitFor(() => expect(screen.getAllByText(/SMTP authentication failed/i).length).toBeGreaterThanOrEqual(1));
  });

  it("closes on Escape (§50)", () => {
    const onClose = vi.fn();
    renderModal(<SendTestModal {...base} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("caps the recipient list at 5 addresses", async () => {
    vi.mocked(sequenceService.sendTestEmail).mockResolvedValue({ sent: true, messageId: "m", to: [] });
    renderModal(<SendTestModal {...base} defaultRecipient="a@b.co b@b.co c@b.co d@b.co e@b.co f@b.co" />);
    fireEvent.click(screen.getByRole("button", { name: /send real test email/i }));
    await waitFor(() => expect(sequenceService.sendTestEmail).toHaveBeenCalled());
    expect(vi.mocked(sequenceService.sendTestEmail).mock.calls[0][1].recipients).toHaveLength(5);
  });
});
