// MailboxSidebar — SmartLead Master Inbox-style folder rail.
// Left column of the unified inbox: MAILBOXES (primary folders with live
// counts) + VIEWS (saved-filter shortcuts). Mirrors Smartlead's sidebar
// (Inbox / Sent / Important / Snoozed / Archived + Views) with SalesFire's
// conversation filter vocabulary.
import {
  Inbox, MailOpen, Star, Send, Clock, Archive,
  User, Reply, Users, CheckCircle2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type InboxFilter =
  | "all" | "unread" | "starred" | "replied" | "snoozed" | "archived"
  | "mine" | "needs_reply" | "assigned" | "closed";

interface FolderDef {
  value: InboxFilter;
  label: string;
  icon: LucideIcon;
  /** Folders shown in the MAILBOXES section; the rest go under VIEWS. */
  section: "mailboxes" | "views";
}

export const INBOX_FOLDERS: FolderDef[] = [
  { value: "all", label: "Inbox", icon: Inbox, section: "mailboxes" },
  { value: "unread", label: "Unread", icon: MailOpen, section: "mailboxes" },
  { value: "starred", label: "Starred", icon: Star, section: "mailboxes" },
  { value: "replied", label: "Sent", icon: Send, section: "mailboxes" },
  { value: "snoozed", label: "Snoozed", icon: Clock, section: "mailboxes" },
  { value: "archived", label: "Archived", icon: Archive, section: "mailboxes" },
  { value: "mine", label: "Mine", icon: User, section: "views" },
  { value: "needs_reply", label: "Needs Reply", icon: Reply, section: "views" },
  { value: "assigned", label: "Assigned", icon: Users, section: "views" },
  { value: "closed", label: "Closed", icon: CheckCircle2, section: "views" },
];

function FolderButton({
  folder, active, count, onSelect,
}: {
  folder: FolderDef;
  active: boolean;
  count: number | undefined;
  onSelect: (f: InboxFilter) => void;
}) {
  const Icon = folder.icon;
  const showBadge = count !== undefined && count > 0;
  const hot = folder.value === "unread" && count !== undefined && count > 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(folder.value)}
      aria-current={active ? "true" : undefined}
      aria-label={showBadge ? `${folder.label}, ${count} conversation${count === 1 ? "" : "s"}` : folder.label}
      className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${
        active
          ? "bg-primary-50 font-semibold text-primary-700"
          : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      <Icon
        size={15}
        aria-hidden
        className={active ? "text-primary-600" : hot ? "text-primary-500" : "text-slate-400 group-hover:text-slate-600"}
      />
      <span className="min-w-0 flex-1 truncate">{folder.label}</span>
      {showBadge && count > 0 && (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
            hot ? "bg-primary text-white" : active ? "bg-primary-100 text-primary-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function MailboxSidebar({
  value, onChange, counts,
}: {
  value: InboxFilter;
  onChange: (f: InboxFilter) => void;
  counts: Record<string, number> | null;
}) {
  const mailboxes = INBOX_FOLDERS.filter((f) => f.section === "mailboxes");
  const views = INBOX_FOLDERS.filter((f) => f.section === "views");
  return (
    <nav aria-label="Mailboxes" className="flex h-full min-h-0 flex-col overflow-y-auto border-r border-slate-200 bg-slate-50/60 px-2 py-3">
      <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Mailboxes</p>
      <div className="space-y-0.5">
        {mailboxes.map((f) => (
          <FolderButton key={f.value} folder={f} active={value === f.value} count={counts?.[f.value]} onSelect={onChange} />
        ))}
      </div>

      <p className="px-2.5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Views</p>
      <div className="space-y-0.5">
        {views.map((f) => (
          <FolderButton key={f.value} folder={f} active={value === f.value} count={counts?.[f.value]} onSelect={onChange} />
        ))}
      </div>
    </nav>
  );
}
