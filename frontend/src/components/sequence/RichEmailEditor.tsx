// RichEmailEditor — contentEditable email editor with formatting toolbar,
// variable picker (with fallbacks), spintax builder, AI tools, emoji, links,
// images, unsubscribe insertion and an HTML code view (§11-§23, §25-§32).
//
// Zero new dependencies: formatting uses document.execCommand, insertion uses
// insertText/insertHTML at the caret. External HTML is lightly cleaned before
// it enters the editable area (the server sanitizes again on every render —
// defense in depth, §45).
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import {
  Bold, Italic, Underline, Link2, Image as ImageIcon, Smile, Zap, Shuffle,
  Sparkles, Unlink2, Code2, Loader2, X, Eraser,
} from "lucide-react";
import { sequenceService } from "@/services/sequence";

const EMOJIS = ["👋", "🙏", "👍", "🚀", "💡", "📈", "🎯", "✅", "⭐", "🔥", "😊", "🙌", "📅", "☕", "🤝", "💪", "🥳", "📌", "⏰", "🧠"];

const EMBEDDED_VARIABLES = [
  // Lead fields — all are import-supported (lead-import.js template) and
  // resolved by campaign-engine.js at render time. Keep in sync with BUILTIN_LEAD_FIELDS.
  "first_name", "last_name", "company_name", "job_title", "website", "email",
  "location", "industry", "company_size", "phone", "linkedin", "personalization",
  // Platform / sending-account scoped (resolved at render time).
  "accountSignature", "sendingAccountFirstName", "sendingAccountName", "sendingAccountEmail", "unsubscribeUrl",
];

/** camelCase → snake_case so we can detect duplicate wire aliases. */
const camelToSnake = (v: string) => v.replace(/([A-Z])/g, (_, c) => `_${c.toLowerCase()}`);

/**
 * The backend whitelist tracks both casings ({{first_name}} / {{firstName}})
 * of the same lead fields. Show each field once — prefer the snake_case form
 * (what users naturally type and the AI emits) — and keep the rest as-is.
 */
function uniqueForDisplay(vars: string[]): string[] {
  const set = new Set(vars);
  return vars.filter((v) => {
    if (!/[A-Z]/.test(v)) return true; // snake_case — always show
    const snake = camelToSnake(v);
    return !set.has(snake); // hide camelCase duplicate
  });
}

// Email-safe fonts, with the exact names accepted by execCommand('fontName')
// and rendered safely by mail clients.
const FONT_OPTIONS = [
  { label: "Arial", value: "Arial" },
  { label: "Georgia", value: "Georgia" },
  { label: "Times New Roman", value: "Times New Roman" },
  { label: "Palatino Linotype", value: "Palatino Linotype" },
  { label: "Courier New", value: "Courier New" },
  { label: "Verdana", value: "Verdana" },
  { label: "Trebuchet MS", value: "Trebuchet MS" },
  { label: "Comic Sans MS", value: "Comic Sans MS" },
  { label: "Impact", value: "Impact" },
];

