# QUASAR Timesheet Manager (Tauri rebuild)

This is a from-scratch rewrite of [QUASAR Timesheet Manager](../README.md)
— a click-and-drag weekly timesheet with two-way Jira integration — from
Python/Tkinter to [Tauri](https://tauri.app/) (a Rust backend + a React/
TypeScript frontend running in the OS's native webview). It has replaced
the Python app as of its merge into `main`; see "Status" below.

It reads and writes the **same SQLite database** the existing Python app
uses (`~/.jira_timesheet/timesheet.db`), so switching between the two apps
carries every Project/Activity/time entry over untouched — nothing to
export/import, nothing to migrate by hand.

## Status

- Feature-complete relative to the Python app, plus some things the Python
  app doesn't have (see "What's new" below).
- Merged into `main`, currently versioned `2.0.0` (kept in sync by hand
  across `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
  and `src/version.ts` — see the comment on `APP_VERSION`).
- **Release automation now builds this app.** The repo's
  `.github/workflows/release.yml` builds and packages this Tauri app (not
  the old Python one, which it built until now) whenever a version tag is
  pushed — see the top-level README's "Cutting a release" section for the
  exact steps. Until the first tag's pushed under this workflow, there's
  still no downloadable build; running it means running it from source
  (see "For developers" below), or building it locally with
  `npm run tauri build`.

## What's new (vs. the Python app)

- **Automatic updates**: a few seconds after launch, the app checks
  GitHub's latest Release for a newer, cryptographically signed build and
  offers a one-click update (downloads, installs, restarts into it) --
  see "Checking for updates" below. Declining remembers that version, same
  as the Python app's own update popup did, so it won't ask again until
  something newer ships; **Settings → Updates** has a manual check too.
- **Tasks**: a personal kanban board (To Do / In Progress / Done),
  separate from Activities and the Timesheet — no Jira link, just a
  straightforward to-do list. Drag a card between columns or within one to
  reorder it; priority (Low/Medium/High) shows as a green/yellow/red
  outline on the card rather than a word, and an optional deadline turns
  red once it's overdue. Done cards clear out on their own every Friday at
  9pm so the board doesn't pile up — To Do and In Progress are never
  touched.
- **Timer bar**: pick an Activity from the dropdown next to the tabs,
  Start, and Stop logs a time block for however long it ran (rounded to
  the nearest 15 minutes) straight onto today's Timesheet — no need to
  drag out a block by hand for work you're doing right now. Toggle it on
  in Settings; only shown on the Timesheet tab.
- **Department-aware Jira integration**: pick Quality Assurance or
  Accreditation in Settings/onboarding, and every Jira-facing piece of the
  app (the sub-task prefix, the Jira Project an Activity uploads under,
  import/search) automatically uses that team's own project — QDM for
  Quality Assurance, TISACC for Accreditation — instead of being hardcoded
  to QDM.
- **Import from Outlook**: paste a published Outlook (or Google) shared
  calendar's `.ics` link once in Settings, then pull that week's meetings
  straight into the Timesheet as time blocks from one button — recurring
  meetings (daily standups, weekly syncs on specific days) are expanded
  correctly, including a meeting edited or cancelled for a single day.
- **Guided first-run tour**: a mandatory setup form (name, department,
  Jira connection) followed by a spotlighted walkthrough of every tab,
  rather than a static welcome screen.
- **Pre-upload Notes validation**: a block with an empty Notes field is
  highlighted red and blocks Upload to Jira until fixed, since Notes become
  the worklog's comment in Jira.
- **Shift+click** a block to duplicate it and jump straight into editing
  the copy (filling in Notes), rather than duplicate-then-double-click.
- OS-native secret storage for the Jira API token (macOS Keychain/Windows
  Credential Manager/Secret Service) instead of an app-managed encrypted
  file.
- Light/Dark/Glassy/Custom themes, a resizable/collapsible Activities
  sidebar (drag the handle, or click it to collapse — Timesheet and
  Template both have their own independently), and a redesigned toolbar
  (segmented week nav, a corner zoom control, Apply Template inline).
- **Fixed visual size regardless of Windows' display scale setting**: this
  app is built and designed around 100% scale, and most colleagues' PCs
  default to 150% -- rather than rendering visibly larger/coarser there
  the way a plain web page would, `src/lib/windowsScale.ts` measures the
  OS scale via `devicePixelRatio` and applies an equal-and-opposite CSS
  zoom so the app always looks like its 100% self. Windows-only (a no-op
  on macOS, where a high devicePixelRatio means a real Retina display, not
  a scale setting to counter) and stays correct live if the window moves
  to a different-DPI monitor or the scale setting changes mid-session.

## Using the app

**First launch**: a mandatory form asks for your name, department (Quality
Assurance or Accreditation), and Jira connection (Site URL, Email, API
Token — see "Getting a Jira API token" in the [root README](../README.md#getting-a-jira-api-token)
for that part), then drops you into a guided tour of every tab. Everything
here stays editable later from **Settings**.

**Timesheet** (the weekly calendar)
- Monday–Friday by default (toggle weekends in Settings), in 30-minute
  slots. **Drag** across empty slots to create a time block; with an
  Activity armed in the sidebar it's created immediately, otherwise a
  picker opens.
- **Drag an edge** to resize a block, **drag the middle** to move it
  (including to a different day). **Double-click** to edit its Activity
  and Notes.
- **Ctrl/Cmd+click** a block to duplicate it in place, or **Ctrl/Cmd+drag**
  it to duplicate straight to wherever you drop it (the original stays put
  either way). **Shift+click** to duplicate in place *and* jump straight
  into editing the copy.
- **Click** a block to select it (**Delete**/**Backspace** removes it,
  arrow keys nudge it); **Ctrl/Cmd+Z** undoes, **Ctrl/Cmd+Shift+Z** (or
  **+Y**) redoes — Timesheet and Template each keep their own history.
- The magnifying-glass control in the grid's corner zooms the row height
  in/out; **‹ Today ›** switches weeks.
- **Apply Template to This Week** copies every block from the Template tab
  onto the currently-shown week (slots already occupied are left alone).
- **Import from Outlook** fetches this week's events from your saved
  calendar link (or one pasted on the spot) and lets you review, assign
  each to an Activity, and import the ones you want — see "Import from
  Outlook" below.
- **Upload to Jira** sends this week's linked, not-yet-uploaded blocks as
  worklogs — see "Uploading to Jira" below. Blocks missing Notes, or filed
  under an Archived (Jira-Closed) Activity, block the upload with an
  explanation until fixed.

**Timer bar** — shown just below the tabs when enabled (Settings, and
Timesheet only). Pick an Activity from its dropdown and hit **Start**; hit
**Stop** and it logs a block for today from start to stop, rounded to the
nearest 15 minutes. Closing the app while it's running asks whether to log
what's elapsed so far first.

**Activities sidebar**
- Hover an Activity for a pencil to quick-edit it, or hover a Project's
  name for a **+** to add a new Activity underneath it — no need to leave
  Timesheet. Click an Activity to arm it (then click/drag on the grid to
  log time against it).
- **Drag the handle** on the sidebar's right edge to resize it, or click it
  to collapse/expand — Timesheet and Template each remember their own
  width independently.
- The **Activities** tab has the fuller Project/Activity management —
  create/edit/archive either, and **Import from Jira** to bulk-pull your
  assigned sub-tasks (see below) instead of adding them one at a time.
- A new/edited Activity's Jira Key only asks for the number — the QDM-/
  TISACC- prefix (whichever your department uses) is filled in
  automatically and required, since it's what Upload to Jira needs.

**Template** — a permanent Monday–Friday grid, not tied to any real date,
for meetings that repeat every week. Build it once; **Apply Template to
This Week** (on Timesheet) copies it onto whichever week is showing. Has
its own resizable Activities sidebar, same as Timesheet.

**Tasks** — a personal kanban board (To Do / In Progress / Done), entirely
separate from Activities and the Timesheet: no Jira link, nothing here
ever appears as time logged. **+ Add Task** on a column creates a card
there directly; click a card to edit its title, description, priority, or
deadline, or to delete it. **Drag** a card to another column, or up/down
within one to reorder it — a dashed slot shows exactly where it'll land.
Priority shows as the card's own outline color (green/Low, yellow/Medium,
red/High) rather than a label, and a deadline turns red once it's passed.
Every Friday at 9pm, Done cards clear out on their own so the board
doesn't pile up with finished work — To Do and In Progress are never
touched, and this runs the moment the app's next opened if it happened to
be closed right at 9pm.

**Summary** — total hours by Project or Activity for a chosen week or
month, with logged-vs-expected tracking; reflects Timesheet entries only
and refreshes automatically.

**Import from Jira** (Activities tab) — pulls every QDM/TISACC sub-task
assigned to you straight from Jira's API (needs a saved API token), and
groups the results by the internal Project each one probably belongs to
(guessed from its parent issue's name, editable per row before importing).
A Closed one you sort into an active Project is reopened in Jira
automatically as part of importing it.

**Import from Outlook** — paste a published shared-calendar `.ics` link
into **Settings → Outlook Calendar Import** once, and the Timesheet's
**Import from Outlook** button fetches it automatically from then on (a
different link can still be pasted in on the spot instead, without
touching Settings). Only events on the days currently shown are pulled in;
each one gets assigned to an Activity before it becomes a real time block,
and an event that already matches something on your timesheet (same date/
time) is skipped automatically so re-importing is always safe.

**Uploading to Jira** — **Settings → Jira Cloud Upload** needs a Site URL,
Email, and API Token saved and verified first (token stored in this
machine's OS keychain, never in the database). Once connected, **Upload to
Jira** on the Timesheet sends every linked, not-yet-uploaded block for the
shown week as a worklog against its Jira Key, using each block's Notes as
the worklog comment.

**Theme** — Settings has Light, Dark, Glassy (translucent/blurred), and
Custom (your own color pickers), applied instantly and remembered.

**Checking for updates** — `src/api/updater.ts` asks GitHub's latest
Release for a `latest.json` manifest (published alongside every release --
see `.github/workflows/release.yml`) a few seconds after launch, comparing
its version against this build's own. If it's newer, a popup offers to
update; **Later** remembers that version (in this browser profile's local
storage, not the database) so it won't ask again until something newer
than *that* ships, and **Settings → Updates** has a manual check any time,
which always shows the result regardless of what was previously declined.
Choosing to update downloads the matching signed build for whatever OS
it's running on, installs it, and restarts straight into it -- no zip to
unpack or shortcut to fix by hand. This only works once a real Release has
been published (a draft won't do -- see "Cutting a release" in the root
README) and needs a real network connection to GitHub; either failing is
treated the same as "no update right now," silently, same as the Python
app's own update check did.

**Keyboard shortcuts** (Settings has the full reference list)

| Keys | Action |
| --- | --- |
| Click + drag | Create a time block (or move/resize an existing one) |
| Ctrl/Cmd + click a block | Duplicate that block in place |
| Ctrl/Cmd + drag a block | Duplicate that block to wherever you drop it |
| Shift + click a block | Duplicate that block in place and open it for editing |
| Double-click a block | Edit its Activity and notes |
| Delete / Backspace | Delete the selected block |
| Escape | Deselect, disarm the current Activity, or close a dialog |
| Right-click | Disarm the current Activity |
| Arrow keys | Nudge the selected block (Timesheet only) |
| Ctrl/Cmd + Z | Undo (Timesheet only) |
| Ctrl/Cmd + Shift + Z (or + Y) | Redo (Timesheet only) |
| Enter in a text field | Save the dialog |
| Shift + Enter in Notes | Insert a newline instead of saving |

## For developers

### Running from source

Requires [Node.js](https://nodejs.org/) (18+) and
[Rust](https://www.rust-lang.org/tools/install) — Tauri needs both toolchains,
plus the platform prerequisites Tauri itself lists in its
[prerequisites guide](https://tauri.app/start/prerequisites/) (Xcode
Command Line Tools on macOS; the Visual Studio Build Tools + WebView2 on
Windows).

```bash
cd tauri-app
npm install
npm run tauri dev
```

This opens the app in a real native window, backed by a local dev server
with hot reload for the frontend (Rust changes trigger a full rebuild).

**Testing against scratch data** — by default the dev build points at the
same `~/.jira_timesheet/timesheet.db` the packaged app (and the Python
app) use, so it's easy to accidentally write test data into real data.
Set `QUASAR_DATA_DIR` to point it at a throwaway folder instead:

```bash
QUASAR_DATA_DIR=/tmp/quasar-dev-data npm run tauri dev
```

(this also switches Jira token storage to a plain file inside that folder
instead of the real OS keychain — see the comment in `src-tauri/src/
keychain.rs` for why: an unsigned dev binary doesn't have a stable code
identity for the OS keychain to key access to.)

**Browser-only preview (no native window)** — `npm run dev` starts just
the Vite dev server; opening it in a plain browser tab with `?mock=1` in
the URL (optionally `&onboarded=1` to skip the first-run form) swaps in an
in-memory mock of the Tauri backend (`src/devMock.ts`), so UI work can be
previewed/screenshotted without a real Tauri IPC bridge. This never
activates inside the packaged app or the real `tauri dev` window.

### Project layout

```
src-tauri/                  Rust backend
  src/db.rs                    SQLite connection + schema (shared with the Python app's DB)
  src/settings.rs               settings key/value table (name, department, theme, Jira config, ...)
  src/keychain.rs                 OS keychain access for the Jira API token
  src/activities.rs                 Project/Activity CRUD
  src/calendar.rs                    TimeEntry CRUD (the Timesheet's weekly blocks)
  src/templates.rs                    TemplateEntry CRUD + apply-to-week
  src/tasks.rs                          Task CRUD (the Tasks kanban board) + the weekly Done sweep
  src/jira.rs                            shared Jira API helpers (auth, site URL normalizing)
  src/qdm.rs                            searches Jira for a department's assigned sub-tasks
  src/worklog.rs                         uploads time entries to Jira as worklogs
  src/ics.rs                             fetches a shared calendar's .ics text (parsing is client-side)
  src/commands.rs                        #[tauri::command]s exposed to the frontend
  src/lib.rs                              app setup + the invoke_handler command list
src/                         React frontend
  api/                          typed wrappers around each Tauri command (one file per Rust module above)
  screens/                       CalendarScreen (Timesheet), ActivitiesScreen, TemplateScreen, TasksScreen, SummaryScreen, SettingsScreen
  components/                     modals, the Activities sidebar, the calendar grid, the Timer bar, the onboarding form/tour
  lib/date.ts                       date/time helpers shared across screens
  lib/ics.ts                         .ics parsing + recurrence expansion for Import from Outlook
  lib/useResizableSidebar.ts          drag-to-resize/collapse, shared by Timesheet and Template's sidebars
  theme/                             the four themes' color palettes + the ThemeProvider
  devMock.ts                         in-memory backend mock for browser-only preview (see above)
```

### Building

```bash
npm run build       # tsc + vite build (frontend only, into dist/)
npm run tauri build # full native app bundle for the current OS
```

There is no cross-compiling — a native bundle has to be built on the same
kind of machine it's meant to run on, same as the Python app's PyInstaller
packaging. `.github/workflows/release.yml` does this for both macOS and
Windows on a version tag -- see the root README's "Cutting a release."

`tauri.conf.json`'s `bundle.createUpdaterArtifacts: true` means
`npm run tauri build` now needs a signing key to actually produce a
bundle, not just to publish one -- without `TAURI_SIGNING_PRIVATE_KEY` (and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, if the key has one) set in the
environment, the build fails outright rather than silently skipping
update-artifact signing. CI has the real key as a repo secret; for a
one-off local build, either export that same key material locally or
temporarily flip `createUpdaterArtifacts` to `false` -- a build made that
way just won't carry a valid update payload (fine for local testing, not
for anything handed to a colleague).

### Tests

```bash
npx tsc --noEmit          # type-check the frontend
cargo check               # type-check the Rust backend (run from src-tauri/)
```

No automated UI/integration test suite yet — changes are verified manually
(the `?mock=1` browser preview for fast iteration, then a real `tauri dev`
run against scratch `QUASAR_DATA_DIR` data before calling something done).
