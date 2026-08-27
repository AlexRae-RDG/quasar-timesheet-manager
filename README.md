# QUASAR Timesheet Manager

A free, self-hosted desktop timesheet app inspired by Toggl Track's weekly
timeline view — click-and-drag time blocking, activities grouped into
color-coded projects, and a one-click Jira CSV export. Everything runs
locally, with no account, server, or internet connection required; all
data lives in a single SQLite file on your machine.

## Install and get started

**This is the fastest way to get going — no Python, no Terminal, no git.**

1. This repo is private — make sure you've been added as a collaborator
   (ask whoever shared this with you to add your GitHub account under the
   repo's **Settings → Collaborators**).
2. Go to the **[Releases](../../releases)** page and open the newest
   release (the one at the top).
3. Under **Assets**, download the zip for your OS:
   `QUASAR-Timesheet-Manager-macOS.zip` or
   `QUASAR-Timesheet-Manager-Windows.zip`.
4. Unzip it.
   - **macOS:** drag `QUASAR Timesheet Manager.app` into `/Applications`.
     First launch: right-click (or Control-click) it → **Open** → **Open**
     — needed once, since the app isn't signed with a paid Apple Developer
     certificate. After that, open it normally (double-click, Launchpad,
     Dock).
   - **Windows:** keep the whole unzipped `QUASAR Timesheet Manager`
     folder together (everything inside it is needed, not just the .exe).
     A Desktop shortcut to the .exe inside is the easiest way to launch it.
     Windows SmartScreen may warn about an "unrecognized app" the first
     time — click **More info** → **Run anyway**.
5. Open it. Your data is stored locally on your own machine (see
   "Updating the app" below for exactly where) — nothing is shared between
   colleagues, each person's timesheet is entirely their own.

On Linux, or if you'd rather run it from source, see "Running from
source" below.

## Updating the app

**If you're using a downloaded build (most people):** go back to the
[Releases](../../releases) page, download the newest zip, and repeat the
install steps above over your old copy. Your data isn't touched — it
lives separately (see below), not inside the app itself.

**If you're working from this source folder (developers):**
1. `git pull` to get the latest code.
2. **macOS:** double-click **`Update and Reinstall App.command`** at the
   repo root — it rebuilds the app from the current source and reinstalls
   it over the copy in `/Applications`, in one double-click (still opens a
   Terminal window since a rebuild needs one, but there's nothing to
   type).
3. **Windows/Linux:** re-run the matching build script under `packaging/`
   (see "Packaging as a native app" below) if you're using a packaged
   build, or just re-launch via `Start Free Timesheet.*` / `python3 app.py`
   if you're running from source — no rebuild needed for that.

Your data is stored at `~/.jira_timesheet/timesheet.db` (SQLite) no matter
how you run the app — updating never touches it. Delete that file to
reset to a clean slate. An older database — including from before
Activity/Project existed as separate concepts — is upgraded in place
automatically the first time you open it with a newer version.

## Running from source

Requires Python 3.8+ (already includes Tkinter on Windows/macOS).

Double-click the launcher for your OS — no terminal, nothing to type:

- **Windows:** `Start Free Timesheet.bat`
- **macOS:** `Start Free Timesheet.command` — first run only, Gatekeeper
  blocks it as downloaded-from-the-internet. If double-clicking only
  offers **Done**/**Move to Bin** with no **Open**, go to **System
  Settings → Privacy & Security**, click **Open Anyway** next to the
  blocked-file message, then double-click the file again and confirm
  **Open**. (Or, one Terminal command instead:
  `xattr -d com.apple.quarantine "Start Free Timesheet.command"` from the
  extracted folder — removes the block permanently.)
- **Linux:** `Start Free Timesheet.sh` (first time, right-click →
  Properties → Permissions → "Allow executing file as program").
  `Free Timesheet.desktop` also works as a launcher for file managers that
  support it.

Each of these runs `python3 app.py`. If a launcher doesn't work, the
fallback is:

```bash
python3 app.py
```

**Linux only:** Tkinter is a separate OS package. If you see
`ModuleNotFoundError: No module named 'tkinter'`, install it first:

```bash
sudo apt install python3-tk      # Debian/Ubuntu
sudo dnf install python3-tkinter # Fedora
sudo pacman -S tk                # Arch
```

## Using the app

**Calendar**
- Monday–Friday, 9am–5pm in 30-minute slots (edit `SLOT_MINUTES` in
  `app/config.py` for finer granularity). The grid resizes with the
  window.
- **Drag** across empty slots to create a time block — opens a "Time
  Block" tab to pick the activity, adjust day/time, and add notes.
- **Drag an edge** to resize a block, **drag the middle** to move it
  (including to a different day). **Double-click** a block to jump
  straight to its Edit tab. **Right-click** to edit, duplicate, or delete.
- **Ctrl+click** a block to instantly duplicate it into its own slot.
  **Duplicate…** copies a block onto other weekdays you check off.
- Overlapping blocks are allowed — the calendar splits them into
  side-by-side columns automatically.

**Keyboard shortcuts & undo/redo** (click the calendar first so it has
focus)
- **Click** a block to select it; **Delete**/**Backspace** removes it.
- **Left/Right arrow**: moves a selected block a day, or the whole week if
  nothing's selected. **Up/Down arrow**: moves a selected block's time
  earlier/later. **Esc**: cancels a drag or deselects.
- **Ctrl+Z**/**Cmd+Z** undoes the last change on the current tab;
  **Ctrl+Shift+Z**/**Ctrl+Y** redoes it. Timesheet and Template each keep
  their own undo history.

**Template (recurring meetings)**
- The **Template** tab is a permanent weekly grid, not tied to any real
  date — build out meetings that repeat every week (standups, 1:1s).
- On the **Timesheet** tab, click **Apply Template to This Week** to copy
  every Template block onto the current week (already-occupied slots are
  left alone).

**Summary**
- The **Summary** tab shows total hours for a chosen week or month.
  Toggle **Week/Month** and use **‹ Today ›** to navigate.
- **Group by: Activity/Project** switches between one row per activity or
  one row per project (activities rolled up). Reflects Timesheet entries
  only, and refreshes automatically.

**Theme**
- **Settings → Jira Export Settings…** (or **View → Theme…**) has 20
  curated color themes plus a **Custom** option with its own color
  pickers. Pick one, then **Save** to apply it across the app — your
  choice is remembered next time you open it.

**Backup & Restore**
- **File → Backup & Restore…** backs up everything (activities, projects,
  time blocks, template, settings) to one `.db` file, or restores from one
  after confirming (this replaces everything currently in the app, so back
  up first if unsure). Refused while the Timer is running.

**Timer**
- The Timer bar (always visible, under the header) starts/stops a live
  count for a picked activity. **Stop** logs a block for today, rounded to
  the nearest 15 minutes (minimum 15). Locked to one activity while
  running; closing the app while it's running asks what to do with the
  time so far.

**Activities (left sidebar)**
- **+ Add** creates an activity (name + Project required, optional Jira
  Issue Key and default duration). **Click** an activity to arm it, then
  click an empty slot to drop in a block instantly. **Double-click**/
  right-click **Edit** to change it; existing blocks update to match.
  **Right-click Delete** asks whether to keep or remove its time blocks.
- The list scrolls (wheel, drag the scrollbar, or the arrow buttons) once
  it overflows — the same scrolling works on every tab in the app.

**Projects**
- **+ Project** creates a collapsible, color-owning group — every Activity
  belongs to exactly one Project, and that's what colors its time blocks.
  Recoloring a Project recolors everything inside it.
- **Right-click** a project for Collapse/Expand, Edit, or Delete (choose
  to keep its activities, which move into a catch-all **General**
  project, or delete them too — their time blocks are kept either way).

## Naming: "Activity" vs. "Project" vs. "Jira Project"

Three things could all reasonably be called "project," so to be explicit:

- **Activity** — what you actually pick and log time against (e.g.
  "Sprint Planning").
- **Project** — the color-owning group an Activity belongs to (e.g.
  "Client A"). Recoloring a Project recolors every Activity inside it.
- **Jira Project** — the real Jira project your time exports *into* (e.g.
  "Quasar Delivery Management"), unrelated to either of the above. Set a
  default once in **Settings**; override per-block only when needed.

The exported CSV's column header always reads **"Project"**, matching
what Jira's importer expects — "Jira Project" is purely this app's
internal naming, to avoid confusing it with its own Activity/Project
concepts.

(An older database — even one that named these concepts differently —
upgrades automatically the first time you open it.)

## Exporting to Jira

**File → Export to Jira CSV…** opens an "Export" tab to pick the current
week or a custom date range. Only blocks with a **Jira Issue Key** are
exported (others are skipped, with a summary shown afterward).

Columns:
```
Project,Issue Type,Key,Date Started,Display Name,Time Spent (h),Work Description
```

Example row:
```
Quasar Delivery Management,Sub-task,QDM-5455,2026-07-24 00:00:00,Alex Rae,1h 00m,Photocard test condition analysis
```

- **Project**/**Issue Type** — from the block's own value, else the
  activity's, else the defaults in **Settings → Jira Export Settings…**
  ("Task" is the final Issue Type fallback).
- **Key** — the block's Jira Issue Key. **Date Started** — the block's
  date at midnight. **Display Name** — set in Settings. **Time Spent
  (h)** — formatted like `1h 30m`. **Work Description** — the block's
  notes, or its activity name if empty.

Run a test import on a couple of rows first in Jira's CSV importer
(**System → External System Import → CSV**) — Atlassian recommends this
since exact behavior can differ slightly by Jira version.

## For developers

Internally, the source folder, launcher scripts, and data folder still
use the project's original "Free Timesheet"/"jira_timesheet" naming; only
the packaged app itself is branded "QUASAR Timesheet Manager".

### Project layout

```
app.py                     entry point
Start Free Timesheet.*     double-click launchers (Windows/macOS/Linux)
Free Timesheet.desktop     alternative Linux launcher
Update and Reinstall App.command   macOS only -- rebuilds and reinstalls over /Applications
packaging/                 PyInstaller build scripts -- see "Packaging as a native app" below
app/config.py               grid size bounds, default issue type, project color palette
app/theme.py                 20 curated palettes + custom picker, fonts, ttk styling
app/widgets.py                shared building blocks: RoundedButton, RoundedCard, ScrollArea, VectorScrollbar
app/models.py                Activity / Project / TimeEntry / TemplateEntry data classes
app/db.py                     SQLite layer (auto-migrates older DBs; backup_to/restore_from)
app/export_csv.py              Jira-matching CSV export
app/calendar_view.py            the weekly grid: drag/resize/move/duplicate, selection, undo/redo
app/timeblock_panel.py           embedded Add/Edit Time Block tab
app/summary_panel.py              the Summary tab
app/panels.py                      Duplicate/Activity/Project/Settings/Backup & Restore/Export tabs
app/sidebar.py                      activities list, grouped into collapsible projects
app/time_rounding.py                 minute-rounding helper (unit-testable, no Tkinter)
app/timer_bar.py                      the Timer bar
app/main_window.py                     header + timer bar + menu + window/tab assembly
tests/                                 unit tests + headless UI smoke tests
```

### Packaging as a native app

`Start Free Timesheet.*` needs Python installed on the machine running
it. For a double-clickable app that bundles Python/Tkinter inside itself,
build one with [PyInstaller](https://pyinstaller.org/) from the
`packaging/` folder — **you have to build it on the same kind of computer
you want to run it on** (no cross-compiling):

- **macOS:** `bash packaging/build_macos.sh` → `dist/QUASAR Timesheet
  Manager.app`. Same first-launch right-click → Open as above.
- **Windows:** `packaging\build_windows.bat` → `dist\QUASAR Timesheet
  Manager\QUASAR Timesheet Manager.exe` plus its supporting folder. Same
  SmartScreen warning as above.
- **Linux:** `bash packaging/build_linux.sh` → `dist/QUASAR Timesheet
  Manager/QUASAR Timesheet Manager`. Needs Tk's shared libraries present
  on whatever machine runs it.

Each script sets up its own disposable virtual environment under
`packaging/.build-venv`, generates icons if missing, and prints where the
app landed. `python3 app.py` keeps working alongside a packaged build
either way.

To update an already-installed macOS app instead of repeating this by
hand, see "Updating the app" above (`Update and Reinstall App.command`).

### Cutting a release

`.github/workflows/release.yml` runs both build scripts on GitHub's own
macOS/Windows runners and attaches the results to a GitHub Release
whenever a version tag is pushed:

```bash
git tag v1.1.0
git push origin v1.1.0
```

Check the **Actions** tab for the two build jobs; once they finish,
**Releases** has the new zips attached. Tag names must match `v1.2.3` —
there's no enforced versioning scheme beyond that. You can also trigger a
build manually from **Actions → Build and release → Run workflow**
without a tag (uploads as workflow artifacts instead of a Release —
useful for testing the build itself).

### Tests

```bash
python3 -m unittest discover -s tests -p "test_*.py" -v
```

Covers the SQLite layer, migrations, backup/restore, CSV export, and
timer rounding — no display needed. Eight more are headless UI smoke
tests that need a virtual display (`Xvfb`): `interactive_smoke_test.py`
(drag-create/resize/move/quick-assign/export, overlapping blocks,
Ctrl+click-duplicate, templates, projects), `theme_toggle_smoke_test.py`
(all 20 palettes + Custom, persistence, legacy settings migration),
`ui_fixes_smoke_test.py` (tabs-not-popups, sidebar sizing/scrolling),
`timer_smoke_test.py` (Start/Stop, rounding, overlaps, theme-change
survival), `keyboard_undo_smoke_test.py` (selection, shortcuts, per-tab
undo/redo), `summary_smoke_test.py` (totals, grouping, navigation),
`backup_restore_smoke_test.py` (backup/restore round-trip, guards), and
`double_click_edit_smoke_test.py` (double-click jumps to Edit with the
right data).

### Making a change and shipping it

1. **Make the change** under `app/`.
2. **Test it** — run the command above; add or update a
   `*_smoke_test.py` if it touches UI behavior.
3. **Commit** with a message explaining *why*, not just *what*.
4. **Push** — `git push`. The change is now backed up on GitHub, but
   colleagues on a downloaded build don't have it yet.
5. **Cut a release if it's worth colleagues getting** (see above) — not
   every commit needs one.
6. **Let colleagues know** — there's no auto-update; they re-download
   from Releases when they want it (see "Updating the app" above).
