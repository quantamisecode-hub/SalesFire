// Members API — active members of the caller's organization (for owner assignment).
import type { Member } from "@/types/lead";

export const memberService = {
  async list(): Promise<Member[]> {
    const res = await fetch("/api/v1/members", { credentials: "include" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
    return body.data as Member[];
  },
};
