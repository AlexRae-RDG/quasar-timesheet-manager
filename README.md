# QUASAR Timesheet Manager

A free, self-hosted desktop timesheet app inspired by Toggl Track's weekly
timeline view — click-and-drag time blocking, activities grouped into
color-coded projects, and one-click Jira integration both ways: import
your assigned QDMs straight from Jira, and send worklogs straight back,
with no CSV file to find and pick. Manual CSV-based versions of both
stay available too, for anyone who'd rather not set up API access.
Everything runs locally, with no account, server, or internet connection
required beyond the Jira API calls themselves; all data lives in a
single SQLite file on your machine.

> **This app has been rebuilt** in [`tauri-app/`](tauri-app/) on
> [Tauri](https://tauri.app/) (Rust + React) instead of Python/Tkinter,
> reading and writing this same SQLite database, and has replaced the
> Python app on `main`. Release automation now builds *that* app (see
> "Cutting a release" below) — until the first tag's pushed under it,
> though, the **Releases** page linked in "Install and get started" below
> still has the last Python build, and the walkthrough below still
> describes that app's exact behavior in a few places. See
> [`tauri-app/README.md`](tauri-app/README.md) for the new app's own
> setup instructions and current status.

## Install and get started

**This is the fastest way to get going — no Python, no Terminal, no git.**

1. Go to the **[Releases](https://github.com/AlexRae-RDG/quasar-timesheet-manager/releases)**
   page and open the newest release (the one at the top). This repo is
   public, so no GitHub account or invite is needed — anyone with the
   link can download it.
2. Under **Assets**, download the zip for your OS:
   `QUASAR-Timesheet-Manager-macOS.zip` or
   `QUASAR-Timesheet-Manager-Windows.zip`.
3. Unzip it.
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
4. Open it. Your data is stored locally on your own machine (see
   "Updating the app" below for exactly where) — nothing is shared between
   colleagues, each person's timesheet is entirely their own.
5. **First launch only:** a **Welcome** screen asks for your name, Jira
   email and Site URL (the last two pre-filled with a guess/default —
   check them, don't just skip past), plus a Jira API Token (see
   "Getting a Jira API token" below for that part — it takes under a
   minute), then drops you straight into importing your QDMs. This is
   what makes **Import QDM via API** and **Upload to JIRA via API** work
   — the two buttons on the tab row, and the fastest way to use this
   app day to day. "Skip for now" is right there too: the app is fully
   usable without it, the same setup is always available afterwards in
   **Settings → Jira Cloud Upload**, and the CSV-based manual
   alternatives under Settings → Manual Import need no setup at all.

On Linux, or if you'd rather run it from source, see "Running from
source" under "For developers" below.

### Getting a Jira API token

The **Welcome** screen prompts for this directly on first launch (see
above), with a **"Get an API token"** link right there; **Settings →
Jira Cloud Upload** has the same link if you skipped it then, or need a
new token later.

1. Click **"Get an API token"** — in the **Welcome** screen, or in
   **Settings → Jira Cloud Upload** (or go straight to
   `id.atlassian.com/manage-profile/security/api-tokens` in your
   browser). Log in with your `raildeliverygroup.atlassian.net`
   credentials if asked.
2. Click **Create API token**.
3. Give it a **label** — this is just for your own reference if you ever
   need to find or revoke it later, e.g. `QUASAR Timesheet Manager`.
4. Click **Create**. Atlassian shows you the token **once** — copy it
   immediately; you can't come back and view it again later, only revoke
   it and create a new one.
5. Paste it into the **API Token** field and save it — **Connect and
   import my QDMs** in the **Welcome** screen, or **Save API Token** (or
   the regular **Save**) in **Settings**. Either way it runs a quick
   connection test and confirms it worked before you move on.

The token is stored — encrypted — in this app's own local database,
right alongside your timesheet data and the rest of Settings, not your
operating system's keychain. Earlier versions used the OS keychain
instead, but an unsigned, frequently-rebuilt desktop app isn't a stable
"identity" as far as a keychain is concerned, so entries could silently
stop resolving after a rebuild or reinstall, meaning a trip back through
this whole walkthrough to generate a new one.

The decryption key lives in its own separate file next to the database
(`.jira_token.key` in the app's data folder) rather than inside it, which
is what makes **File → Backup & Restore…** safe to use: a backup file is
a straight copy of the database only, so it carries nothing but
unreadable ciphertext — the key never travels with it. That protects
against the realistic risk (a backup shared, emailed, or dropped in a
synced folder); it doesn't protect against someone with access to both
files on this same machine, which is the level an OS keychain adds on
top and this doesn't. Treat the token like a password regardless — it
acts as your full Jira identity for API calls made on your behalf. To
revoke one, go back to the same Atlassian page and click **Revoke** next
to its label, then generate and save a new one in the app.

## Using the app

**Calendar**
- Monday–Friday, 9am–5pm in 30-minute slots (edit `SLOT_MINUTES` in
  `app/config.py` for finer granularity). The grid resizes with the
  window.
- **Drag** across empty slots to create a time block — opens a "Time
  Block" tab to pick the QDM, adjust day/time, and add notes. Jira Project
  is a pick-from-list (with an option to add a new one) rather than free
  text, and Jira Issue Key only asks for the number — the "QDM-" prefix
  is added automatically.
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
- **Settings → Jira Export Settings…** (or **View → Theme…**) has a
  **System** option that follows your OS's light/dark appearance
  (default), 18 curated color themes, and a **Custom** option with its
  own color pickers. Pick one, then **Save** to apply it across the app
  — your choice is remembered next time you open it.

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
  Issue Key — just the number, "QDM-" is added automatically — and
  default duration). **Click** an activity to arm it, then
  click an empty slot to drop in a block instantly. **Double-click**/
  right-click **Edit** to change it; existing blocks update to match.
  **Right-click Delete** asks whether to keep or remove its time blocks.
- Adding QDMs one at a time this way is fine for a few, but **Import QDM
  via API** (tab row, or the prompt shown right here when the list is
  completely empty) bulk-imports every QDM assigned to you straight from
  Jira in one click — see "Importing QDMs from Jira" below.
- The list scrolls (wheel, drag the scrollbar, or the arrow buttons) once
  it overflows — the same scrolling works on every tab in the app.

**Projects**
- **+ Project** creates a collapsible, color-owning group — every Activity
  belongs to exactly one Project, and that's what colors its time blocks.
  Recoloring a Project recolors everything inside it.
- **Right-click** a project for Collapse/Expand, Edit, or Delete (choose
  to keep its activities, which move into a catch-all **General**
  project, or delete them too — their time blocks are kept either way).

## Importing QDMs from Jira

Adding QDMs one at a time (**File → Add QDM**, or "+ Add QDM" in the
sidebar) works fine for a handful, but if you've got a real backlog of
Jira issues assigned to you and none of them in this app yet, there's a
faster way in -- also the fastest way to get started on a fresh
install, which starts with no Projects or QDMs at all.

**The main way -- direct from Jira's API (needs a saved API token):**

Click **Import QDM via API** on the tab row (it also sits on the "+
Add QDM" screen, and -- on a fresh install with nothing added yet -- as
the prompt shown right in the empty sidebar) -- this is the main,
one-click way in. It needs **Settings → Jira Cloud Upload** set up
first (Jira Site URL, Email, API Token -- see "Uploading directly to
Jira" below); once that's saved, clicking it fetches every matching
QDM straight from Jira over the network, with no browser step and no
CSV file to find and pick. Without a token saved there, it just tells
you to set one up, or to use the manual route below instead.

**The manual fallback -- CSV export (no Jira API token needed):**

Under **Settings → Manual Import**, three buttons cover the no-token
path:

1. **Export QDMs from JIRA** -- opens your Jira site in the browser,
   already filtered to the right issues (only this app's Jira project,
   assigned to you, still in an active status). You need to be signed
   into Jira in your browser for this, nothing more.
2. In Jira: **Export → Export CSV (all fields)** (look for an Export
   button above the results, or in the ••• menu). "All fields" is the
   safe choice — it guarantees the two columns this app actually reads
   ("Issue key" and "Summary") are present no matter which columns your
   saved view happens to show; every other column in the file is
   ignored.
3. Back in **Settings → Manual Import**, click **Import QDM's from
   JIRA…** and pick the CSV you just exported.

Both routes land on the exact same review screen; only how you get the
QDMs out of Jira differs.

**Either way, once QDMs are found:**

1. Rows are filtered and deduplicated automatically, before you see
   anything: any row whose Issue Key isn't `QDM-<number>` is skipped (so
   a broad "assigned to me" search across other teams' projects doesn't
   drag unrelated issues in), and any row that's already a QDM in this
   app — active or archived — is skipped too, so re-running an import
   (or one that overlaps a previous export) is always safe and never
   creates a duplicate.
2. What's left is a review list, one row per new QDM: its Jira Key, an
   editable Name (pre-filled from the Jira Summary), and a Project picker
   — the same "+ New Project…" option the regular Add QDM form has, so
   you don't need to create Projects ahead of time. Untick anything you'd
   rather not add yet.
3. **Import All** creates them. Color still only ever comes from the
   Project each QDM lands in, same as adding one by hand.

## Uploading directly to Jira

**File → Upload to JIRA via API…** (or the "Upload to JIRA via API"
button on the tab row) sends worklogs straight to Jira over its REST
API — no CSV file, no manual import step. It's an alternative to the
CSV export above, not a replacement: both stay available (the CSV
route under Settings → Manual Import), and which one you use for a
given week is entirely up to you.

**Jira Cloud only** — this doesn't support Jira Server/Data Center.

A brand-new install walks you through this automatically on first launch
(the **Welcome** screen — see "Install and get started" above), with Site
URL and Email already pre-filled with a guess/default so most people can
leave them as-is. What follows is the same setup, field by field, for
anyone who skipped that screen or wants to change something later.

**One-time setup**, in **Settings → Jira Cloud Upload**:
1. **Site URL** — your Jira Cloud address. Pre-filled with
   `raildeliverygroup.atlassian.net` the first time you open Settings,
   since everyone on this app is on the same Jira instance — only change
   it if that's ever not true for you. (The `https://` is optional either
   way.)
2. **Email** — the email address you log into Jira with. Pre-filled with
   `firstname.lastname@raildeliverygroup.com` as a template the first
   time you open Settings, and auto-fills itself from **Display Name**
   as soon as you tab or click away from that field — type `Alex Rae` in
   Display Name and this becomes `alex.rae@raildeliverygroup.com` on its
   own. That only happens while Email is still blank or still showing
   the unedited template — type anything of your own into Email and it
   stops touching the field, permanently. Either way, double check it
   before saving; it's a starting guess, and the connection test below
   will catch a wrong one.
3. **API Token** — see "Getting a Jira API token" under "Install and
   get started" above for the full walkthrough. Once one is saved, the
   field itself shows a row of dots
   (●●●●●●●●) rather than staying blank, so you can tell at a glance
   that a token is stored — that's a placeholder, not your actual token;
   click into the field to clear it and type a new one. Click **Save API
   Token** right there to save just the token on its own (Site URL and
   Email need to be filled in first), or leave it alone and click the
   regular **Save** below to keep what's already stored (that button
   saves everything else in Settings too). "Clear stored token" removes
   it entirely.