/** Strip clearly dangerous nodes before content enters the editable area. */
export function lightClean(html: string): string {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?(<\/iframe>|\/?>)/gi, "")
    // Orphan closing tags left behind when the opener above was consumed.
    .replace(/<\/?(script|iframe)\b[^>]*>/gi, "")
    // Unterminated opener at end of input (no closing bracket at all).
    .replace(/<\/?(script|iframe)\b[^>]*$/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

export type RichEmailEditorHandle = {
  focusSubject: () => void;
  focusBody: () => void;
};

type RichEmailEditorProps = {
  subject: string;
  onSubjectChange: (v: string) => void;
  bodyHtml: string;
  onBodyChange: (v: string) => void;
  knownVariables?: string[];
  campaignId?: string | null;
  /** Shown in the AI tools menu to describe what the AI may use. */
  aiBusyLabel?: string;
  onSpamCheck: () => void;
};

type PopoverKind = null | "link" | "emoji" | "variable" | "spintax" | "ai";

export const RichEmailEditor = forwardRef<RichEmailEditorHandle, RichEmailEditorProps>(
  function RichEmailEditor(
    { subject, onSubjectChange, bodyHtml, onBodyChange, knownVariables = [], campaignId, onSpamCheck },
    ref,
  ) {
    const bodyRef = useRef<HTMLDivElement>(null);
    const subjectRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    // Last caret position inside the body (lost when toolbar buttons focus).
    const savedRange = useRef<Range | null>(null);
    const [subjectPicker, setSubjectPicker] = useState(false);
    const [popover, setPopover] = useState<PopoverKind>(null);
    const [codeView, setCodeView] = useState(false);
    const [activeMarks, setActiveMarks] = useState({ bold: false, italic: false, underline: false });
    // The font shown at the caret (drives the toolbar select, §11-§13).
    const [fontName, setFontName] = useState("Arial");

    // Popover inputs
    const [linkUrl, setLinkUrl] = useState("https://");
    const [linkText, setLinkText] = useState("");
    const [varFallback, setVarFallback] = useState("");
    const [spinOptions, setSpinOptions] = useState("");
    const [aiPrompt, setAiPrompt] = useState("");
    const [aiBusy, setAiBusy] = useState(false);
    const [aiResult, setAiResult] = useState<{ kind: "body" | "spintax"; text: string; subject?: string } | null>(null);
    const [aiError, setAiError] = useState<string | null>(null);

    // Sync external content into the editable div without stomping the caret.
    useEffect(() => {
      const el = bodyRef.current;
      if (!el || codeView) return;
      if (el.innerHTML !== bodyHtml) el.innerHTML = lightClean(bodyHtml);
    }, [bodyHtml, codeView]);

    useEffect(() => {
      if (!codeView) return;
      setCodeText(bodyHtml);
    }, [codeView]); // eslint-disable-line react-hooks/exhaustive-deps

    const [codeText, setCodeText] = useState("");

    useImperativeHandle(ref, () => ({
      focusSubject: () => subjectRef.current?.focus(),
      focusBody: () => bodyRef.current?.focus(),
    }));

    // Popovers close on Esc and on any click outside the editor (§50).
    useEffect(() => {
      if (!popover) return;
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPopover(null); };
      const onDown = (e: MouseEvent) => {
        const root = containerRef.current;
        if (root && e.target instanceof Node && !root.contains(e.target)) setPopover(null);
      };
      window.addEventListener("keydown", onKey);
      document.addEventListener("mousedown", onDown);
      return () => {
        window.removeEventListener("keydown", onKey);
        document.removeEventListener("mousedown", onDown);
      };
    }, [popover]);

    // The subject variable picker follows the same close rules.
    useEffect(() => {
      if (!subjectPicker) return;
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSubjectPicker(false); };
      const onDown = (e: MouseEvent) => {
        const root = containerRef.current;
        if (root && e.target instanceof Node && !root.contains(e.target)) setSubjectPicker(false);
      };
      window.addEventListener("keydown", onKey);
      document.addEventListener("mousedown", onDown);
      return () => {
        window.removeEventListener("keydown", onKey);
        document.removeEventListener("mousedown", onDown);
      };
    }, [subjectPicker]);

    const saveCaret = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && bodyRef.current?.contains(sel.anchorNode)) {
        savedRange.current = sel.getRangeAt(0).cloneRange();
      }
    };

    const restoreCaret = () => {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      const sel = window.getSelection();
      if (!sel) return;
      // Respect a live selection inside the editable area rather than
      // stomping it with the saved caret snapshot.
      if (sel.rangeCount > 0 && el.contains(sel.anchorNode)) return;
      if (savedRange.current) {
        sel.removeAllRanges();
        sel.addRange(savedRange.current);
      }
    };

    const emitBody = () => {
      if (bodyRef.current) onBodyChange(bodyRef.current.innerHTML);
    };

    const exec = (command: string, value?: string) => {
      restoreCaret();
      document.execCommand(command, false, value);
      saveCaret();
      emitBody();
      refreshMarks();
    };

    const refreshMarks = () => {
      try {
        setActiveMarks({
          bold: document.queryCommandState("bold"),
          italic: document.queryCommandState("italic"),
          underline: document.queryCommandState("underline"),
        });
        // Match the caret's font to one of the toolbar's options (mail
        // clients and browsers sometimes report e.g. "Georgia, serif").
        const raw = String(document.queryCommandValue("fontName") || "").replace(/["']/g, "").trim();
        const base = raw.split(",")[0].trim() || "Arial";
        const match = FONT_OPTIONS.find((f) => f.value.toLowerCase() === base.toLowerCase());
        setFontName(match ? match.value : "Arial");
      } catch { /* not focused — keep last state */ }
    };

    // Apply the chosen font to the current selection; with no selection,
    // style the whole body so the change is immediately visible.
    const applyFont = (name: string) => {
      setFontName(name);
      const el = bodyRef.current;
      const sel = window.getSelection();
      const collapsed = !sel || sel.rangeCount === 0 || sel.isCollapsed;
      if (el && collapsed) {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const s = window.getSelection();
        if (s) { s.removeAllRanges(); s.addRange(range); }
        document.execCommand("fontName", false, name);
        // collapse the selection back to the end so the caret lands naturally
        const endRange = document.createRange();
        endRange.selectNodeContents(el);
        endRange.collapse(false);
        const s2 = window.getSelection();
        if (s2) { s2.removeAllRanges(); s2.addRange(endRange); }
        saveCaret();
        emitBody();
        refreshMarks();
        return;
      }
      restoreCaret();
      document.execCommand("fontName", false, name);
      saveCaret();
      emitBody();
      refreshMarks();
    };

    /** Insert text/HTML at the caret (or at the end when no caret exists). */
    const insert = (text: string, asHtml = false) => {
      if (codeView) {
        const next = codeText + text;
        setCodeText(next);
        onBodyChange(next);
        return;
      }
      restoreCaret();
      if (asHtml) document.execCommand("insertHTML", false, text);
      else document.execCommand("insertText", false, text);
      saveCaret();
      emitBody();
      setPopover(null);
    };

    const insertVariable = (name: string) => {
      const fb = varFallback.trim();
      insert(fb ? `{{${name} | ${fb}}}` : `{{${name}}}`);
      setVarFallback("");
    };

    // Insert {{variable}} at the subject input's caret (subject variables
    // resolve exactly like body variables — the backend substitutes on send).
    const insertSubjectVariable = (name: string) => {
      const fb = varFallback.trim();
      const token = fb ? `{{${name} | ${fb}}}` : `{{${name}}}`;
      const el = subjectRef.current;
      const start = el?.selectionStart ?? subject.length;
      const end = el?.selectionEnd ?? subject.length;
      onSubjectChange(subject.slice(0, start) + token + subject.slice(end));
      requestAnimationFrame(() => {
        if (!el) return;
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
      setVarFallback("");
      setSubjectPicker(false);
    };

    const insertSpintax = () => {
      const options = spinOptions.split("\n").map((s) => s.trim()).filter(Boolean);
      if (options.length < 2) {
        setAiError("Spintax needs at least two options (one per line).");
        return;
      }
      setAiError(null);
      insert(`{{RANDOM | ${options.join(" | ")}}}`);
      setSpinOptions("");
    };

    // ---- AI tools (honest: real calls, real errors, explicit Accept) --------
    const runAIBody = async () => {
      if (!campaignId) return;
      setAiBusy(true);
      setAiError(null);
      try {
        const steps = await sequenceService.generateSequence({
          prompt: aiPrompt || "introduce our product and ask for a brief call",
          stepsCount: 1,
        });
        const step = steps?.[0];
        if (!step) throw new Error("The AI returned no email.");
        setAiResult({ kind: "body", text: step.bodyHtml, subject: step.subject });
      } catch (err: any) {
        setAiError(err?.data?.error || err?.message || "AI generation failed.");
      } finally {
        setAiBusy(false);
      }
    };

    const runAISpintax = async () => {
      if (!campaignId) return;
      setAiBusy(true);
      setAiError(null);
      const source = bodyRef.current?.innerText?.trim() || "";
      if (!source) {
        setAiError("Write some body text first — the AI adds variations to existing text.");
        setAiBusy(false);
        return;
      }
      try {
        const text = await sequenceService.generateSpintax(source);
        setAiResult({ kind: "spintax", text });
      } catch (err: any) {
        setAiError(err?.data?.error || err?.message || "AI generation failed.");
      } finally {
        setAiBusy(false);
      }
    };

    const acceptAI = () => {
      if (!aiResult) return;
      if (codeView) {
        const next = aiResult.kind === "body"
          ? aiResult.text
          : aiResult.text;
        setCodeText(next);
        onBodyChange(next);
      } else {
        const el = bodyRef.current;
        if (el) {
          el.innerHTML = lightClean(aiResult.text);
          onBodyChange(el.innerHTML);
        }
      }
      if (aiResult.kind === "body" && aiResult.subject) onSubjectChange(aiResult.subject);
      setAiResult(null);
      setAiPrompt("");
      setPopover(null);
    };

    const variables = uniqueForDisplay([...new Set([...EMBEDDED_VARIABLES, ...knownVariables])]);

    const ToolBtn = ({ onClick, active, title, children, danger }: {
      onClick: () => void; active?: boolean; title: string; children: React.ReactNode; danger?: boolean;
    }) => (
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-pressed={active}
        onMouseDown={(e) => { e.preventDefault(); }}
        onClick={onClick}
        className={`p-1.5 rounded-md transition-colors ${
          danger ? "text-red-600 hover:bg-red-50"
            : active ? "bg-violet-100 text-violet-700"
            : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        {children}
      </button>
    );

    return (
      <div ref={containerRef} className="rounded-xl border border-slate-200 bg-white overflow-visible">
        {/* Subject */}
        <div className="relative p-3 pb-2 border-b border-slate-100">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide" htmlFor="seq-subject">Subject</label>
            <button
              type="button"
              aria-label="Insert variable in subject"
              title="Insert variable"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setSubjectPicker(!subjectPicker)}
              className={`p-1.5 rounded-md transition-colors ${subjectPicker ? "bg-violet-100 text-violet-700" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <Zap size={13} />
            </button>
          </div>
          <input
            id="seq-subject"
            ref={subjectRef}
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            placeholder="A quick idea for {{company_name}} — follow-ups can leave this empty to continue the thread"
            className="mt-1 w-full text-sm border-0 focus:ring-0 p-0 placeholder:text-slate-300"
          />
          {subjectPicker && (
            <div className="absolute z-20 top-full left-3 mt-1 p-3 rounded-lg border border-slate-200 bg-white shadow-lg w-80 max-h-72 overflow-auto" role="dialog" aria-label="Insert variable in subject">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold text-slate-600">Insert variable in subject</span>
                <button type="button" onClick={() => setSubjectPicker(false)} aria-label="Close"><X size={13} /></button>
              </div>
              <input value={varFallback} onChange={(e) => setVarFallback(e.target.value)}
                placeholder="Fallback (optional), e.g. there"
                className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 mb-2"
                aria-label="Variable fallback" />
              <div className="flex flex-wrap gap-1.5">
                {variables.map((v) => (
                  <button key={v} type="button" onClick={() => insertSubjectVariable(v)}
                    className="text-[11px] font-mono px-2 py-1 rounded-md bg-violet-50 text-violet-800 border border-violet-200 hover:bg-violet-100">
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-slate-100 bg-slate-50/60 relative">
          <select
            aria-label="Font family"
            title="Font family"
            value={fontName}
            onMouseDown={() => { /* keep native dropdown open — do NOT preventDefault */ }}
            onChange={(e) => applyFont(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 mr-1 max-w-[150px]"
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                {f.label}
              </option>
            ))}
          </select>
          <ToolBtn title="Bold" active={activeMarks.bold} onClick={() => exec("bold")}><Bold size={14} /></ToolBtn>
          <ToolBtn title="Italic" active={activeMarks.italic} onClick={() => exec("italic")}><Italic size={14} /></ToolBtn>
          <ToolBtn title="Underline" active={activeMarks.underline} onClick={() => exec("underline")}><Underline size={14} /></ToolBtn>
          <div className="w-px h-4 bg-slate-200 mx-1" />
          <ToolBtn title="Insert link" onClick={() => setPopover(popover === "link" ? null : "link")}><Link2 size={14} /></ToolBtn>
          <ToolBtn title="Insert image" onClick={() => insert(`<img src="https://" alt="image" style="max-width:100%" />`, true)}><ImageIcon size={14} /></ToolBtn>
          <ToolBtn title="Emoji" onClick={() => setPopover(popover === "emoji" ? null : "emoji")}><Smile size={14} /></ToolBtn>
          <div className="w-px h-4 bg-slate-200 mx-1" />
          <ToolBtn title="Insert variable" onClick={() => setPopover(popover === "variable" ? null : "variable")}><Zap size={14} /></ToolBtn>
          <ToolBtn title="Spintax builder" onClick={() => setPopover(popover === "spintax" ? null : "spintax")}><Shuffle size={14} /></ToolBtn>
          <ToolBtn title="AI tools" onClick={() => setPopover(popover === "ai" ? null : "ai")}><Sparkles size={14} /></ToolBtn>
          <ToolBtn title="Insert unsubscribe link" onClick={() => insert(`<a href="{{unsubscribeUrl}}">Unsubscribe</a>`, true)}><Unlink2 size={14} /></ToolBtn>
          <ToolBtn title="Clean HTML — strip scripts and unsafe handlers" onClick={() => {
            const src = codeView ? codeText : (bodyRef.current?.innerHTML ?? bodyHtml);
            const cleaned = lightClean(src);
            if (codeView) setCodeText(cleaned);
            else { onBodyChange(cleaned); if (bodyRef.current) bodyRef.current.innerHTML = cleaned; }
          }}><Eraser size={14} /></ToolBtn>
          <div className="flex-1" />
          <ToolBtn title={codeView ? "Visual editor" : "HTML code view"} active={codeView} onClick={() => {
            if (codeView) {
              onBodyChange(codeText);
              if (bodyRef.current) bodyRef.current.innerHTML = lightClean(codeText);
            }
            setCodeView(!codeView);
          }}><Code2 size={14} /></ToolBtn>

          {/* Link popover */}
          {popover === "link" && (
            <div className="absolute z-20 top-full left-0 mt-1 p-3 rounded-lg border border-slate-200 bg-white shadow-lg w-72" role="dialog" aria-label="Insert link">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold text-slate-600">Insert link</span>
                <button type="button" onClick={() => setPopover(null)} aria-label="Close"><X size={13} /></button>
              </div>
              <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com"
                className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 mb-2" aria-label="Link URL" />
              <input value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="Link text (optional)"
                className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 mb-2" aria-label="Link text" />
              <button type="button" onClick={() => {
                const label = linkText.trim() || linkUrl.replace(/^https?:\/\//, "") || "link";
                insert(`<a href="${linkUrl.trim() || "#"}">${label}</a>`, true);
                setLinkUrl("https://"); setLinkText("");
              }} className="w-full text-xs font-medium py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700">Insert</button>
            </div>
          )}

          {/* Emoji popover */}
          {popover === "emoji" && (
            <div className="absolute z-20 top-full left-0 mt-1 p-2 rounded-lg border border-slate-200 bg-white shadow-lg grid grid-cols-5 gap-1 w-56" role="dialog" aria-label="Insert emoji">
              {EMOJIS.map((e) => (
                <button key={e} type="button" onClick={() => insert(e)} className="p-1.5 text-lg hover:bg-slate-100 rounded-md" aria-label={`Insert ${e}`}>{e}</button>
              ))}
            </div>
          )}

          {/* Variable popover */}
          {popover === "variable" && (
            <div className="absolute z-20 bottom-full left-0 mb-1 p-3 rounded-lg border border-slate-200 bg-white shadow-lg w-[420px] max-h-80 overflow-auto" role="dialog" aria-label="Insert variable">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold text-slate-600">Insert variable</span>
                <button type="button" onClick={() => setPopover(null)} aria-label="Close"><X size={13} /></button>
              </div>
              <label className="text-xs text-slate-500 block mb-1">Fallback value (used when a lead has no data)</label>
              <input value={varFallback} onChange={(e) => setVarFallback(e.target.value)} placeholder='e.g. "there"'
                className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 mb-2" aria-label="Variable fallback" />
              <div className="grid grid-cols-2 gap-1 min-w-0">
                {variables.map((v) => (
                  <button key={v} type="button" onClick={() => insertVariable(v)}
                    className="min-w-0 text-left text-[11px] font-mono px-2 py-1.5 rounded-md hover:bg-violet-50 hover:text-violet-700 text-slate-700 truncate"
                    title={`{{${v}}}`}>
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">Custom variables imported with your leads (e.g. <code>funding</code>) are also valid — type them directly.</p>
            </div>
          )}

          {/* Spintax popover */}
          {popover === "spintax" && (
            <div className="absolute z-20 top-full left-0 mt-1 p-3 rounded-lg border border-slate-200 bg-white shadow-lg w-80" role="dialog" aria-label="Spintax builder">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold text-slate-600">Spintax builder</span>
                <button type="button" onClick={() => setPopover(null)} aria-label="Close"><X size={13} /></button>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">One option per line — the engine picks one per recipient:</p>
              <textarea value={spinOptions} onChange={(e) => setSpinOptions(e.target.value)} rows={4}
                placeholder={"Hi\nHello\nHey"} aria-label="Spintax options"
                className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 mb-2" />
              <button type="button" onClick={insertSpintax}
                className="w-full text-xs font-medium py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700">Insert spintax</button>
            </div>
          )}

          {/* AI tools popover */}
          {popover === "ai" && (
            <div className="absolute z-20 top-full right-0 mt-1 p-3 rounded-lg border border-slate-200 bg-white shadow-lg w-96" role="dialog" aria-label="AI tools">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold text-slate-600">AI tools</span>
                <button type="button" onClick={() => setPopover(null)} aria-label="Close"><X size={13} /></button>
              </div>
              <label className="text-xs text-slate-500 block mb-1">Generate body from a prompt</label>
              <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={2}
                placeholder="e.g. follow up on a demo request, mention our reporting feature"
                className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 mb-2" aria-label="AI prompt" />
              {aiError && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mb-2" role="alert">{aiError}</p>
              )}
              {aiResult ? (
                <div className="mb-2">
                  <p className="text-[11px] font-semibold text-violet-600 uppercase mb-1">AI result — nothing is applied until you accept</p>
                  <pre className="whitespace-pre-wrap text-xs bg-slate-50 border border-slate-200 rounded-md p-2 max-h-40 overflow-auto font-sans">{aiResult.text}</pre>
                  <div className="flex gap-2 mt-2">
                    <button type="button" onClick={acceptAI}
                      className="flex-1 text-xs font-medium py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700">Replace body with this</button>
                    <button type="button" onClick={() => setAiResult(null)}
                      className="text-xs font-medium py-1.5 px-3 rounded-md border border-slate-200 hover:bg-slate-50">Discard</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 mb-2">
                  <button type="button" onClick={runAIBody} disabled={aiBusy || !campaignId}
                    className="text-xs font-medium py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                    {aiBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Generate body with AI
                  </button>
                  <button type="button" onClick={runAISpintax} disabled={aiBusy || !campaignId}
                    className="text-xs font-medium py-1.5 rounded-md border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                    {aiBusy ? <Loader2 size={12} className="animate-spin" /> : <Shuffle size={12} />} Add spintax variations (AI)
                  </button>
                  <button type="button" onClick={() => { setPopover(null); onSpamCheck(); }}
                    className="text-xs font-medium py-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50">
                    Check this email for spam signals
                  </button>
                </div>
              )}
              <p className="text-[11px] text-slate-400">AI runs server-side and may only use verified recipient data. If the AI is not configured you'll get an honest error — nothing is faked.</p>
            </div>
          )}
        </div>

        {/* Body */}
        {codeView ? (
          <textarea
            value={codeText}
            onChange={(e) => { setCodeText(e.target.value); onBodyChange(e.target.value); }}
            rows={14}
            aria-label="HTML source"
            spellCheck={false}
            className="w-full font-mono text-xs p-3 focus:outline-none focus:ring-0"
          />
        ) : (
          <div
            ref={bodyRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Email body"
            onMouseUp={saveCaret}
            onKeyUp={() => { saveCaret(); refreshMarks(); }}
            onInput={emitBody}
            onBlur={emitBody}
            className="p-3 min-h-[220px] text-sm focus:outline-none [&_p]:mb-3 [&_p:last-child]:mb-0 [&_a]:text-blue-600 [&_a]:underline"
          />
        )}
      </div>
    );
  },
);
