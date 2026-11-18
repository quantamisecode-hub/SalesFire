# UI & Email Editor — Design Notes (Instantly / Smartlead parity)

Status: implemented 2026-11-18. Scope: app shell, sequence email editor, variable pickers, leads table copy.

## Visual language

- Single brand palette (indigo `primary` + violet `accent`) on a slate-50 canvas, Inter everywhere, `rounded-xl/2xl` cards with `shadow-card`, matching the reference tools' quiet, dense professional look.
- Sidebar: collapsible via the header hamburger — icon-rail (72px) persisted in `localStorage` under `salesfire.sidebar.collapsed`, expanded 240px; mobile drawer unchanged. The toggle already existed; it is now wired on both desktop (collapse) and mobile (drawer), and routes render through one `<Outlet>` so state persists across navigation.

## Email editor

- The sequence body editor is built on **TipTap v3** (`@tiptap/react` + `StarterKit` + `Image` + `TextStyle`/`FontFamily`), i.e. ProseMirror — the same open-source editing stack family used by Notion-style tools. Instantly does **not** publish its editor source, so this is a clean-room reimplementation of the UX, not a copy: font dropdown, B/I/U, link, image, emoji, ⚡ variable picker, spintax builder, AI tools, one-click unsubscribe, and an HTML code/visual toggle.
- Content is stored as **HTML strings** in both directions (`editor.getHTML()` / `setContent()`), so the live preview renderer, `SendTestModal`, and the server-side sanitizer see markup identical to the previous hand-rolled `contentEditable` implementation, which is removed.
- External HTML is lightly cleaned (`lightClean` — strips `<script>`/`<iframe>`/`on*` handlers/`javascript:`) before insertion; the server sanitizes again on render (defense in depth).
- `StarterKit` v3 bundles Link and Underline; they are configured (`openOnClick: false`, `autolink`, `rel=noopener`) rather than registered twice.

## Variables

- `frontend/src/lib/variables.ts` is the single source of truth for the picker lists (`buildVariableList`). It:
  - shows each variable once, preferring snake_case lead fields and camelCase account/platform variables;
  - drops the legacy `unsubscribe_url` alias entirely (the canonical variable is `unsubscribeUrl`; previously `unsubscribeUrl` was wrongly hidden and the alias wrongly shown);
  - appends org-specific custom slugs imported with leads (validated `^[a-z0-9_]{1,40}$`), case-insensitively deduplicated against the built-in list;
  - is shared by the sequence editor and the signature editor.
- Backend `knownVariablesForOrg` (`services/known-vars.js`) is unchanged: it still validates both casings of lead fields and exposes `unsubscribe_url` for template validation (older sequences may contain it). The picker simply never *displays* the alias.

## Leads / wizard terminology

- All user-facing copy says **Leads** (never "Recipients"): wizard steps, validation alerts, toasts, review labels, audience summary ("Enrolled in this campaign").
- The audience KPI strip was reduced to one inline summary line; warning figures only render when non-zero.
- "Campaign recipients" table heading → "Enrolled in this campaign".

## Robustness fix

- `AuthContext.checkAuth` now clears the session **only on 401/403**. A transient 429 (rate limit) or network failure no longer logs an authenticated user out.
