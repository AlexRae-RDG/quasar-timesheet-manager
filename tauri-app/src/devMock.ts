/**
 * Opt-in, frontend-only mock of the Tauri backend for debugging in a plain
 * browser tab (e.g. Claude's browser pane), where screenshots/DOM
 * inspection work but the real Tauri IPC bridge doesn't exist. Only
 * activates on `?mock=1` AND only when no real Tauri backend is present,
 * so it can never shadow the real one inside the packaged app.
 */
export function installDevMockIfRequested() {
  if (typeof window === "undefined") return;
  if (new URLSearchParams(window.location.search).get("mock") !== "1") return;
  if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return;

  // ?mock=1&onboarded=1 skips straight past the onboarding flow, for
  // testing the rest of the app without re-running it every reload.
  const onboarded = new URLSearchParams(window.location.search).get("onboarded") === "1";

  const settings: Record<string, unknown> = {
    displayName: "",
    firstName: "",
    lastName: "",
    email: "",
    department: "",
    themeMode: "dark",
    customTheme: { appBg: "#05070F", panelBg: "#0B1020", textPrimary: "#EAF0FF", accent: "#2F6FED" },
    workStartHour: 9,
    workEndHour: 17,
    showWeekends: false,
    headerStyle: "compact",
    showTimerBar: false,
    jiraSiteUrl: "raildeliverygroup.atlassian.net",
    jiraEmail: "",
    outlookIcsUrl: "",
    sidebarWidth: 210,
    hasJiraToken: false,
    onboardingCompleted: onboarded,
  };

  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monday = new Date(today);
  const dow = monday.getDay();
  monday.setDate(monday.getDate() + (dow === 0 ? -6 : 1 - dow));

  let nextId = 1000;
  let entries: Record<string, unknown>[] = [
    {
      id: 1,
      activityId: 1,
      activityName: "Sprint Planning",
      jiraKey: "QDM-1",
      color: "#4C6EF5",
      date: iso(monday),
      startTime: "09:00",
      endTime: "10:00",
      notes: "",
      jiraProject: null,
      issueType: null,
      jiraUploadedAt: null,
    },
    {
      id: 2,
      activityId: 2,
      activityName: "Code Review",
      jiraKey: "QDM-2",
      color: "#12B886",
      date: iso(monday),
      startTime: "09:30",
      endTime: "10:30",
      notes: "Reviewed the auth middleware PR, left comments on token refresh flow",
      jiraProject: null,
      issueType: null,
      jiraUploadedAt: null,
    },
  ];

  // A block spanning right now, so the "now" line and the active-block
  // highlight (see CalendarGrid.tsx) both have something to visibly line
  // up against without needing a real clock-matching fixture.
  {
    const pad = (n: number) => String(n).padStart(2, "0");
    const localIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const fmt = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const start = new Date(today.getTime() - 20 * 60_000);
    const end = new Date(today.getTime() + 25 * 60_000);
    entries.push({
      id: 3,
      activityId: 1,
      activityName: "Sprint Planning",
      jiraKey: "QDM-1",
      color: "#4C6EF5",
      date: localIso,
      startTime: fmt(start),
      endTime: fmt(end),
      notes: "In progress right now",
      jiraProject: null,
      issueType: null,
      jiraUploadedAt: null,
    });
  }

  let nextTemplateId = 1;
  let templateEntries: Record<string, unknown>[] = [
    {
      id: nextTemplateId++,
      activityId: 1,
      activityName: "Sprint Planning",
      jiraKey: "QDM-1",
      color: "#4C6EF5",
      dayOfWeek: 0,
      startTime: "09:00",
      endTime: "09:30",
      notes: "Weekly kickoff",
      jiraProject: null,
      issueType: null,
    },
  ];

  let nextProjectId = 100;
  let projects: Record<string, unknown>[] = [
    { id: 1, name: "Project Alpha", color: "#4C6EF5", sortOrder: 0, collapsed: false },
    { id: 2, name: "Project Beta", color: "#12B886", sortOrder: 1, collapsed: false },
  ];

  let nextTaskId = 1;
  let tasks: Record<string, unknown>[] = [
    { id: nextTaskId++, title: "Draft Q3 accreditation report", description: "", status: "todo", priority: "high", deadline: iso(new Date(today.getTime() - 2 * 86_400_000)), sortOrder: 0 },
    { id: nextTaskId++, title: "Review onboarding doc", description: "Check it still matches the current flow", status: "todo", priority: "low", deadline: null, sortOrder: 1 },
    { id: nextTaskId++, title: "Fix Windows dropdown contrast", description: "", status: "in_progress", priority: "medium", deadline: iso(today), sortOrder: 0 },
    { id: nextTaskId++, title: "Ship Timer bar", description: "Ported from the Python app", status: "done", priority: "medium", deadline: null, sortOrder: 0 },
  ];

  let nextActivityId = 100;
  let activities: Record<string, unknown>[] = [
    {
      id: 1,
      name: "Sprint Planning",
      jiraKey: "QDM-1",
      defaultDurationMinutes: 30,
      projectId: 1,
      color: "#4C6EF5",
      jiraProject: null,
      issueType: null,
    },
    {
      id: 2,
      name: "Code Review",
      jiraKey: "QDM-2",
      defaultDurationMinutes: 30,
      projectId: 2,
      color: "#12B886",
      jiraProject: null,
      issueType: null,
    },
  ];

  async function invoke(cmd: string, args: Record<string, unknown> = {}) {
    // eslint-disable-next-line no-console
    console.log("[devMock invoke]", cmd, args);
    switch (cmd) {
      case "get_settings":
        return { ...settings };
      case "save_settings": {
        const input = args.input as Record<string, unknown>;
        Object.assign(settings, input);
        return null;
      }
      case "complete_onboarding":
        settings.onboardingCompleted = true;
        return null;
      case "reset_onboarding":
        settings.onboardingCompleted = false;
        return null;
      case "set_sidebar_width":
        settings.sidebarWidth = args.width as number;
        return null;
      case "verify_jira_credentials": {
        const siteUrl = args.siteUrl as string;
        const email = args.email as string;
        const token = args.token as string | null;
        if (!siteUrl.trim() || !email.trim() || (!token && !settings.hasJiraToken)) {
          throw "Site URL, email, and an API token are all required.";
        }
        return email.split("@")[0].replace(/[._]/g, " ") || "Test User";
      }
      case "save_jira_token":
        settings.hasJiraToken = true;
        return null;
      case "clear_jira_token":
        settings.hasJiraToken = false;
        return null;
      case "search_qdms": {
        if (!settings.hasJiraToken) throw "Connect Jira in Settings first.";
        return [
          {
            jiraKey: "QDM-1001",
            summary: "Renew platform access review",
            parentSummary: "Project Alpha QA Delivery",
            status: "In Progress",
          },
          {
            jiraKey: "QDM-1002",
            summary: "Quarterly compliance audit",
            parentSummary: "Project Alpha QA Delivery",
            status: "Pipeline",
          },
          { jiraKey: "QDM-1003", summary: "", parentSummary: "Project Beta QA Delivery", status: "In Progress" },
          {
            jiraKey: "QDM-1004",
            summary:
              "Coordinate cross-functional stakeholder review of the Q3 accreditation renewal package ahead of the regulator submission deadline",
            parentSummary: "Project Beta QA Delivery",
            status: "In Progress",
          },
          {
            jiraKey: "QDM-1005",
            summary: "Update incident response runbook for platform outages",
            parentSummary: "Quasar Admin",
            status: "Pipeline",
          },
          {
            jiraKey: "QDM-1006",
            summary: "Draft revised data retention policy for legal sign-off",
            parentSummary: null,
            status: "In Progress",
          },
          {
            jiraKey: "QDM-899",
            summary: "Legacy migration cleanup from last year",
            parentSummary: "Project Alpha QA Delivery",
            status: "Closed",
          },
          {
            jiraKey: "QDM-900",
            summary: "Old onboarding doc refresh",
            parentSummary: "Darwin QA Delivery",
            status: "Closed",
          },
          {
            jiraKey: "QDM-386",
            summary: "Mulesoft Release 10 build verification",
            parentSummary: "Project Alpha Mulesoft BAU Releases - Mulesoft Release 10 - QA Execution",
            status: "Pipeline",
          },
          {
            jiraKey: "QDM-220",
            summary: "Regression pass on the rebuilt checkout flow",
            parentSummary: "Project Alpha Website Rebuild - QA Prep",
            status: "In Progress",
          },
        ];
      }
      case "fetch_ics_calendar": {
        const url = args.url as string;
        if (!url.trim()) throw "Paste a calendar link first.";
        if (url.includes("fail")) throw "Couldn't reach that calendar link -- mock failure.";
        // Anchors the mock feed's events around the same "today"/Monday the
        // rest of the mock data uses, so an import lands on the visible week.
        const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
        const tue = new Date(monday);
        tue.setDate(tue.getDate() + 1);
        const thu = new Date(monday);
        thu.setDate(thu.getDate() + 3);
        return `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:mock-standup@example.com
SUMMARY:Daily Standup
DTSTART:${fmt(monday)}T090000
DTEND:${fmt(monday)}T091500
RRULE:FREQ=DAILY;COUNT=10
END:VEVENT
BEGIN:VEVENT
UID:mock-planning@example.com
SUMMARY:Sprint Planning Sync
LOCATION:Meeting Room 2
DTSTART:${fmt(tue)}T140000
DTEND:${fmt(tue)}T150000
END:VEVENT
BEGIN:VEVENT
UID:mock-1to1@example.com
SUMMARY:1:1 with Manager
DTSTART:${fmt(thu)}T110000
DTEND:${fmt(thu)}T113000
END:VEVENT
BEGIN:VEVENT
UID:mock-oof@example.com
SUMMARY:Out of Office
DTSTART;VALUE=DATE:${fmt(thu)}
DTEND;VALUE=DATE:${fmt(thu)}
END:VEVENT
END:VCALENDAR`;
      }
      case "reopen_jira_issue": {
        const jiraKey = args.jiraKey as string;
        if (jiraKey === "QDM-FAIL") throw `No transition to "In Progress" is available for ${jiraKey} right now.`;
        return null;
      }
      case "close_jira_issue": {
        const jiraKey = args.jiraKey as string;
        if (jiraKey === "QDM-FAIL") throw `No transition to "Closed" is available for ${jiraKey} right now.`;
        return null;
      }
      case "upload_worklogs": {
        const items = args.items as Array<Record<string, unknown>>;
        return items.map((item) => {
          const entryId = item.entryId as number;
          if (item.jiraKey === "QDM-FAIL") {
            return { entryId, error: `HTTP 400 from Jira while logging work on ${item.jiraKey}.` };
          }
          const e = entries.find((x) => x.id === entryId);
          if (e) e.jiraUploadedAt = new Date().toISOString();
          return { entryId, error: null };
        });
      }
      case "list_projects":
        return projects;
      case "list_activities":
        return activities.filter((a) => !a.archived);
      case "list_all_activities":
        return [...activities];
      case "create_project": {
        const input = args.input as Record<string, unknown>;
        const p = {
          id: nextProjectId++,
          name: input.name,
          color: input.color,
          sortOrder: projects.length,
          collapsed: false,
        };
        projects.push(p);
        return p;
      }
      case "update_project": {
        const input = args.input as Record<string, unknown>;
        const p = projects.find((x) => x.id === input.id);
        if (p) {
          p.name = input.name;
          p.color = input.color;
        }
        return p;
      }
      case "set_project_collapsed": {
        const p = projects.find((x) => x.id === args.id);
        if (p) p.collapsed = args.collapsed;
        return p;
      }
      case "delete_project": {
        let general = projects.find((p) => p.name === "General");
        if (!general) {
          general = {
            id: nextProjectId++,
            name: "General",
            color: "#495057",
            sortOrder: projects.length,
            collapsed: false,
          };
          projects.push(general);
        }
        if (general.id !== args.id) {
          for (const a of activities) {
            if (a.projectId === args.id) a.projectId = general.id;
          }
        }
        projects = projects.filter((p) => p.id !== args.id);
        return null;
      }
      case "create_activity": {
        const input = args.input as Record<string, unknown>;
        const project = projects.find((p) => p.id === input.projectId);
        const a = {
          id: nextActivityId++,
          name: input.name,
          jiraKey: input.jiraKey ?? null,
          defaultDurationMinutes: input.defaultDurationMinutes ?? null,
          projectId: input.projectId,
          color: project?.color ?? "#4C6EF5",
          jiraProject: input.jiraProject ?? null,
          issueType: input.issueType ?? null,
        };
        activities.push(a);
        return a;
      }
      case "update_activity": {
        const input = args.input as Record<string, unknown>;
        const a = activities.find((x) => x.id === input.id);
        if (a) {
          const project = projects.find((p) => p.id === input.projectId);
          a.name = input.name;
          a.jiraKey = input.jiraKey ?? null;
          a.defaultDurationMinutes = input.defaultDurationMinutes ?? null;
          a.projectId = input.projectId;
          a.color = project?.color ?? a.color;
          a.jiraProject = input.jiraProject ?? null;
          a.issueType = input.issueType ?? null;
        }
        return a;
      }
      case "archive_activity": {
        const a = activities.find((x) => x.id === args.id);
        if (a) a.archived = true;
        return null;
      }
      case "list_time_entries":
        return entries.filter(
          (e) => (e.date as string) >= (args.startDate as string) && (e.date as string) <= (args.endDate as string),
        );
      case "create_time_entry": {
        const input = args.input as Record<string, unknown>;
        const activity = activities.find((a) => a.id === input.activityId);
        const e = {
          id: nextId++,
          activityId: input.activityId,
          activityName: activity?.name ?? "Unknown",
          jiraKey: activity?.jiraKey ?? null,
          color: activity?.color ?? "#4C6EF5",
          date: input.date,
          startTime: input.startTime,
          endTime: input.endTime,
          notes: input.notes ?? "",
          jiraProject: null,
          issueType: null,
          jiraUploadedAt: null,
        };
        entries.push(e);
        return e;
      }
      case "update_time_entry": {
        const input = args.input as Record<string, unknown>;
        const e = entries.find((x) => x.id === input.id);
        if (e) {
          e.date = input.date;
          e.startTime = input.startTime;
          e.endTime = input.endTime;
          e.notes = input.notes;
          if (input.activityId != null) {
            const activity = activities.find((a) => a.id === input.activityId);
            e.activityId = input.activityId;
            e.activityName = activity?.name ?? e.activityName;
            e.color = activity?.color ?? e.color;
          }
        }
        return e;
      }
      case "delete_time_entry":
        entries = entries.filter((x) => x.id !== args.id);
        return null;
      case "list_template_entries":
        // A fresh array reference each call -- matching what real Tauri IPC
        // does (deserializes new objects every time). create/update mutate
        // `templateEntries` in place, so returning it directly here would
        // hand React the exact same object it already has in state, which
        // Object.is-bails the setState out with no re-render.
        return [...templateEntries];
      case "create_template_entry": {
        const input = args.input as Record<string, unknown>;
        const activity = activities.find((a) => a.id === input.activityId);
        const t = {
          id: nextTemplateId++,
          activityId: input.activityId,
          activityName: activity?.name ?? "Unknown",
          jiraKey: activity?.jiraKey ?? null,
          color: activity?.color ?? "#4C6EF5",
          dayOfWeek: input.dayOfWeek,
          startTime: input.startTime,
          endTime: input.endTime,
          notes: input.notes ?? "",
          jiraProject: null,
          issueType: null,
        };
        templateEntries.push(t);
        return t;
      }
      case "update_template_entry": {
        const input = args.input as Record<string, unknown>;
        const t = templateEntries.find((x) => x.id === input.id);
        if (t) {
          t.dayOfWeek = input.dayOfWeek;
          t.startTime = input.startTime;
          t.endTime = input.endTime;
          t.notes = input.notes;
          if (input.activityId != null) {
            const activity = activities.find((a) => a.id === input.activityId);
            t.activityId = input.activityId;
            t.activityName = activity?.name ?? t.activityName;
            t.color = activity?.color ?? t.color;
          }
        }
        return t;
      }
      case "delete_template_entry":
        templateEntries = templateEntries.filter((x) => x.id !== args.id);
        return null;
      case "apply_template_to_week": {
        const weekStart = args.weekStart as string;
        let applied = 0;
        let skipped = 0;
        for (const t of templateEntries) {
          const d = new Date(weekStart + "T00:00:00");
          d.setDate(d.getDate() + (t.dayOfWeek as number));
          const pad = (n: number) => String(n).padStart(2, "0");
          const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          const overlaps = entries.some(
            (e) => e.date === date && (t.startTime as string) < (e.endTime as string) && (e.startTime as string) < (t.endTime as string),
          );
          if (overlaps) {
            skipped++;
            continue;
          }
          entries.push({
            id: nextId++,
            activityId: t.activityId,
            activityName: t.activityName,
            jiraKey: t.jiraKey,
            color: t.color,
            date,
            startTime: t.startTime,
            endTime: t.endTime,
            notes: t.notes,
            jiraProject: t.jiraProject,
            issueType: t.issueType,
            jiraUploadedAt: null,
          });
          applied++;
        }
        return { applied, skipped };
      }
      case "list_tasks":
        return [...tasks];
      case "create_task": {
        const input = args.input as Record<string, unknown>;
        const inTodo = tasks.filter((t) => t.status === "todo");
        const nextOrder = inTodo.length ? Math.max(...inTodo.map((t) => t.sortOrder as number)) + 1 : 0;
        const t = {
          id: nextTaskId++,
          title: input.title,
          description: input.description ?? "",
          status: "todo",
          priority: input.priority ?? "medium",
          deadline: input.deadline ?? null,
          sortOrder: nextOrder,
        };
        tasks.push(t);
        return t;
      }
      case "update_task": {
        const input = args.input as Record<string, unknown>;
        const t = tasks.find((x) => x.id === input.id);
        if (t) {
          t.title = input.title;
          t.description = input.description;
          t.status = input.status;
          t.priority = input.priority;
          t.deadline = input.deadline;
          t.sortOrder = input.sortOrder;
        }
        return t;
      }
      case "delete_task":
        tasks = tasks.filter((x) => x.id !== args.id);
        return null;
      default:
        return null;
    }
  }

  (window as unknown as { __TAURI_INTERNALS__: { invoke: typeof invoke } }).__TAURI_INTERNALS__ = { invoke };
}
