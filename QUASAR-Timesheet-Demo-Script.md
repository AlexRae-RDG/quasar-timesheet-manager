# QUASAR Timesheet Manager — Demo Script

A ~7–8 minute walkthrough for showing colleagues what the app does. This week's calendar (Mon Aug 24 – Fri Aug 28) has already been filled in with realistic sample blocks using your real Projects/Activities, so it looks lived-in — nothing here is fake data bolted on, it's just your existing "Client Alpha"/"General" setup with some sample hours logged against it. The 9:00–9:15 daily standup slot has been left **empty on purpose** — see step 2, that's a live moment, not an oversight.

Feel free to skip around; it's written in a sensible order but nothing depends on doing it top to bottom.

## 1. Open on the calendar (30 sec)

Just let it sit there for a second before saying anything. It's a full Monday–Friday week, color-coded by project, already showing real work. This is the whole pitch in one screenshot: *"here's my week, at a glance, and every block maps straight to a Jira issue."*

Point out:
- Color per Project (not per Activity) — so everything under "Client Alpha" reads as one color across Sprint Planning/Code Review/Standup, and "General" work reads as another.
- The per-day totals row under the grid.

## 2. The "wow" moment: apply the weekly template (30 sec)

Click the **Template** tab. You'll see a single recurring block: **Team Standup, 9:00–9:15, Monday–Friday**.

Click **Apply to This Week**. Watch the standup slot pop into all five days at once, live, in the gap that was deliberately left empty in the Timesheet tab.

This is the line to say out loud: *"I set up my recurring meetings once, and every week I click one button instead of dragging the same block five times."*

## 3. Create a block by hand (45 sec)

Switch back to **Timesheet**. Drag across a few empty slots on any day (Friday afternoon is open). This opens the **Time Block** editor:
- Pick an Activity (it's grouped by Project in the dropdown)
- Jira Issue Key only asks for the number — the "QDM-" (or whatever prefix) is added automatically
- Add a quick note

Save it and point out the block now appears with the right color instantly.

Then: **drag an edge** to resize it, and **drag the middle** to move it to a different day. This is the everyday interaction, and it's the thing that sells people — dragging a block around a calendar feels obviously better than typing hours into a spreadsheet.

## 4. The sidebar — Projects & Activities (60 sec)

Point at the sidebar. Everything on the calendar comes from here: a **Project** (the color/grouping) containing **Activities** (the actual loggable things). Mention:
- Adding a new Activity takes one click, and it can carry its own default Jira Issue Key and duration
- Collapsing a Project tidies the sidebar without deleting anything

If you want a live add: create one throwaway Activity under "General" to show the flow, then delete it afterward (or leave it — no harm either way).

**This is worth its own moment now:** point at **Import QDM via API** on the tab row (top right) — this is the main way people should be adding their QDMs, not one at a time. Click it to show the review screen populate with real QDMs pulled straight from Jira (needs a saved API token — see the README's "Getting a Jira API token" if it's not set up on this machine yet), then click **Cancel** rather than **Import All** so nothing actually gets added mid-demo. Also worth a mention: on a brand new install with zero QDMs, this same button shows up right in the empty sidebar itself, so a new colleague never has to go hunting for it.

## 5. Start a live timer (30 sec)

In the timer bar at the top, pick an Activity and click **Start Timer**. Let it run for a few seconds, then **Stop Timer** — it logs a real time block automatically, rounded to your slot size. This is the "I forgot to plan my day, I'm just working" path, as opposed to the "I'm planning ahead" drag-to-create path in step 3. Both write to the same calendar.

## 6. Summary tab (30 sec)

Click **Summary**. Shows totals by day/week/month, broken down by Project. Good for the "how much time did I actually spend on X this month" question, without opening a spreadsheet.

## 7. Getting time back into Jira: Upload to JIRA via API (45 sec)

Point at **Upload to JIRA via API** on the tab row — the other half of the API pair alongside Import QDM via API from step 4. Click it to show the date-range picker (defaults to the current week), then click **Cancel** rather than **Upload…** so nothing actually gets sent to Jira mid-demo.

Worth saying: it sends worklogs straight to Jira over its own REST API — no CSV file, no manual import step in Jira afterward — and re-running it is always safe, since anything already uploaded is automatically skipped.

**If anyone asks about the old CSV way** (or doesn't want to set up API access at all): **Settings → Manual Import** has the manual, no-token alternatives for both directions — exporting a worklog CSV for Jira's own importer, and exporting/importing QDMs via a CSV file instead of the API. Worth a quick mention that it still exists, not a live demo of it — the API buttons above are the ones to actually show off.

## 8. Settings — make it yours (45 sec)

Click the **Settings** tab. Quick highlights:
- **Theme** picker — flip through two or three (the "Match System Appearance" one is worth showing since it just follows whatever light/dark mode the OS is already in)
- **Work Hours** — the calendar's visible hour range and weekend visibility are configurable, not hard-coded
- **Display Name** — what shows up in the exported CSV
- **Jira Cloud Upload** (right column) — where the API Token from steps 4/7 lives. If a colleague's setting this up for the first time, "Get an API token" jumps straight to Atlassian's token page.

## 9. Wrap-up line (15 sec)

Good closing note: *"It's a normal desktop app — runs locally, nothing goes to a server, and backing it up is one click under Backup & Restore."* That last part (local-only, no cloud account needed) tends to land well with people who are wary of yet another SaaS login.

---

### After the demo

The sample blocks added for this walkthrough are real rows in your timesheet now (same as anything you'd log yourself) — nothing marks them as "demo data." If you'd rather they not sit there as if you logged real hours, delete them the normal way (click a block → Delete), or just leave them; they're accurate-looking placeholder work, not anything embarrassing if a colleague scrolls back to this week later.
