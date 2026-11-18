// Authenticated application shell: header + sidebar + main content.
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { PageLoadingBar } from "@/components/ui/PageLoadingBar";
import {
  LayoutDashboard,
  Megaphone,
  Search,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  LogOut,
  UserRound,
  Sparkles,
  Send,
  PenLine,
  PanelLeftClose,
  PanelLeftOpen,
  List as ListIcon,
  Inbox,
} from "lucide-react";

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: Megaphone, label: "Campaigns", href: "/campaigns" },
  { icon: Inbox, label: "Unified Inbox", href: "/campaigns/inbox", badge: "inboxUnread" },
  { icon: ListIcon, label: "Lists", href: "/lists" },
] as const;

const EMAIL_SENDING_CHILDREN = [
  { icon: Send, label: "Sending accounts", href: "/settings/email-sending" },
  { icon: PenLine, label: "Signatures", href: "/settings/signatures" },
] as const;

function NavItem({
  icon: Icon,
  label,
  href,
  active,
  onClick,
  collapsed = false,
  badge,
}: {
  icon: React.FC<{ size?: number | string; className?: string }>;
  label: string;
  href: string;
  active: boolean;
  onClick: () => void;
  collapsed?: boolean;
  badge?: number;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
        collapsed ? "justify-center px-0" : ""
      } ${
        active
          ? "bg-primary-50 text-primary-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      <Icon size={18} className={`shrink-0 ${active ? "text-primary-600" : "text-slate-400"}`} />
      {!collapsed && <span>{label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span aria-label={`${badge} unread`} className="ml-auto rounded-full bg-primary-600 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </a>
  );
}

function NavGroup({
  icon: Icon,
  label,
  children,
  active,
  expanded,
  onToggle,
  onNavigate,
  isChildActive,
  collapsed = false,
}: {
  icon: React.FC<{ size?: number | string; className?: string }>;
  label: string;
  children: readonly { icon: React.FC<{ size?: number | string; className?: string }>; label: string; href: string }[];
  /** True when the current route is one of the group's children. */
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (href: string) => void;
  isChildActive: (href: string) => boolean;
  collapsed?: boolean;
}) {
  // In collapsed (icon-only) mode: show just the parent icon, click jumps to first child.
  if (collapsed) {
    const firstActive = children.find((c) => isChildActive(c.href));
    return (
      <a
        href={children[0].href}
        onClick={(e) => { e.preventDefault(); onNavigate((firstActive || children[0]).href); }}
        title={label}
        aria-label={label}
        className={`flex items-center justify-center rounded-lg px-0 py-2.5 text-sm font-medium transition ${
          active ? "bg-primary-50 text-primary-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        <Icon size={18} className={active ? "text-primary-600" : "text-slate-400"} />
      </a>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls="nav-email-sending"
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
          active ? "text-primary-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        <Icon size={18} className={active ? "text-primary-600" : "text-slate-400"} />
        <span>{label}</span>
        <ChevronRight size={16} aria-hidden className={`ml-auto text-slate-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
      </button>
      {expanded && (
        <div id="nav-email-sending" role="group" aria-label={label} className="mt-1 space-y-1 pl-6">
          {children.map((child) => (
            <a
              key={child.href}
              href={child.href}
              onClick={(e) => { e.preventDefault(); onNavigate(child.href); }}
              aria-current={isChildActive(child.href) ? "page" : undefined}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isChildActive(child.href)
                  ? "bg-primary-50 text-primary-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <child.icon size={14} className={isChildActive(child.href) ? "text-primary-600" : "text-slate-400"} />
              <span>{child.label}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inboxUnread, setInboxUnread] = useState(0);

  // Poll the inbox unread count (real backend state) every 60s
  useEffect(() => {
    let alive = true;
    const fetchCount = () => {
      fetch("/api/v1/conversations/unread-count", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive) setInboxUnread(d?.data?.unread || 0); })
        .catch(() => { /* badge just stays stale */ });
    };
    fetchCount();
    const t = window.setInterval(fetchCount, 60000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  const [headerSearch, setHeaderSearch] = useState("");
  const [emailSendingOpen, setEmailSendingOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return window.localStorage.getItem("salesfire.sidebar.collapsed") === "1"; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try { window.localStorage.setItem("salesfire.sidebar.collapsed", v ? "0" : "1"); } catch { /* ignore */ }
      return !v;
    });
  };

  const isActive = (href: string) =>
    href === "/campaigns"
      ? location.pathname === href || (location.pathname.startsWith("/campaigns") && !location.pathname.startsWith("/campaigns/inbox"))
      : location.pathname === href || location.pathname.startsWith(href + "/");

  const emailSendingActive = EMAIL_SENDING_CHILDREN.some((c) => isActive(c.href));

  const go = (href: string) => {
    navigate(href);
    setMobileOpen(false);
  };

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate("/login", { replace: true });
  };

  const initials = (user?.full_name || user?.email || "U")
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div className="min-h-screen bg-slate-50">
      <PageLoadingBar />
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="flex h-14 items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-3">
            <button
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
              onClick={() => (typeof window !== "undefined" && window.innerWidth >= 1024) ? toggleCollapsed() : setMobileOpen(!mobileOpen)}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {typeof window !== "undefined" && window.innerWidth < 1024
                ? (mobileOpen ? <X size={18} /> : <Menu size={18} />)
                : (collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />)}
            </button>
            <a href="/dashboard" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-600 to-accent text-white shadow-card">
                <Sparkles size={16} />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-slate-900">SalesFire</div>
                <div className="hidden text-[11px] text-slate-400 sm:block">
                  AI Sales Intelligence
                </div>
              </div>
            </a>
          </div>

          <div className="flex items-center gap-2">
            {/* Global search — jumps to the campaigns list filtered by query */}
            <form
              className="relative hidden md:block"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const q = headerSearch.trim();
                navigate(q ? `/campaigns?q=${encodeURIComponent(q)}` : "/campaigns");
              }}
            >
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={headerSearch}
                onChange={(e) => setHeaderSearch(e.target.value)}
                placeholder="Search campaigns..."
                aria-label="Search campaigns"
                className="w-56 rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-700 placeholder-slate-400 outline-none transition focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100"
              />
            </form>

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 transition hover:bg-slate-100"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-xs font-semibold text-white">
                  {initials}
                </div>
                <span className="hidden max-w-[140px] truncate text-sm text-slate-700 sm:block">
                  {user?.full_name || user?.email}
                </span>
                <ChevronDown size={14} className="text-slate-400" />
              </button>

              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card-hover">
                    <div className="border-b border-slate-100 px-4 py-3">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {user?.full_name || "User"}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {user?.email}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        navigate("/dashboard");
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <UserRound size={15} className="text-slate-400" />
                      Profile
                    </button>
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2.5 border-t border-slate-100 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <LogOut size={15} className="text-slate-400" />
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Full-width shell: the sidebar pins to the left edge and the content
          takes the remaining space. Each page governs its own readable width. */}
      <div className="flex min-w-0">
        {/* Sidebar - desktop */}
        <aside className={`sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 border-r border-slate-200 bg-white p-3 transition-[width] duration-200 ease-in-out lg:block ${collapsed ? "w-[72px]" : "w-60"}`}>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <NavItem
                key={item.href}
                icon={item.icon}
                label={item.label}
                href={item.href}
                active={isActive(item.href)}
                onClick={() => go(item.href)}
                collapsed={collapsed}
                badge={"badge" in item && item.badge === "inboxUnread" ? inboxUnread : undefined}
              />
            ))}
            <NavGroup
              icon={Send}
              label="Email Sending"
              children={EMAIL_SENDING_CHILDREN}
              active={emailSendingActive}
              expanded={emailSendingOpen}
              onToggle={() => setEmailSendingOpen((v) => !v)}
              onNavigate={go}
              isChildActive={isActive}
              collapsed={collapsed}
            />
          </nav>
        </aside>

        {/* Sidebar - mobile drawer */}
        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-200 bg-white p-3 lg:hidden">
              <div className="mb-4 flex items-center justify-between px-2 pt-3">
                <span className="text-sm font-semibold text-slate-900">Navigation</span>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100"
                >
                  <X size={16} />
                </button>
              </div>
              <nav className="space-y-1">
                {NAV_ITEMS.map((item) => (
                  <NavItem
                    key={item.href}
                    icon={item.icon}
                    label={item.label}
                    href={item.href}
                    active={isActive(item.href)}
                    onClick={() => go(item.href)}
                  />
                ))}
                <NavGroup
                  icon={Send}
                  label="Email Sending"
                  children={EMAIL_SENDING_CHILDREN}
                  active={emailSendingActive}
                  expanded={emailSendingOpen}
                  onToggle={() => setEmailSendingOpen((v) => !v)}
                  onNavigate={go}
                  isChildActive={isActive}
                />
              </nav>
            </aside>
          </>
        )}

        {/* Main content */}
        <main className="min-w-0 flex-1 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
