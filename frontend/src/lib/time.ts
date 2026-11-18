// Relative-time formatting for dense tables (e.g. "2h ago", "Nov 17").
export function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diffMs = Date.now() - t;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function initialsOf(name?: string | null, email?: string | null): string {
  const n = (name || "").trim();
  if (n) {
    const parts = n.split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || n[0].toUpperCase();
  }
  return (email || "?")[0].toUpperCase();
}

const AVATAR_HUES = [262, 199, 152, 24, 343, 174, 210, 330];
export function avatarHue(seed: string): number {
  let h = 7;
  for (const c of String(seed).toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}