Either **Save** button — **Save API Token**, or the regular **Save**
below it when Site URL, Email or the token actually changed — runs an
immediate connection test against Jira (a harmless "who am I" check, not
a real upload) and tells you straight away whether it worked: either
"Connected to Jira as ‹your name›", or exactly what's wrong (bad
credentials, a bad Site URL, or no network) so you can fix it on the
spot instead of finding out the first time you click "Upload to JIRA via
API" or "Import QDM via API".

The Site URL and Email fields only ever *pre-fill* like this (defaults or
auto-fill from Display Name) the *first* time Settings is opened on a
given computer, or while a field is still blank or unedited — once
you've saved a real value of your own, whatever you last saved is what
shows up from then on, never silently reset or overwritten.

**Using it**: pick a date range the same way as the CSV export. Only
blocks with a Jira Issue Key are sent (others are skipped, same as CSV
export). Every entry it successfully sends is marked as uploaded, so
**re-running it on the same (or an overlapping) date range only ever
sends entries that haven't been uploaded before** — safe to click again
without creating duplicate worklogs in Jira. This tracking is separate
from CSV export, which has no memory of what's already been imported.

Note: editing a time block's notes or duration *after* it's already been
uploaded doesn't automatically re-send it — there's no "update an
existing Jira worklog" step, only "create a new one", so this app
deliberately doesn't risk creating a duplicate over a small edit.

