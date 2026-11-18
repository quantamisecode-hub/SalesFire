// SignatureRichEditor — contentEditable signature editor with a full
// formatting toolbar and an HTML code view (Prompt 9 companion).
//
// The user gets complete freedom over the signature's look: any font, size,
// bold/italic/underline/strikethrough, text and highlight colours, alignment,
// links, images and variables — with zero new dependencies (document.execCommand,
// insertion at the caret). External HTML is lightly cleaned before it enters
// the editable area; the server sanitizes again on every render — defense in
// depth, exactly like the sequence editor.
import { useEffect, useRef, useState } from "react";
import {
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Link2, Unlink2, Image as ImageIcon, Braces, X, Code2, Eraser, Undo2, Redo2,
  Highlighter, Baseline,
} from "lucide-react";
import { lightClean } from "@/components/sequence/RichEmailEditor";
import { buildVariableList } from "@/lib/variables";

// Email-safe fonts accepted by execCommand('fontName') and rendered safely
// by mail clients.
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

const FONT_SIZES = [
  { label: "Small", value: "2" },
  { label: "Normal", value: "3" },
  { label: "Large", value: "4" },
  { label: "Huge", value: "5" },
];

/** Coarse HTML → readable plain text for the fallback body. DOM-decoded entities. */
export function htmlToText(html: string): string {
  let t = String(html || "")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  if (typeof document !== "undefined") {
    const ta = document.createElement("textarea");
    ta.innerHTML = t;
    t = ta.value;
  }
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

type SignatureRichEditorProps = {
  html: string;
  onHtmlChange: (html: string) => void;
  knownVariables?: string[];
};

type PopoverKind = null | "link" | "variable";

export function SignatureRichEditor({ html, onHtmlChange, knownVariables = [] }: SignatureRichEditorProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [popover, setPopover] = useState<PopoverKind>(null);
  const [codeView, setCodeView] = useState(false);
  const [codeText, setCodeText] = useState(html);
  const [activeMarks, setActiveMarks] = useState({ bold: false, italic: false, underline: false, strikeThrough: false });
  const [fontName, setFontName] = useState("Arial");
  const [fontSize, setFontSize] = useState("3");
  const [linkUrl, setLinkUrl] = useState("https://");
  const [linkText, setLinkText] = useState("");
  const [varFallback, setVarFallback] = useState("");

  // Sync external content into the editable div without stomping the caret.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || codeView) return;
    if (el.innerHTML !== html) el.innerHTML = lightClean(html);
  }, [html, codeView]);

  // Popovers close on Esc and on any click outside the editor.
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
    // If the user just placed a live selection inside the editable area,
    // respect it — don't stomp it with the saved caret snapshot.
    if (sel.rangeCount > 0 && el.contains(sel.anchorNode)) return;
    if (savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const emitBody = () => {
    if (bodyRef.current) onHtmlChange(bodyRef.current.innerHTML);
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
        strikeThrough: document.queryCommandState("strikeThrough"),
      });
      const raw = String(document.queryCommandValue("fontName") || "").replace(/["']/g, "").trim();
      const base = raw.split(",")[0].trim() || "Arial";
      const match = FONT_OPTIONS.find((f) => f.value.toLowerCase() === base.toLowerCase());
      setFontName(match ? match.value : "Arial");
      const size = String(document.queryCommandValue("fontSize") || "").trim();
      if (FONT_SIZES.some((s) => s.value === size)) setFontSize(size);
    } catch { /* not focused — keep last state */ }
  };

  // Apply to the current selection; with no selection, style the whole body
  // so the change is immediately visible.
  const applyToSelectionOrBody = (command: string, value: string) => {
    const el = bodyRef.current;
    const sel = window.getSelection();
    const collapsed = !sel || sel.rangeCount === 0 || sel.isCollapsed;
    if (el && collapsed) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const s = window.getSelection();
      if (s) { s.removeAllRanges(); s.addRange(range); }
      document.execCommand(command, false, value);
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
    document.execCommand(command, false, value);
    saveCaret();
    emitBody();
    refreshMarks();
  };

  const applyFont = (name: string) => {
    setFontName(name);
    applyToSelectionOrBody("fontName", name);
  };

  const applySize = (size: string) => {
    setFontSize(size);
    applyToSelectionOrBody("fontSize", size);
  };

  const applyColor = (kind: "foreColor" | "hiliteColor", color: string) => {
    restoreCaret();
    document.execCommand(kind, false, color);
    saveCaret();
    emitBody();
  };

  /** Insert text/HTML at the caret (or at the end when no caret exists). */
  const insert = (content: string, asHtml = false) => {
    if (codeView) {
      const next = codeText + content;
      setCodeText(next);
      onHtmlChange(next);
      return;
    }
    restoreCaret();
    if (asHtml) document.execCommand("insertHTML", false, content);
    else document.execCommand("insertText", false, content);
    saveCaret();
    emitBody();
    setPopover(null);
  };

  const insertVariable = (name: string) => {
    const fb = varFallback.trim();
    insert(fb ? `{{${name} | ${fb}}}` : `{{${name}}}`);
    setVarFallback("");
  };

  const variables = buildVariableList(knownVariables);

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

  const ColorBtn = ({ kind, icon, title }: { kind: "foreColor" | "hiliteColor"; icon: React.ReactNode; title: string }) => (
    <label className="relative p-1.5 rounded-md text-slate-600 hover:bg-slate-100 cursor-pointer" title={title} aria-label={title}>
      {icon}
      <input type="color" defaultValue={kind === "foreColor" ? "#1f2937" : "#fef3c7"}
        onChange={(e) => applyColor(kind, e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer" />
    </label>
  );

  return (
    <div ref={containerRef} className="rounded-xl border border-slate-200 bg-white overflow-visible">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-slate-100 bg-slate-50/60 relative">
        <select
          aria-label="Font family"
          title="Font family"
          value={fontName}
          onMouseDown={() => { /* keep native dropdown open — do NOT preventDefault */ }}
          onChange={(e) => applyFont(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 mr-0.5 max-w-[150px]"
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
          ))}
        </select>
        <select
          aria-label="Font size"
          title="Font size"
          value={fontSize}
          onMouseDown={() => { /* keep native dropdown open */ }}
          onChange={(e) => applySize(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 mr-1"
        >
          {FONT_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <ToolBtn title="Bold" active={activeMarks.bold} onClick={() => exec("bold")}><Bold size={14} /></ToolBtn>
        <ToolBtn title="Italic" active={activeMarks.italic} onClick={() => exec("italic")}><Italic size={14} /></ToolBtn>
        <ToolBtn title="Underline" active={activeMarks.underline} onClick={() => exec("underline")}><Underline size={14} /></ToolBtn>
        <ToolBtn title="Strikethrough" active={activeMarks.strikeThrough} onClick={() => exec("strikeThrough")}><Strikethrough size={14} /></ToolBtn>
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <ColorBtn kind="foreColor" title="Text color" icon={<Baseline size={14} />} />
        <ColorBtn kind="hiliteColor" title="Highlight color" icon={<Highlighter size={14} />} />
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <ToolBtn title="Align left" onClick={() => exec("justifyLeft")}><AlignLeft size={14} /></ToolBtn>
        <ToolBtn title="Align center" onClick={() => exec("justifyCenter")}><AlignCenter size={14} /></ToolBtn>
        <ToolBtn title="Align right" onClick={() => exec("justifyRight")}><AlignRight size={14} /></ToolBtn>
        <ToolBtn title="Justify" onClick={() => exec("justifyFull")}><AlignJustify size={14} /></ToolBtn>
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <ToolBtn title="Insert link" onClick={() => setPopover(popover === "link" ? null : "link")}><Link2 size={14} /></ToolBtn>
        <ToolBtn title="Remove link" onClick={() => exec("unlink")}><Unlink2 size={14} /></ToolBtn>
        <ToolBtn title="Insert image" onClick={() => insert(`<img src="https://" alt="image" style="max-width:100%;height:auto" />`, true)}><ImageIcon size={14} /></ToolBtn>
        <ToolBtn title="Insert variable" onClick={() => setPopover(popover === "variable" ? null : "variable")}><Braces size={14} /></ToolBtn>
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <ToolBtn title="Clear formatting" onClick={() => exec("removeFormat")}><Eraser size={14} /></ToolBtn>
        <ToolBtn title="Undo" onClick={() => document.execCommand("undo")}><Undo2 size={14} /></ToolBtn>
        <ToolBtn title="Redo" onClick={() => document.execCommand("redo")}><Redo2 size={14} /></ToolBtn>
        <div className="flex-1" />
        <ToolBtn title={codeView ? "Visual editor" : "HTML code view"} active={codeView} onClick={() => {
          if (codeView) {
            onHtmlChange(codeText);
            if (bodyRef.current) bodyRef.current.innerHTML = lightClean(codeText);
          } else {
            setCodeText(html);
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

        {/* Variable popover */}
        {popover === "variable" && (
          <div className="absolute z-20 top-full left-0 mt-1 p-3 rounded-lg border border-slate-200 bg-white shadow-lg w-80 max-h-80 overflow-auto" role="dialog" aria-label="Insert variable">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-semibold text-slate-600">Insert variable</span>
              <button type="button" onClick={() => setPopover(null)} aria-label="Close"><X size={13} /></button>
            </div>
            <label className="text-xs text-slate-500 block mb-1">Fallback value (used when a lead has no data)</label>
            <input value={varFallback} onChange={(e) => setVarFallback(e.target.value)} placeholder='e.g. "there"'
              className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 mb-2" aria-label="Variable fallback" />
            <div className="grid grid-cols-2 gap-1">
              {variables.map((v) => (
                <button key={v} type="button" onClick={() => insertVariable(v)}
                  className="text-left text-xs font-mono px-2 py-1.5 rounded-md hover:bg-violet-50 hover:text-violet-700 text-slate-700">
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Custom variables imported with your leads (e.g. <code>funding</code>) are also valid — type them directly.</p>
          </div>
        )}
      </div>

      {/* Editable area / code view */}
      {codeView ? (
        <textarea
          value={codeText}
          onChange={(e) => { setCodeText(e.target.value); onHtmlChange(e.target.value); }}
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
          aria-label="Signature body"
          onMouseUp={saveCaret}
          onKeyUp={() => { saveCaret(); refreshMarks(); }}
          onInput={emitBody}
          onBlur={emitBody}
          className="p-3 min-h-[180px] text-sm focus:outline-none [&_p]:mb-2 [&_p:last-child]:mb-0 [&_a]:text-blue-600 [&_a]:underline"
        />
      )}
    </div>
  );
}
