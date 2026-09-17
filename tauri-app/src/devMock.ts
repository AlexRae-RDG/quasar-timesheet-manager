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

  let nextProjectId = 100;
  let projects: Record<string, unknown>[] = [
    { id: 1, name: "Project Alpha", color: "#4C6EF5", sortOrder: 0, collapsed: false },
    { id: 2, name: "Project Beta", color: "#12B886", sortOrder: 1, collapsed: false },
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
        return {
          displayName: "Test User",
          themeMode: "stormy_morning",
          customTheme: { appBg: "#05070F", panelBg: "#0B1020", textPrimary: "#EAF0FF", accent: "#2F6FED" },
          workStartHour: 9,
          workEndHour: 17,
          showWeekends: false,
          headerStyle: "compact",
          showTimerBar: false,
          jiraSiteUrl: "",
          jiraEmail: "",
          hasJiraToken: false,
        };
      case "list_projects":
        return projects;
      case "list_activities":
        return activities.filter((a) => !a.archived);
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
      default:
        return null;
    }
  }

  (window as unknown as { __TAURI_INTERNALS__: { invoke: typeof invoke } }).__TAURI_INTERNALS__ = { invoke };
}
