# Memoview — Cleanup Report & Feature Implementation Plan

_Last updated: 2026-07-17_

## Part 1 — Branch audit

Every branch was compared against `main`. Result:

| Branch | Verdict | Why |
| --- | --- | --- |
| `claude/obsidian-clone-architecture-YD0Mi` | **Safe to delete** | Fully merged into main. |
| `claude/m3-watcher` | **Safe to delete** | Fully merged into main. |
| `claude/m4-graph` | **Safe to delete** | Fully merged into main. |
| `claude/m5-m6-m8-finish` | **Safe to delete** | Fully merged into main. |
| `claude/release-pipeline` | **Safe to delete** | Fully merged into main (PR #5). |
| `claude/fix-pnpm-version-mismatch` | **Safe to delete** | Fully merged into main (PR #6). |
| `claude/implement-memoview-design-spv726` | **Safe to delete** | Fully merged into main (PR #9). |
| `claude/fix-windows-vault-open` (PR #7) | **Rescued — safe to delete** | Good fix that never got merged. Cherry-picked into this branch (see below). |
| `claude/m7-graph-view` (PR #8) | **Safe to delete — superseded** | Good idea, outdated implementation. See notes below. |

PRs #7 and #8 have been closed (with the fix rescued into this branch). The
session environment can only push to its own branch, so the branches themselves
still need one manual sweep — from any local clone:

```
git push origin --delete claude/obsidian-clone-architecture-YD0Mi claude/m3-watcher \
  claude/m4-graph claude/m5-m6-m8-finish claude/release-pipeline \
  claude/fix-pnpm-version-mismatch claude/implement-memoview-design-spv726 \
  claude/fix-windows-vault-open claude/m7-graph-view
```

(or GitHub → Branches page → trash icon per branch).

### The rescued fix: Windows crash on opening a vault (was PR #7)

This one is genuinely good and `main` did **not** have it, so it is included in
this branch as a cherry-pick:

1. `tauri-plugin-dialog` can return a `file:///C:/...` URL on Windows instead of
   a plain path; the old code turned that into an invalid `PathBuf` which
   cascaded into a process-killing panic. Now uses `FilePath::into_path()`.
2. A single malformed note could panic inside the parallel indexing pass and
   abort the whole app. The per-file parse is now wrapped in `catch_unwind`, so
   a bad file is skipped with a log line instead of crashing.

### The superseded idea: 3D graph view (was PR #8)

Good idea, but the implementation lost the race: it pulled in
`react-force-graph-3d` + three.js (a **1.34 MB** lazy chunk) while the design
revamp that later landed on `main` (PR #9) ships a hand-rolled 2D canvas
physics graph (`src/app/GraphView.tsx`, ~600 lines, **zero extra
dependencies**) with folder-accent colors, orbit/depth layouts, and physics
toggle. The 2D version fits the app better and is dramatically lighter.

**If 3D is ever wanted again**, don't resurrect the branch — reimplement on top
of the current `graphStore`:
- Keep `src/state/graphStore.ts` as the single data source (it already mirrors
  `GraphSnapshot` + deltas).
- Add a "3D" toggle next to the existing orbit/depth layout switch instead of a
  separate overlay, lazy-load the 3D renderer behind `React.lazy`.
- The one idea worth stealing from PR #8: highlight nodes/edges of currently
  open tabs (bright accent + dimmed rest). That works in the 2D graph too and
  is a nice, cheap follow-up.

### Other cruft noticed

- `plugins/file-explorer/` and `plugins/graph-view/` are **empty directories**
  (leftover scaffolding from the architecture milestone). Harmless, but they can
  be removed whenever; the real implementations live in `src/app/`.

---

## Part 2 — Auto-update ✅ (implemented on this branch)

> Status: everything below is implemented. The only manual step left is adding
> the `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret before cutting the next
> release tag.

Memoview is a Tauri v2 app with a working release pipeline
(`.github/workflows/release.yml`, builds Win/macOS/Linux on every `v*` tag).
Auto-update slots straight into that with the official updater plugin.

### How it works

Each release additionally publishes a signed `latest.json` manifest. The
installed app checks that URL on startup, and if the version is newer it
downloads, verifies the signature, installs, and relaunches.

### Steps

1. **Generate a signing keypair** (one-time, on your own machine):
   ```
   pnpm tauri signer generate -w ~/.tauri/memoview.key
   ```
   Add two GitHub Actions secrets: `TAURI_SIGNING_PRIVATE_KEY` (file contents)
   and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **Never commit the private key** —
   whoever holds it can push updates to every user.

2. **Rust side** — add crates and register plugins in `src-tauri`:
   - `tauri-plugin-updater` (the updater itself)
   - `tauri-plugin-process` (to relaunch after install)
   ```rust
   .plugin(tauri_plugin_updater::Builder::new().build())
   .plugin(tauri_plugin_process::init())
   ```

3. **`src-tauri/tauri.conf.json`**:
   ```jsonc
   "bundle": { "createUpdaterArtifacts": true },
   "plugins": {
     "updater": {
       "pubkey": "<public key from step 1>",
       "endpoints": [
         "https://github.com/RenzoWit35/memoview/releases/latest/download/latest.json"
       ]
     }
   }
   ```

4. **`release.yml`** — pass the secrets to the build step so `tauri-action`
   signs the artifacts and uploads `latest.json` automatically:
   ```yaml
   env:
     GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
     TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
     TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
   ```

5. **Frontend** — `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process`
   npm packages. On app start (e.g. in `App.tsx`):
   ```ts
   const update = await check();
   if (update) {
     // reuse the existing Toast system: "v0.2.0 available — Restart to update"
     await update.downloadAndInstall();
     await relaunch();
   }
   ```
   Nicer UX: show the toast with a button instead of installing silently, and a
   progress state while downloading.

6. **Capabilities** — allow `updater:default` and `process:allow-restart` in
   `src-tauri/capabilities/`.

### Caveats

- Updates only work for versions **released after** this ships — users on the
  current build still have to download once manually.
- Linux: only the AppImage bundle supports the updater (deb/rpm don't).
- The binaries stay unsigned OS-wise (SmartScreen/Gatekeeper warnings on first
  install remain); the updater signature is separate and only guards updates.

---

## Part 3 — Create notes & folders in-app

Currently the backend only exposes `vault_read/write/rename` — there is no
create. Plan:

### Backend (`src-tauri`)

1. New IPC commands in `src-tauri/src/ipc/mod.rs`:
   - `vault_create_note(parent_dir, name) -> TFile` — writes an empty
     `name.md`; if it exists, auto-suffix (`Untitled 1.md`, `Untitled 2.md`, …).
     Reject names with path separators / `..` and keep the path inside the
     vault root (same validation `vault_rename` already does).
   - `vault_create_folder(parent_dir, name) -> TFile` — `create_dir_all`, same
     validation.
2. No manual index bookkeeping needed: the M3 watcher already picks up
   filesystem events and emits tree/graph updates. Return the created path so
   the UI can open/select immediately without waiting for the event.

### Frontend

3. `src/ipc/invoke.ts`: `vaultCreateNote`, `vaultCreateFolder` wrappers +
   mock-backend support in `src/ipc/mock.ts` so browser dev keeps working.
4. `src/app/FileTree.tsx`:
   - Right-click context menu (the generic `ContextMenu.tsx` already exists):
     "New note", "New folder" on folders and on empty background; later
     "Rename" / "Delete" can join the same menu.
   - Two small icon buttons in the sidebar header (new-note / new-folder),
     matching the existing graph button style.
   - Inline naming: render the new entry with a text input in place (like
     Obsidian), commit on Enter/blur, cancel on Esc.
5. After creating a note, call `workspaceStore.openFile(path, name)` so it
   opens in a tab with the cursor ready.
6. Bonus: a "New note" entry in `CommandPalette.tsx` (creates in vault root or
   the folder of the active note).

---

## Part 4 — Editor formatting toolbar

The editor is CodeMirror 6 (`src/editor/createEditor.ts`). A toolbar is a thin
React strip that dispatches CM transactions on the existing `EditorView` —
no new dependencies needed.

### Requested behavior

The bar is **always visible while a file is open for editing** (not a floating
selection bubble), sitting at the top of `EditorPane`.

### Steps

1. **`src/editor/commands.ts`** — markdown formatting commands operating on the
   current selection(s):
   - `toggleWrap(view, marker)` for **bold** (`**`), _italic_ (`*`),
     ~~strikethrough~~ (`~~`), `inline code` (`` ` ``), ==highlight== (`==`).
     Selected text gets wrapped; already-wrapped text gets unwrapped; empty
     selection inserts the pair and puts the cursor inside.
   - `setHeading(view, level)` — rewrite the `#` prefix of the selected lines.
   - `toggleList(view, kind)` — `- ` bullets, `1. ` ordered, `- [ ] ` tasks.
   - `toggleBlockquote(view)` — `> ` prefix.
   - `insertWikilink(view)` — `[[|]]` with cursor between the brackets.
   - **Underline**: markdown has no underline syntax, so use `<u>…</u>` tags
     (renders in preview; this is also what Obsidian users do).
2. **Keyboard shortcuts** in `createEditor.ts`: `Mod-b` bold, `Mod-i` italic,
   `Mod-Shift-x` strikethrough, `Mod-u` underline, `Mod-e` inline code — same
   command functions, so toolbar and keys can never drift apart.
3. **`src/editor/Toolbar.tsx`** — button row rendered by `EditorPane.tsx`
   above the CM host div. Buttons call the commands via the existing `viewRef`
   and re-focus the editor afterwards. Include a heading-level dropdown.
4. **Active state**: on selection change, inspect the syntax tree /
   surrounding text to mark buttons active (bold button lit while the cursor is
   inside `**…**`). CM's `EditorView.updateListener` (already wired) can push
   the active-marks set into component state.
5. **Styling**: extend `src/styles.css` glass theme — slim bar, icon buttons
   with the existing `folderAccent` hover treatment, separator groups
   (text style | headings | lists | link).
6. Live preview note: `livePreview.ts` hides markup outside the active line;
   commands work on the underlying text, so no interaction issues expected —
   but verify toggling bold on a line that is not the active line.

### Suggested order

Part 3 (create notes/folders) → Part 4 (toolbar) → Part 2 (auto-update last,
so the first auto-updatable release already contains the new features).
