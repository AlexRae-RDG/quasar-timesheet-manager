# QUASAR Timesheet Manager

A free, self-hosted desktop timesheet app inspired by Toggl Track's weekly
timeline view — click-and-drag time blocking, a saved list of
activities/meetings grouped into color-coded projects, and a one-click
**Jira CSV worklog export**. Everything runs locally; no account, server, or
internet connection required. All data lives in a single SQLite file on your
machine.

(This app used to display the name "Free Timesheet" on screen — the code,
launcher scripts, and data folder underneath still use that older name, so
nothing about upgrading or where your data lives changes; only the heading
shown at the top of the window is new.)

## Getting the app (colleagues start here)

This repo is private, so you'll need to be added as a collaborator first
(ask whoever shared this with you to add your GitHub account under the
repo's **Settings → Collaborators**) -- once that's done, sign in to
GitHub and:

The easiest way to get a working copy -- no Python, no Terminal, no git
required -- is to download a ready-to-run build from this repo's
**[Releases](../../releases)** page:

1. Open the Releases page and find the newest release (the one at the top).
2. Under **Assets**, download the zip for your OS --
   `QUASAR-Timesheet-Manager-macOS.zip` or
   `QUASAR-Timesheet-Manager-Windows.zip`.
3. Unzip it.
   - **macOS:** drag `QUASAR Timesheet Manager.app` into `/Applications`.
     First launch, right-click (or Control-click) it → **Open** → **Open**
     in the dialog that appears -- needed once, since the app isn't signed
     with a paid Apple Developer certificate. After that, opening it
     normally (double-click, Launchpad, Dock) works every time.
   - **Windows:** keep the whole unzipped `QUASAR Timesheet Manager` folder
     together (everything inside it is needed, not just the .exe) and put
     it wherever you'd like -- a Desktop shortcut to the .exe inside is the
     easiest way to launch it from then on. Windows SmartScreen may warn
     about an "unrecognized app" the first time, for the same
     unsigned-binary reason -- click **More info** → **Run anyway**.
4. Open it. Your data is stored locally on your own machine (see "Opening
   the app" below for exactly where) -- nothing is shared between
   colleagues, each person's timesheet is entirely their own.

New builds show up on the Releases page whenever a new version ships --
just repeat the steps above with the newer zip to upgrade; your data isn't
touched by installing over an older version.

Prefer to run it from source instead (e.g. on Linux, which doesn't have a
downloadable build yet -- see "Packaging as a native app" below), or want
to see exactly what it's running? Read on.

## Opening the app

Requires Python 3.8+ (already includes Tkinter on Windows/macOS).

Double-click the launcher for your operating system — no terminal, nothing
to type:

- **Windows:** `Start Free Timesheet.bat`
- **macOS:** `Start Free Timesheet.command` — first run only, macOS
  Gatekeeper blocks it as downloaded-from-the-internet. If double-clicking
  (or right-click → Open) only offers **Done** / **Move to Bin** with no
  **Open** option, go to **System Settings → Privacy & Security**, scroll
  down to the blocked-file message, click **Open Anyway**, then double-click
  the file again and confirm **Open**. After that it opens normally with a
  plain double-click. (Alternative one-time fix if you're comfortable with a
  single Terminal command: `xattr -d com.apple.quarantine "Start Free Timesheet.command"`
  from the folder you extracted — removes the block permanently, no more
  prompts.)
- **Linux:** `Start Free Timesheet.sh` (first time, right-click → Properties
  → Permissions → "Allow executing file as program" — most file managers
  then let you double-click and choose **Run**). `Free Timesheet.desktop`
  is also included as an alternative launcher for file managers that
  support it.

Each of these just runs `python3 app.py` from wherever you extracted the
folder, and prints a clear message (instead of failing silently) if Python
isn't installed. If a launcher doesn't work for some reason, the terminal
command below always works as a fallback:

```bash
python3 app.py
```

**Linux only:** Tkinter is usually a separate OS package. If a launcher (or
the command above) reports `ModuleNotFoundError: No module named 'tkinter'`,
install it first:

```bash
sudo apt install python3-tk      # Debian/Ubuntu
sudo dnf install python3-tkinter # Fedora
sudo pacman -S tk                # Arch
```

Your data is stored at `~/.jira_timesheet/timesheet.db` (SQLite). Delete
that file to reset the app to a clean slate. If you're upgrading from an
older copy of this app — including versions from before **Activity**/
**Project** existed as two separate concepts (see "A note on naming"
below) — your existing database is upgraded in place automatically the
first time you open it with the new version, whatever naming scheme it
started from. Nothing is lost, and no manual steps are needed.

## Using the app

**Calendar (right side)**
- Monday–Friday, 9am–5pm, in 30-minute slots (edit `SLOT_MINUTES` in
  `app/config.py` to switch to 15-minute granularity).
- The grid is dynamic — resize the window (or maximize it) and the day
  columns and time slots stretch to fill the space, up to a comfortable
  maximum size (tune `MIN_DAY_WIDTH_PX`/`MAX_DAY_WIDTH_PX`/
  `MIN_SLOT_HEIGHT_PX`/`MAX_SLOT_HEIGHT_PX` in `app/config.py` if you want
  different bounds).
- **Drag** across empty slots to create a time block — a "Time Block" tab
  opens at the top of the window (next to "Timesheet") so you can pick the
  activity, adjust the day/time, and add notes. Click Save, Cancel, or
  Delete to return to the Timesheet tab.
- **Drag a block's top or bottom edge** to resize it.
- **Drag the middle of a block** to move it — including to a different day.
- **Right-click a block** to edit, duplicate, or delete it.
- **Ctrl+click a block** to instantly duplicate it into its own exact slot —
  a faster shortcut for the common case of "I need two of these right now,"
  the same gesture Toggl Track uses. Drag the copy to retime it afterward.
  (The "Duplicate…" right-click item is still there for copying to other
  weekdays.)
- **Duplicate…** opens a "Duplicate" tab where you check off any other
  weekday(s) to copy the block to — the fast way to fill out a repeating
  week (e.g. duplicate a standup across Tue–Fri in one go).
- **Overlapping time blocks are allowed.** Create, move, resize, or
  duplicate a block onto a time another block already occupies and both
  stay — the calendar automatically splits any set of time-overlapping
  blocks in a day into equal-width side-by-side columns (Toggl Track-style),
  so everything stays visible and clickable instead of one hiding behind
  the other.

Every one of the above — Time Block, Duplicate, Add/Edit Activity, Add/Edit
Project, Settings, Backup & Restore, Export — opens as a **tab** next to
"Timesheet" rather than a separate pop-up window, and only one is shown at a
time. That's
deliberate: on some Mac/Tk setups, pop-up windows can ignore where the app
asks them to open and appear off in a corner of the screen instead. Since
tabs live inside the main window, there's no separate window position for
that to go wrong — they always show up in the same place.

**Keyboard shortcuts & undo/redo**
- Click the calendar once (or switch to its tab) so it has keyboard focus,
  then:
- **Click a block without dragging it** to select it — it gets a
  highlighted outline. **Delete** or **Backspace** removes the selected
  block (same confirmation dialog as the right-click menu's Delete).
- **Left/Right arrow**: with a block selected, moves it to the previous/
  next day; with nothing selected, goes to the previous/next week (like
  the ‹/› buttons). Works the same on the Template tab, minus the
  week-navigation fallback (there's no week to change there).
- **Up/Down arrow**: moves the selected block's time a slot earlier/later.
- **Esc**: cancels a drag in progress, un-arms an activity queued from the
  sidebar, or deselects the selected block — whichever applies.
- **Ctrl+Z** (**Cmd+Z** on Mac): undoes the last create, move, resize,
  delete, or duplicate on whichever tab (Timesheet/Template) is currently
  open — each tab has its own independent undo history, since they hold
  different blocks. **Ctrl+Shift+Z** or **Ctrl+Y** (**Cmd+Shift+Z** on Mac):
  redoes it.

**Template (recurring meetings)**
- The **Template** tab, next to "Timesheet", is permanent — unlike the tabs
  above, it never hides itself. It's a weekly grid just like the Timesheet
  tab (with its own Activities sidebar), except it isn't tied to any real
  date: it always shows the same Monday–Friday layout, for meetings that
  repeat every single week (standups, 1:1s, recurring syncs).
- Build it out exactly like a normal week — drag to create, resize, move,
  right-click to edit/duplicate/delete, or arm an activity from its
  sidebar and click a slot to quick-assign. It's saved permanently and
  never expires or gets cleared.
- Back on the **Timesheet** tab, click **Apply Template to This Week** in
  the nav bar to instantly copy every block from the Template tab onto
  whatever week you currently have open — no need to recreate the same
  meetings by hand every week. Any slot on the target week that's already
  occupied is left alone (never overwritten) and reported after applying.
- Each block shows its activity name and, space permitting, its notes and
  time range — notes are prioritized over the time range so you can tell
  similar-looking activities apart at a glance. Very short blocks (like a
  15-minute standup) show just the name.
- Overlapping blocks are allowed here too, and render side by side the same
  way as the Timesheet tab.
- Daily totals are shown at the bottom of each day column.
- Use **‹ Today ›** to navigate weeks; today's column is tinted and shows a
  live current-time marker.

**Summary**
- The **Summary** tab, next to "Template", is permanent too. It shows total
  hours for a chosen week or month — a quick "where did my time go" view
  without opening the Jira CSV export.
- Toggle **Week / Month** in the top-right to switch the aggregation period;
  use **‹ Today ›** to navigate (a week at a time in Week mode, a month at a
  time in Month mode).
- A **Group by: Activity / Project** toggle switches between two views: one
  row per activity (the original view), or one row per Project with every
  activity inside it rolled up into a single total — useful when you want a
  more general split of your time (e.g. "how much went to Client Alpha
  overall") instead of a line for every individual meeting/task.
- Each row gets a color swatch (a Project's own color, or an activity's
  inherited Project color), name, a proportional bar, and its hours plus
  percentage of the period's total — sorted with the most time first. A
  period with nothing logged shows a simple empty-state message instead of
  an empty list.
- It reflects real Timesheet-tab entries only (not Template blocks, since
  those aren't tied to a real date) and picks up new/edited/deleted blocks
  automatically the next time you switch to it.

**Theme**
- Go to **Settings → Jira Export Settings…** (or **View → Theme…**, a
  shortcut to the same tab) to pick from seven built-in themes: **Sleek
  Indigo**, **Neon Cyan**, **Crisp Light**, **Emerald Terminal**, **Warm
  Amber**, **Violet Nebula**, and **Mac Glass** (a macOS-frosted-glass-
  inspired light theme). Each shows a live color preview; click one, then
  **Save** to apply it across the whole app. Your choice is saved and
  remembered the next time you open the app. (If you're upgrading from an
  older version that only had a light/dark toggle, that preference is
  mapped onto the closest of the seven automatically -- light → Crisp
  Light, dark → Sleek Indigo.)
- Buttons, cards, the scrollbar thumb, and time blocks are all hand-drawn
  with rounded corners rather than ttk's sharp-cornered defaults, for a
  softer, more modern look throughout.
- In every dark theme, anything drawn as a layer *on top of* a panel — a
  project's header row and the calendar's day-of-week strip in the sidebar/
  grid, a Settings/Cancel-style button's idle fill, a nav button's hover
  state, a combobox's dropdown list — now uses a shade **lighter** than the
  panel underneath it, instead of darker. Darker-on-dark was hard to read
  (some of these elements nearly disappeared into their background); every
  theme's light/dark direction is chosen so overlapping elements stay
  clearly distinguishable from what's behind them.

**Backup & Restore**
- Go to **File → Backup & Restore…** (its own tab, since Settings' Display
  Name/defaults/seven-theme picker already fills most of a window on their
  own) to back up or restore your entire database in one file.
- **Back Up Data…** writes everything — every activity, project, time block,
  the template, and your settings (including your theme) — to a single
  `.db` file you choose the location and name for. Nothing leaves your
  computer; it's a plain copy of your local data.
- **Restore from Backup…** picks a `.db` file (one made with Back Up Data,
  from this or an older version of the app) and replaces everything
  currently in the app with what's in it, after you confirm — this can't be
  undone, so back up your current data first if you're at all unsure. A
  backup from an older version of the app (even one using an older naming
  scheme for activities/projects) is upgraded automatically, the same as
  opening an old database file directly. Restoring is refused (with an
  explanation) while the Timer is running, so a live timer's time is never
  silently lost.
- Since restoring can change literally everything on screen, the app fully
  refreshes every tab right after — you don't need to restart it.

**Timer**
- The **Timer** bar sits right under the header, above the tabs, so it's
  always visible no matter which tab you're on. Pick an activity from the
  dropdown and click **Start Timer** — it counts up in real time (a red dot
  and a running clock make it obvious it's live).
- Click **Stop Timer** when you're done and it automatically logs a time
  block for *today*, with its length **rounded to the nearest 15 minutes**
  (a timer that ran for even a few seconds still logs a minimum 15-minute
  block — a 0-minute entry wouldn't mean anything). The Timesheet tab jumps
  to today's week so you can see it land.
- If the computed block overlaps something you already logged, it's logged
  anyway — same as anywhere else on the calendar — and the two blocks
  render side by side.
- The activity picker is locked while the timer is running (stop it to
  switch activities). Closing the app while a timer is running asks
  whether to log the time so far first, discard it, or not close.

**Activities (left sidebar)**
- **+ Add** opens an "Activity" tab to create a new activity/meeting: name
  and Project (both required), plus an optional Jira Issue Key and default
  duration in minutes. There's no color field here — an activity's color
  always comes from whichever Project it belongs to (see "Projects" below),
  and no Jira Project/Issue Type field either, on purpose — see "A note on
  naming" and Exporting to Jira below.
- **Click** an activity to "arm" it (it highlights, and the calendar shows a
  hint). Then **click any empty slot** on the grid to instantly drop in a
  block for that activity at its default duration — no dialog needed. Press
  **Esc** or click the activity again to cancel.
- **Double-click** or **right-click → Edit** an activity to change it in the
  same Activity tab — existing time blocks using that activity update
  automatically to match its new name/Jira key/Project (and therefore
  color).
- **Right-click → Delete** an activity. You'll be asked whether to keep or
  remove its existing time blocks.
- Once you have more activities/projects than fit in the visible area, the
  list scrolls — drag the scrollbar on the right edge, click above or below
  the thumb to page up/down, click-and-hold the small arrow buttons at the
  top and bottom of the scrollbar to step (they auto-repeat while held), or
  just **scroll the mouse wheel** anywhere over the list. The arrow buttons
  are there as a guaranteed fallback for the rare case where wheel/trackpad
  scroll events don't reach the app on your system — nothing needs
  collapsing just to see everything.
- This same scrolling — mouse wheel, drag-thumb, or click the arrows — works
  the same way on **every** tab/panel in the app (Settings, Duplicate,
  Activity, Project, Time Block, Export, Backup & Restore, and the sidebar
  on both the Timesheet and Template tabs), not just this list, so every
  button and field stays reachable even if the window isn't maximized.
- The sidebar itself also stretches wider along with the window (it never
  shrinks below a minimum usable width, but claims a modest share of any
  extra space you give the window — the calendar still gets the majority of
  it), instead of staying pinned at a fixed pixel width.

**Projects (organizing the Activities list and setting their color)**
- **+ Project** opens a "Project" tab to create a collapsible group: a name
  and a color. Every Activity belongs to exactly one Project — there's no
  "ungrouped" state — and a time block's color always comes from its
  activity's Project, never set on the activity itself. Recoloring a
  Project here instantly recolors every time block logged against any
  activity inside it.
- Assign an activity to a project from its own Activity tab — a **Project**
  dropdown sits right under Jira Issue Key, defaulting to the activity's
  current project. Changing it moves the activity into a different project
  immediately (and its time blocks pick up that project's color).
- **Click the arrow** on a project's header to collapse or expand it — the
  state is saved, so it stays that way next time you open the app. A
  project's activity count is shown next to its name.
- **Right-click a project** for Collapse/Expand, Edit…, or Delete. Deleting
  asks whether to keep its activities (they move into a catch-all
  **General** project rather than being left ungrouped) or delete them too
  (their existing time blocks are kept either way, same as deleting an
  activity directly).
- A **General** project always exists as the fallback destination for
  activities that lose their project this way (or, on upgrade, for any
  activity that predates the Project concept) — you can rename it like any
  other project, and if it's ever deleted itself, a fresh one is created
  automatically for whatever still needs it.
- Projects and their collapsed/expanded state are shared between the
  Timesheet and Template tabs — each has its own Activities sidebar, but
  both list (and group) the exact same activities and projects.

## A note on naming: "Activity" vs. "Project" vs. "Jira Project"

This app has three different things that could all reasonably be called
"project," and it's worth being explicit about which is which so the
sidebar, Settings, and Time Block screens don't feel ambiguous:

- **Activity** (the leaf items in the sidebar, e.g. "Sprint Planning,"
  "Client A Retainer") is *this app's* concept of what you're spending time
  on. This is what you pick from the sidebar, arm, and drop onto the
  calendar — it's what a time block is actually logged against.
- **Project** (the collapsible groups in the sidebar, e.g. "Client A,"
  "Internal Work") is how Activities are organized, and — unlike a plain
  folder — it's also what sets their color: every Activity belongs to
  exactly one Project, and all of that Activity's time blocks are colored
  by whichever Project it's in. Recoloring a Project instantly recolors
  every time block for every Activity inside it.
- **Jira Project** (e.g. "Quasar Delivery Management") is the actual Jira
  project your time gets exported *into* — a property of Jira's CSV
  importer, unrelated to either of this app's own Activity/Project
  concepts above. It's normally the same for every row you export, so you
  set it once as a default in Settings and rarely think about it again; a
  per-block "Jira Project" override exists only for the rare case where a
  specific time block needs to export somewhere different. Both the
  Settings screen and the Time Block editor show a small caption under this
  field as a reminder of the distinction.

(Earlier versions of this app used different names for these two concepts —
including a version where the leaf items were themselves called "Project,"
with no separate color-owning group at all — see "Opening the app" above
for how an existing database from any older version upgrades
automatically, whatever it originally called things.)

However you set it, the exported CSV's column header always reads
**"Project"** (matching what Jira's CSV importer expects) — the "Jira
Project" naming is purely internal/UI, to avoid confusing it with this
app's own Activity/Project concepts.

## Exporting to Jira

**File → Export to Jira CSV…** (or the header button) opens an "Export" tab
where you pick the current week or a custom date range for the export.

Only time blocks that have a **Jira Issue Key** assigned are exported (blocks
without one are skipped, and you'll see a summary of what was skipped after
exporting). Set a Jira Issue Key per activity, or per individual time block
via its edit dialog.

The exported CSV has these columns:

```
Project,Issue Type,Key,Date Started,Display Name,Time Spent (h),Work Description
```

for example:

```
Quasar Delivery Management,Sub-task,QDM-5455,2026-07-24 00:00:00,Alex Rae,1h 00m,Photocard test condition analysis
```

Each column comes from:
- **Project** — the CSV's Jira project column (see "A note on naming"
  above). Filled from the block's own **Jira Project**, else the activity's
  **Jira Project** (copied onto the block when it was created from that
  activity), else the **Default Jira Project** set in **Settings → Jira
  Export Settings…**. Same fallback chain for **Issue Type**, with "Task" as
  the final fallback if nothing else is set. Since this is normally the same
  for every activity, set the default once in Settings and every exported
  row uses it automatically — no per-activity setup needed unless a
  particular block really does need something different.
- **Key** — the block's Jira Issue Key.
- **Date Started** — the block's date at midnight (`YYYY-MM-DD 00:00:00`).
- **Display Name** — the **Display Name** set in Settings.
- **Time Spent (h)** — the block's duration, formatted like `1h 30m`.
- **Work Description** — the block's notes, or its activity name if it has
  no notes.

Go to **Settings → Jira Export Settings…** (opens a "Settings" tab) to set
your Display Name and defaults before exporting. In Jira's CSV importer
(**System → External System Import → CSV**), run a test import on a couple
of rows first — Atlassian recommends this, since exact import behavior can
differ slightly by Jira version/instance.

## Packaging as a native app

The "Start Free Timesheet.*" launchers described under "Opening the app"
above need Python installed on the machine that runs them. If you'd rather
have a real, double-clickable **Free Timesheet.app** (macOS), **Free
Timesheet.exe** (Windows), or Linux binary that bundles Python and Tkinter
inside itself -- so it runs with nothing else installed -- everything for
that lives in the `packaging/` folder, built with
[PyInstaller](https://pyinstaller.org/).

**You have to build it on the same kind of computer you want to run it
on.** PyInstaller bundles the actual Python interpreter and native
libraries of whatever machine runs it -- it doesn't cross-compile, so
there's no way to produce a Mac app from a Windows PC, or vice versa. Pick
the script matching the computer you're building *on*:

- **macOS:** `bash packaging/build_macos.sh` → produces `dist/QUASAR
  Timesheet Manager.app`. This is the one time Terminal is actually needed
  -- after this, drag the .app into Applications and every future launch is
  a plain double-click, no Terminal window involved. First launch needs a
  right-click → Open → Open (once) since the app isn't signed with a paid
  Apple Developer certificate -- the script explains this at the end too.
- **Windows:** double-click `packaging\build_windows.bat` (or run it from a
  Command Prompt) → produces `dist\QUASAR Timesheet Manager\QUASAR
  Timesheet Manager.exe` plus a folder of supporting files it needs
  alongside it. Windows SmartScreen may warn about an "unrecognized app"
  the first time, for the same unsigned-binary reason -- click "More info"
  → "Run anyway".
- **Linux:** `bash packaging/build_linux.sh` → produces `dist/QUASAR
  Timesheet Manager/QUASAR Timesheet Manager`, a binary plus its supporting
  files. It still needs Tk's shared libraries already present on whatever
  machine runs it (the same ones `python3-tk` depends on) since those
  aren't the kind of thing that bundles portably -- if it won't launch on a
  different machine than the one that built it, that's the first thing to
  check.

(The packaged app is named "QUASAR Timesheet Manager" to match the
on-screen branding; the source folder, launcher scripts, and data folder
underneath all still use the project's original "Free Timesheet"/
"jira_timesheet" naming -- see the note at the top of this README.)

**Updating an already-installed macOS app later, without repeating the
whole process by hand:** double-click **`Update and Reinstall App.command`**
at the repo root instead of running `build_macos.sh` yourself -- it rebuilds
from whatever source is currently in this folder and copies the result
straight into `/Applications`, replacing the previous version, in one
double-click (still opens a Terminal window, since a real rebuild needs
one, but there's nothing to type). The normal flow for picking up a newer
version of the app is: replace this extracted folder's contents with the
new version, then double-click that file. Your data isn't touched either
way -- it's stored separately at `~/.jira_timesheet/timesheet.db`, not
inside the app bundle.

Each script sets up its own disposable virtual environment under
`packaging/.build-venv` (installing PyInstaller into it, not your regular
Python), generates the app's icon files if they're not already there, and
prints exactly where the finished app landed and how to open it. None of
this touches the plain `python3 app.py` way of running the app -- both
keep working side by side.

`packaging/free_timesheet.spec` is the PyInstaller build recipe the
scripts above call; `packaging/make_icons.py` draws the app's icon (a
larger, higher-resolution version of the same mark `app/theme.py` draws in
the header) and writes `packaging/icons/icon.{png,ico,icns}` -- those three
files are already committed, so a fresh checkout doesn't need Pillow just
to have an icon; re-run the script only if you change the design. Note:
this hasn't been run through an actual PyInstaller build in the environment
that wrote it (PyInstaller isn't installable there); if the very first
build on your machine hits friction, PyInstaller's own console output
usually explains what's missing.

### Cutting a release (so colleagues can just download it)

`.github/workflows/release.yml` runs both build scripts above on GitHub's
own macOS and Windows runners and attaches the results to a GitHub
Release, automatically, whenever a version tag is pushed -- that's what
the "Getting the app" section at the top of this README points colleagues
at. You don't need PyInstaller, or even a Mac/Windows machine, installed
anywhere yourself for this -- GitHub does the actual building.

To ship a new version:

```bash
git tag v1.1.0          # bump this -- see note below
git push origin v1.1.0
```

Then check the **Actions** tab for the two build jobs (a few minutes
each); once they finish, the **Releases** page has a new release named
after the tag, with both zips attached. Tag names must look like `v1.2.3`
(the workflow only fires on that pattern) -- what the numbers mean is up
to you, there's no enforced versioning scheme yet.

You can also trigger a build manually from the **Actions** tab ("Build and
release" → "Run workflow") without pushing a tag at all -- useful for
testing the build itself; without a tag it uploads the two zips as
workflow artifacts instead of attaching them to a Release.

## Project layout

```
app.py                 entry point
Start Free Timesheet.bat/.command/.sh   double-click launchers (Windows/macOS/Linux)
Free Timesheet.desktop  alternative Linux launcher for file managers that support it
Update and Reinstall App.command   macOS only -- rebuilds the packaged app from this
                          folder's current source and reinstalls it over the
                          previous version in /Applications, in one double-click
packaging/              build a real native app (.app/.exe/binary) with PyInstaller --
                          see "Packaging as a native app" above
app/config.py           grid size bounds, default issue type, project color palette
app/theme.py             seven theme palettes + picker-swatch drawing, fonts, ttk styling,
                          rounded-rect drawing helper
app/widgets.py            shared "modern look" building blocks: RoundedButton, RoundedCard,
                          ScrollArea (a rounded card with a built-in scrolling interior --
                          used by the sidebar and every embedded panel so nothing is ever
                          unreachable below full-screen), and VectorScrollbar
app/models.py            Activity / Project / TimeEntry / TemplateEntry data classes
app/db.py                 SQLite data-access layer (auto-migrates older DB files, whatever
                            naming scheme they used for activities/projects -- see the NOTE
                            ON NAMING comment at the top of the file; also backup_to/
                            restore_from for the Backup & Restore tab)
app/export_csv.py         Jira-matching timesheet CSV export
app/calendar_view.py       the drag/resize/move/duplicate weekly grid (Tkinter Canvas) --
                            also powers the permanent Template tab (template_mode), block
                            selection, arrow-key/Delete keyboard shortcuts, and per-tab
                            undo/redo
app/timeblock_panel.py      embedded Add/Edit Time Block tab, scrollable via ScrollArea
app/summary_panel.py         the permanent Summary tab -- total hours for a chosen week or
                              month, grouped by activity or rolled up by project
app/panels.py                embedded Duplicate, Add/Edit Activity, Add/Edit Project,
                              Settings, Backup & Restore, Export tabs, each scrollable via
                              ScrollArea
app/sidebar.py              activities list panel, grouped into collapsible, color-owning
                              projects, scrollable via ScrollArea (see app/widgets.py) --
                              click/drag/wheel and a click-and-hold arrow-button fallback --
                              once it overflows
app/time_rounding.py         pure "round elapsed minutes to the nearest 15" helper (no Tkinter,
                              so it's unit-testable without a display)
app/timer_bar.py             the Timer bar: pick an activity, Start/Stop, logs a time block
                              for today rounded to the nearest 15 minutes
app/main_window.py          header bar + timer bar + menu + window/tab assembly
tests/                       unit tests (db, CSV export, timer rounding, backup/restore) +
                              headless UI smoke tests (interactive, theme picker, dialog/
                              sidebar/calendar UI fixes, timer, keyboard shortcuts/undo-redo,
                              summary tab, backup/restore)
```

## Tests

```bash
python3 -m unittest discover -s tests -p "test_*.py" -v
```

These cover the SQLite layer (including the Template tab's recurring
entries, Apply Template to This Week, project CRUD/delete-reassignment, the
migrations that bring an older copy of the app's database up to the
current Activity/Project naming scheme whatever it started from, and
Database.backup_to/restore_from -- including restoring a legacy-named
backup and rejecting an unrelated non-Free-Timesheet database file), the
CSV export logic, and the timer's minute-rounding rule, all without needing
a display. There are also eight headless UI smoke tests that need a
virtual display (`Xvfb`) if you have one available:
`tests/interactive_smoke_test.py` exercises the real drag-create/resize/
move/quick-assign/export code paths end-to-end on both the Timesheet and
the Template tab, plus overlapping blocks rendering in side-by-side
columns, Ctrl+click-to-duplicate, Apply Template to This Week (including
its skip-if-already-applied behavior), and projects (create/rename/delete,
collapse/expand, assigning an activity to one, and the two delete-project
paths); `tests/theme_toggle_smoke_test.py` exercises the theme picker (all
twenty curated palettes plus Custom offered, a pending selection not
applying until Save, persistence, legacy settings values -- including the
old seven-palette ids and the light/dark toggle from before that --
mapping onto a sensible modern theme, state surviving the theme-change
rebuild, and every widget actually repainting); `tests/ui_fixes_smoke_test.py` exercises every dialog
opening as its own tab instead of a pop-up window, the Template tab staying
permanently visible while the others hide, the sidebar respecting its
minimum width and actually growing when the window is widened (while the
calendar still claims most of the extra space), the calendar's bottom
padding, and the Activities sidebar's scrolling (a real wheel event
delivered anywhere in the app, geometrically hit-tested against the
sidebar's list, including a negative case proving a wheel event elsewhere
doesn't scroll it, plus the hand-drawn scrollbar's own click-to-page/drag/
hover behavior and its click-and-hold arrow buttons) once it overflows; `tests/timer_smoke_test.py` exercises the Timer bar
end-to-end with a fully deterministic fake clock (Start/Stop logging a
rounded block, the 15-minute floor, logging straight through an
overlapping block with no prompt, surviving a theme-change rebuild
mid-run, and the close-while-running prompt);
`tests/keyboard_undo_smoke_test.py` exercises block selection, Delete/
Backspace, Esc, arrow-key day/week navigation and block-nudging, and
undo/redo for every kind of edit (create, quick-assign create, move/
resize, edit-via-dialog, delete, and both duplicate paths) -- including
that Ctrl+Z/Ctrl+Y dispatch to whichever tab is active, that each tab
keeps its own independent undo history, and that typing in a text field
doesn't trigger it; `tests/summary_smoke_test.py` exercises the Summary
tab's per-activity totals and percentages, the Group by Activity/Project
toggle (rolling multiple activities up into one project row and back),
Week/Month toggling, ‹ Today › navigation, the empty-state message for a
period with nothing logged, and that switching onto the tab refreshes it to
reflect an entry added elsewhere in the meantime; and `tests/backup_restore_smoke_test.py`
exercises the Backup tab end-to-end -- writing a real backup file and
verifying its contents, restoring from a separately-built database and
confirming the whole window (sidebar, calendar, timer bar, Summary tab,
theme, settings) reflects the restored data afterward, the confirmation
prompt actually blocking a declined restore, the timer-running guard, and
an invalid file being rejected with a warning instead of crashing;
and `tests/double_click_edit_smoke_test.py` exercises double-clicking a
time block jumping straight to its Edit tab (loaded with that exact
block's own data, not a blank one), double-clicking empty calendar space
still behaving exactly like a plain click always did, and that ordinary
single-click selection is unaffected.

## Making a change and shipping it

The repeatable process for any future update, from a code change to
colleagues being able to download it:

1. **Make the change.** Edit the code under `app/` as needed.
2. **Test it.** Run the non-GUI suite (`python3 -m unittest discover -s
   tests -p "test_*.py"`) -- it needs no display and covers the data/logic
   layer. If the change touches UI behavior, add or update one of the
   headless `*_smoke_test.py` files too (see "Tests" above for what each
   one covers) -- these need a real display (or `Xvfb`) to actually run,
   so they're not part of the plain `unittest discover` command, but
   they're what catches a UI regression the non-GUI tests can't see.
3. **Commit.** `git add` the changed files and `git commit` with a message
   explaining *why*, not just *what* -- same as any commit in this repo.
4. **Push.** `git push` sends it to GitHub. At this point the change is
   safely backed up and visible in the repo's history, but colleagues
   running an already-downloaded build don't have it yet -- that needs a
   release (next step).
5. **Cut a release, if this is worth colleagues getting.** Not every
   commit needs one -- batch up a few related changes if that makes more
   sense than shipping each individually. When you're ready:
   ```bash
   git tag v1.1.0          # bump the version -- see the note in "Cutting
   git push origin v1.1.0  # a release" above for what the numbers mean
   ```
   This is the same `.github/workflows/release.yml` pipeline described
   under "Cutting a release" earlier -- pushing the tag alone triggers it,
   nothing else to do. Check the **Actions** tab for the two build jobs,
   then the **Releases** page has the new zips once they finish.
6. **Let colleagues know.** There's no auto-update -- each person
   downloads the new zip from Releases and replaces their old copy (see
   "Getting the app" at the top) whenever they want the update. A quick
   message pointing at the new release is the only "distribution" step.

Steps 1-4 are worth doing for *every* change, however small, so the
repo's history stays a real record of what happened and why. Step 5 is
the only step that's actually optional per change -- it's what turns
"committed" into "colleagues can download it."