## Exporting to Jira

**Settings → Manual Import → Export to Jira CSV…** opens an "Export" tab
to pick the current week or a custom date range. Only blocks with a
**Jira Issue Key** are exported (others are skipped, with a summary
shown afterward). This is the manual, no-API-token alternative to
"Uploading directly to Jira" above -- see that section for the
automatic version, which stays on the main tab row since it doesn't
need a file picker.

Columns:
```
Project,Issue Type,Key,Date Started,Display Name,Time Spent (h),Work Description
```

Example row:
```
Quasar Delivery Management,Sub-task,QDM-5455,2026-07-24 00:00:00,Alex Rae,1h 00m,Photocard test condition analysis
```

- **Project**/**Issue Type** — from the block's own value if it sets one,
  else fixed at "Quasar Delivery Management" / "Sub-task" (the only values
  this app ever needs — no longer Settings-configurable, so there's
  nothing to mistype).
- **Key** — the block's Jira Issue Key. **Date Started** — the block's
  date at midnight. **Display Name** — set in Settings. **Time Spent
  (h)** — formatted like `1h 30m`. **Work Description** — the block's
  notes, or its activity name if empty.

Run a test import on a couple of rows first in Jira's CSV importer
(**System → External System Import → CSV**) — Atlassian recommends this
since exact behavior can differ slightly by Jira version.

## Updating the app

**If you're using a downloaded build (most people):** the app checks for
a newer release a few seconds after launch and, if one's out, offers a
popup with a one-click **Yes** — it downloads the new version, swaps it
in, and relaunches automatically, no unzipping or dragging required.
Choosing "No" won't ask again until something newer than that ships;
"Cancel" asks again next launch.

If that popup fails for any reason (no internet, a download hiccup),
it falls back to just opening the Releases page in your browser instead
of leaving you stuck — at that point, or if you'd rather update by hand
anyway, go back to the [Releases](../../releases) page, download the
newest zip, and repeat the install steps above over your old copy. Your
data isn't touched either way — it lives separately (see below), not
inside the app itself.

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

## For developers

Internally, the source folder, launcher scripts, and data folder still
use the project's original "Free Timesheet"/"jira_timesheet" naming; only
the packaged app itself is branded "QUASAR Timesheet Manager".

### Running from source

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

**Optional, for the "Upload to JIRA via API" and "Import QDM via API"
buttons only:** everything else in this app (including the CSV-based
"Export to Jira CSV"/"Export QDMs from JIRA"/"Import QDM's from JIRA…"
under Settings → Manual Import) runs with just the standard library.
Those two API-based buttons additionally need the two packages listed
in `requirements.txt`:

```bash
pip install -r requirements.txt
```

Skipping this is fine if you don't use those buttons — the app still
launches and runs normally; "Upload to JIRA via API" and "Import QDM
via API" just tell you what's missing if you click them without
installing these first.

### Project layout

```
app.py                     entry point
Start Free Timesheet.*     double-click launchers (Windows/macOS/Linux)
Free Timesheet.desktop     alternative Linux launcher
Update and Reinstall App.command   macOS only -- rebuilds and reinstalls over /Applications
packaging/                 PyInstaller build scripts -- see "Packaging as a native app" below
app/config.py               grid size bounds, default issue type, project color palette
app/theme.py                 18 curated palettes + system/custom dynamic themes, fonts, ttk styling
app/widgets.py                shared building blocks: RoundedButton, RoundedCard, ScrollArea, VectorScrollbar
app/models.py                Activity / Project / TimeEntry / TemplateEntry data classes
app/db.py                     SQLite layer (auto-migrates older DBs; backup_to/restore_from)
app/export_csv.py              Jira-matching CSV export
app/jira_csv_import.py          parses a Jira CSV export into candidate QDMs (see app/panels.py's ImportQdmPanel)
app/calendar_view.py            the weekly grid: drag/resize/move/duplicate, selection, undo/redo
app/timeblock_panel.py           embedded Add/Edit Time Block tab
app/summary_panel.py              the Summary tab
app/panels.py                      Duplicate/Activity/Import QDMs/Project/Settings/Backup & Restore/Export tabs
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

`.github/workflows/release.yml` builds the [`tauri-app/`](tauri-app/) app
(the Tauri rewrite, which replaced the Python app on `main`) on GitHub's
own macOS/Windows runners via [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action)
and attaches the results to a GitHub Release whenever a version tag is
pushed. **First, bump the version in all three places it's kept in sync
by hand** — `tauri-app/package.json`, `tauri-app/src-tauri/tauri.conf.json`,
and `tauri-app/src/version.ts`'s `APP_VERSION` — and commit that:

```bash
git tag v1.10.0
git push origin v1.10.0
```

Check the **Actions** tab for the two build jobs (macOS builds a
universal binary covering both Intel and Apple Silicon in one). Once both
finish, **Releases** has a new **draft** release with the built installers
attached — a macOS `.dmg` and Windows `.exe` (NSIS) / `.msi`, plus a couple
of secondary formats alongside them. It's left as a draft deliberately
(rather than going live the moment the first of the two platform jobs
finishes) so you can check both are attached before clicking **Publish**
yourself. Tag names must match `v1.2.3` — there's no enforced versioning
scheme beyond that. You can also trigger a build manually from
**Actions → Build and release → Run workflow** without a tag (uploads as
workflow artifacts instead of a Release — useful for testing the build
itself).

### Checking for updates on launch

`app/update_check.py` asks GitHub's API for the latest published Release
a few seconds after launch (on a background thread, so a slow or missing
connection never delays startup) and compares its tag against
`app/version.py`'s `APP_VERSION`. If it's newer, a popup offers to update;
choosing "No" remembers that version so it won't ask again until
something newer than *that* ships, and "Cancel" just asks again next
launch.

This whole mechanism (`update_check.py` and `auto_update.py` below) is
Python-app-specific and hasn't been ported to the Tauri rewrite, which has
no self-update check of its own yet. It also downloads by matching the
exact `QUASAR-Timesheet-Manager-macOS.zip` / `-Windows.zip` filenames
`release.yml` used to publish — once a release is cut under the new Tauri
workflow (different filenames: `.dmg`, `.exe`, `.msi`), any still-running
Python app's update check will see that newer tag but find no matching
asset to download.

This only works once the repo is public — an unauthenticated request
against a private repo's API 404s, which this app treats the same as "no
internet right now" (silently does nothing, no error shown). See
**Install and get started** above for the public-repo download flow this
depends on.

Choosing "Yes" is a real one-click update, not just a link: `app/auto_update.py`
downloads the matching release asset for whatever OS it's running on
(`QUASAR-Timesheet-Manager-macOS.zip` / `-Windows.zip`, matching the two
files `release.yml` publishes), extracts it, and hands off to a small,
detached helper script it writes to a temp file — a `.sh` on macOS, a
`.bat` on Windows — that waits for this app to fully quit, replaces the
old install with the new one in place, and relaunches it. This only works
for an actual packaged build (`sys.frozen`); running from source has no
single "install" to replace. If anything along that path fails for any
reason — not a packaged build, no matching asset on the release, a
download or extraction error — it falls back to the old behavior (opens
the release page in a browser) instead of leaving the app stuck, and says
so.

**Worth knowing if you're changing this** — every one of the following
was a real bug hit shipping this feature for the first time, not a
theoretical concern:

- **SSL on a frozen macOS build:** `ssl.create_default_context()` can
  fail with `CERTIFICATE_VERIFY_FAILED: unable to get local issuer
  certificate` inside a PyInstaller-frozen macOS app even though the
  exact same code works fine unfrozen — the frozen build can lose track
  of its own trusted CA bundle. Fixed by `update_check.build_ssl_context()`,
  which explicitly points at macOS's system CA bundle
  (`/etc/ssl/cert.pem`) when present; both the release-check request and
  the actual download in `auto_update.py` use it.
- **Extracting the downloaded zip on macOS:** Python's `zipfile.extractall()`
  does not preserve symlinks — it writes each one out as a plain file
  containing the link's target path as *text*. A macOS `.app` built with
  a bundled Python framework has real internal symlinks (e.g.
  `Python.framework/Versions/Current`), so extracting one with `zipfile`
  silently corrupts it just enough that macOS refuses to open it at all
  ("can't be opened"), with no useful error. `auto_update.extract_zip()`
  shells out to `ditto` on macOS instead — the same tool `release.yml`
  uses to *create* the zip in the first place, so it round-trips
  everything correctly. `zipfile` is fine on Windows, which has no such
  symlinks to lose.
- **The macOS build rendering ~25% smaller with a less responsive UI**
  than a local build, despite being the exact same source: GitHub's
  macOS runner, via `actions/setup-python`, bundles whatever Tcl/Tk
  ships with the requested Python version. Tcl/Tk 8.6 (bundled through
  Python 3.13) reports the old pre-Retina default of 72 DPI on a Retina
  display instead of auto-detecting the real ~96+ DPI, and since every
  font in this app is specified in points, that alone shrinks the whole
  UI. Tcl/Tk 9.0 (bundled starting with Python 3.14's official macOS
  installer) detects Retina DPI correctly — which is why
  `release.yml`'s `build-macos` job pins Python 3.14, not something
  more conservative. (An application-level `tk scaling` override was
  tried first and did **not** actually fix the rendering scale despite
  `winfo_fpixels` appearing to report a corrected number afterward —
  confirmed by directly comparing screenshots pixel-for-pixel, not just
  reading the diagnostic log. Don't trust that log in isolation if you
  revisit this; verify visually too.)
- **The Windows swap script's own working directory:** it inherited
  `install_dir` as its current directory (a double-clicked `.exe`
  launches with its own folder as the current directory), and Windows
  refuses to delete or rename a directory that is any running process's
  current directory — unlike macOS/Unix. The script now `cd`s somewhere
  unrelated (`%~dp0`, its own temp location) before touching
  `install_dir`, and `perform_update()` passes an explicit `cwd` to
  `Popen` on both platforms for the same reason.
- **`DETACHED_PROCESS` wedging the Windows swap script:** the original
  wait loop (`tasklist | find`) left a visible, stuck console window
  and never completed. `DETACHED_PROCESS` gives the new `cmd.exe`
  *no* console at all, but `tasklist`/`find` are themselves console
  programs, so each has to allocate its own throwaway console just to
  run — and piping between two independently self-allocated consoles
  can wedge instead of ever finishing. Fixed by waiting via a single
  PowerShell `Wait-Process -Id <pid>` call (no piping) and switching to
  `CREATE_NO_WINDOW` — the flag actually meant for "run normally, just
  don't show a window." Per Microsoft's own docs, `CREATE_NO_WINDOW` is
  silently ignored if `DETACHED_PROCESS` is also set, so the two must
  never be combined.
- **The Windows swap nesting the app one folder deeper on every
  update:** the script used to `rmdir /s /q install_dir` then
  `move new_dir install_dir`. If the `rmdir` silently failed (something
  — most likely antivirus briefly scanning the freshly-touched files —
  held a lock on it right after the app quit) and `install_dir` still
  existed, `move` doesn't error; it just moves `new_dir` *inside* the
  still-existing folder instead of renaming it there, nesting the app
  one level deeper every single time this happened. Fixed by moving the
  *old* install aside to a sibling `-old-swap` folder first (retried up
  to 8 times, a second apart, to ride out exactly that kind of
  transient lock) and only moving the new build into `install_dir` once
  that's confirmed empty — if it can't be vacated, the swap now aborts
  before ever touching the new build, rather than risking a nested move.

If a Windows update doesn't go as expected, `%TEMP%\quasar-update-swap.log`
has a timestamped line for every step the swap script took (including
each command's errorlevel and any output) — it's the only way to see
what happened, since the script runs with no visible console window.
`update_check.log` and `startup_diagnostics.log`, both under this app's
own data folder alongside `timesheet.db`, cover release-check failures
and startup display/Tcl-Tk info respectively.

The actual file-swap-and-relaunch step can only be partially tested from
a normal dev machine (there's no way to safely test a real app replacing
itself mid-run without actually doing it), so treat any change to
`app/auto_update.py` as something to try for real — on both macOS and
Windows — before trusting it broadly. The pure logic around it (picking
the right release asset, resolving the current install's path, error
handling) is covered by `tests/test_auto_update.py`.

### Tests

```bash
python3 -m unittest discover -s tests -p "test_*.py" -v
```

Covers the SQLite layer, migrations, backup/restore, CSV export, and
timer rounding — no display needed. Eight more are headless UI smoke
tests that need a virtual display (`Xvfb`): `interactive_smoke_test.py`
(drag-create/resize/move/quick-assign/export, overlapping blocks,
Ctrl+click-duplicate, templates, projects), `theme_toggle_smoke_test.py`
(System + all 18 curated palettes + Custom, persistence, legacy settings
migration), `ui_fixes_smoke_test.py` (tabs-not-popups, sidebar
sizing/scrolling), `timer_smoke_test.py` (Start/Stop, rounding, overlaps,
theme-change survival), `keyboard_undo_smoke_test.py` (selection,
shortcuts, per-tab undo/redo), `summary_smoke_test.py` (totals, grouping,
navigation), `backup_restore_smoke_test.py` (backup/restore round-trip,
guards), and `double_click_edit_smoke_test.py` (double-click jumps to
Edit with the right data).

### Making a change and shipping it

1. **Make the change** under `app/`.
2. **Test it** — run the command above; add or update a
   `*_smoke_test.py` if it touches UI behavior.
3. **Commit** with a message explaining *why*, not just *what*.
4. **Push** — `git push`. The change is now backed up on GitHub, but
   colleagues on a downloaded build don't have it yet.
5. **Cut a release if it's worth colleagues getting** (see above) — not
   every commit needs one.
6. **Let colleagues know, if it's urgent** — there's no silent
   auto-update, but everyone's app checks for a newer Release a few
   seconds after launch and offers to open the download page (see
   "Checking for updates on launch" above), so most releases reach people
   the next time they open the app without you needing to say anything.
