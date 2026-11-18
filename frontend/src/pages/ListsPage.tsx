// Lists — CRM holding lists (Instantly parity).
// Leads in lists don't count toward any campaign's sending audience and can
// be moved into campaigns on demand.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Loader2, List as ListIcon, Trash2, Users, Pencil, Check, X } from "lucide-react";
import { listsService } from "@/services/lists";
import type { LeadList } from "@/types/lead";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

export function ListsPage() {
  const [lists, setLists] = useState<LeadList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirmDialog();
  const toast = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    try { setLists(await listsService.list()); }
    catch { setError("Failed to load lists."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const list = await listsService.create(name);
      setNewName(""); setCreating(false);
      navigate(`/lists/${list.id}`);
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to create list.");
    } finally { setBusy(false); }
  };

  const rename = async (id: string) => {
    const name = editName.trim();
    if (!name) { setEditingId(null); return; }
    try {
      await listsService.update(id, { name });
      setEditingId(null);
      load();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to rename list.");
    }
  };

  const remove = async (list: LeadList) => {
    const ok = await confirm({
      title: `Delete list "${list.name}"?`,
      message: `${list.memberCount} member(s) will be removed from the list. The leads themselves are not deleted.`,
      confirmLabel: "Delete list",
    });
    if (!ok) return;
    try {
      await listsService.remove(list.id);
      toast.success("List deleted.");
      load();
    } catch (err: any) {
      toast.error(err?.data?.error || "Failed to delete list.");
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 inline-flex items-center gap-2"><ListIcon size={20} className="text-primary-600" /> Lists</h1>
          <p className="mt-0.5 text-sm text-slate-500">Holding lists for leads you're not ready to email. Leads in lists don't count toward your campaign audiences — move them into a campaign when they're ready.</p>
        </div>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90">
            <Plus size={15} /> New List
          </button>
        )}
      </div>

      {creating && (
        <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 max-w-md">
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") setCreating(false); }}
            placeholder="List name, e.g. Q3 SaaS prospects" aria-label="New list name"
            className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <button type="button" onClick={create} disabled={busy || !newName.trim()} aria-label="Create list"
            className="p-2 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          </button>
          <button type="button" onClick={() => setCreating(false)} aria-label="Cancel" className="p-2 rounded-lg text-slate-500 hover:bg-white">
            <X size={16} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading lists">
          {[...Array(3)].map((_, i) => <div key={i} className="h-28 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-center text-sm text-red-700">
          {error} <button type="button" onClick={load} className="font-medium underline ml-1">Try again</button>
        </div>
      ) : lists.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <ListIcon size={36} className="mx-auto text-slate-300 mb-3" aria-hidden />
          <p className="text-sm font-semibold text-slate-900">No lists yet</p>
          <p className="text-sm text-slate-500 mt-1">Create a list, then move leads into it from any campaign's Leads table (select leads → Move).</p>
          <button type="button" onClick={() => setCreating(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90">
            <Plus size={15} /> New List
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => (
            <div key={list.id} className="rounded-xl border border-slate-200 bg-white shadow-card p-4 flex flex-col gap-3 hover:shadow-card-hover transition-shadow">
              <div className="flex items-start justify-between gap-2">
                {editingId === list.id ? (
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") rename(list.id); if (e.key === "Escape") setEditingId(null); }}
                      className="flex-1 min-w-0 px-2 py-1.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/40" aria-label="List name" />
                    <button type="button" onClick={() => rename(list.id)} aria-label="Save" className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50"><Check size={15} /></button>
                    <button type="button" onClick={() => setEditingId(null)} aria-label="Cancel" className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100"><X size={15} /></button>
                  </div>
                ) : (
                  <Link to={`/lists/${list.id}`} className="min-w-0">
                    <h2 className="text-sm font-semibold text-slate-900 truncate hover:text-primary" title={list.name}>{list.name}</h2>
                    <p className="text-[11px] text-slate-400 mt-0.5">Created {new Date(list.createdAt).toLocaleDateString()}</p>
                  </Link>
                )}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button type="button" onClick={() => { setEditingId(list.id); setEditName(list.name); }} aria-label={`Rename ${list.name}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil size={15} /></button>
                  <button type="button" onClick={() => remove(list)} aria-label={`Delete ${list.name}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-100">
                <span className="inline-flex items-center gap-1.5 text-sm text-slate-600"><Users size={15} className="text-slate-400" /> <strong className="tabular-nums">{list.memberCount}</strong> member{list.memberCount === 1 ? "" : "s"}</span>
                <Link to={`/lists/${list.id}`} className="text-xs font-medium text-primary hover:text-primary-hover">Open →</Link>
              </div>
            </div>
          ))}
        </div>
      )}
      {dialog}
    </div>
  );
}
