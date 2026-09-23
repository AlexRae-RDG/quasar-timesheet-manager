import { useEffect, useState } from "react";
import {
  archiveActivity,
  createActivity,
  createProject,
  deleteProject,
  listActivities,
  listProjects,
  updateActivity,
  updateProject,
  type Activity,
  type Project,
} from "../api/activities";
import { projectKeyForDepartment, type AppSettings } from "../api/settings";
import { EditActivityModal, type ActivityFormValues } from "../components/EditActivityModal";
import { EditProjectModal } from "../components/EditProjectModal";
import { ImportQdmModal } from "../components/ImportQdmModal";
import { closeJiraIssue, reopenJiraIssue } from "../api/jira";
import { useStickyHeader } from "../lib/useStickyHeader";

function isArchivedProject(projects: Project[], projectId: number | null): boolean {
  const project = projects.find((p) => p.id === projectId);
  return !!project && project.name.trim().toLowerCase() === "archived";
}

type ProjectModalState = { mode: "new" } | { mode: "edit"; project: Project } | null;
type ActivityModalState = { mode: "new"; projectId: number | null } | { mode: "edit"; activity: Activity } | null;

export function ActivitiesScreen({
  settings,
  tourOpenImportModal,
}: {
  settings: AppSettings;
  /** True while the welcome tour is on one of its two Import QDMs steps
   * (see OnboardingTour's openModal) -- forces the modal open so there's
   * something real to spotlight, and closes it again on the transition
   * back to false (a Back click that lands on an earlier, non-modal step
   * without the tab itself changing -- a tab change unmounts this screen
   * and the modal along with it regardless). Never fights a real user's
   * own open/close: outside the tour this prop is always false and never
   * changes, so the effect below only ever runs its no-op initial pass. */
  tourOpenImportModal?: boolean;
}) {
  const teamKey = projectKeyForDepartment(settings.department);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [projectModal, setProjectModal] = useState<ProjectModalState>(null);
  const [activityModal, setActivityModal] = useState<ActivityModalState>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const { headerRef, bgRef } = useStickyHeader<HTMLElement>();

  const refresh = () => {
    listProjects().then(setProjects).catch((e) => setError(String(e)));
    listActivities().then(setActivities).catch((e) => setError(String(e)));
  };

  useEffect(refresh, []);

  useEffect(() => {
    setImportModalOpen(!!tourOpenImportModal);
  }, [tourOpenImportModal]);

  async function handleSaveProject(name: string, color: string) {
    try {
      if (projectModal?.mode === "edit") {
        await updateProject({ id: projectModal.project.id, name, color });
      } else {
        await createProject({ name, color });
      }
      setProjectModal(null);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDeleteProject() {
    if (projectModal?.mode !== "edit") return;
    try {
      await deleteProject(projectModal.project.id);
      setProjectModal(null);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSaveActivity(values: ActivityFormValues) {
    try {
      const input = {
        name: values.name,
        projectId: values.projectId,
        jiraKey: values.jiraKey || undefined,
        defaultDurationMinutes: values.defaultDurationMinutes ? Number(values.defaultDurationMinutes) : undefined,
        jiraProject: values.jiraProject || undefined,
      };
      if (activityModal?.mode === "edit") {
        const wasArchived = isArchivedProject(projects, activityModal.activity.projectId);
        const saved = await updateActivity({ id: activityModal.activity.id, ...input });
        // Moving an Activity's QDM out of the Archived bucket means it's
        // active again -- reopen the ticket in Jira to match, the same
        // automatic pairing Import QDMs does when you sort a Closed QDM
        // into a real Project instead. Best-effort: worth surfacing if it
        // fails, not worth blocking the save that already succeeded.
        if (wasArchived && !isArchivedProject(projects, values.projectId) && saved.jiraKey && settings.hasJiraToken) {
          try {
            await reopenJiraIssue(settings.jiraSiteUrl, settings.email, saved.jiraKey);
          } catch (e) {
            setError(`Saved, but couldn't reopen ${saved.jiraKey} in Jira -- ${e}`);
          }
        }
      } else {
        await createActivity(input);
      }
      setActivityModal(null);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleArchiveActivity() {
    if (activityModal?.mode !== "edit") return;
    const { activity } = activityModal;
    try {
      // Archiving locally hides an Activity from the sidebar but says
      // nothing to Jira on its own -- closing the ticket here keeps the two
      // in sync instead of leaving a "done" Activity whose QDM still shows
      // as open. Best-effort: a failure here (e.g. no direct transition to
      // Closed) shouldn't block the local archive, just surface why.
      if (activity.jiraKey && settings.hasJiraToken) {
        try {
          await closeJiraIssue(settings.jiraSiteUrl, settings.email, activity.jiraKey);
        } catch (e) {
          setError(`Archived locally, but couldn't close ${activity.jiraKey} in Jira -- ${e}`);
        }
      }
      await archiveActivity(activity.id);
      setActivityModal(null);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  const activitiesByProject = new Map<number, Activity[]>();
  for (const activity of activities) {
    if (activity.projectId == null) continue;
    const list = activitiesByProject.get(activity.projectId) ?? [];
    list.push(activity);
    activitiesByProject.set(activity.projectId, list);
  }

  return (
    <div className="app-shell">
      <header ref={headerRef} className="page-header page-header-sticky">
        <div ref={bgRef} className="page-header-fixed-bg" aria-hidden="true" />
        <h1>Activities</h1>
        <div className="row">
          <button
            className="btn btn-secondary"
            disabled={!settings.hasJiraToken}
            title={settings.hasJiraToken ? undefined : "Connect Jira in Settings first"}
            onClick={() => setImportModalOpen(true)}
            data-tour="activities-import"
          >
            Import {teamKey}s from Jira
          </button>
          <button
            className="btn btn-accent"
            data-tour="activities-new-project"
            onClick={() => setProjectModal({ mode: "new" })}
          >
            New Project
          </button>
        </div>
      </header>

      {error && <p className="status status-error">{error}</p>}

      {projects.map((project) => (
        <section key={project.id} className="card">
          <div className="project-card-header">
            <h2 className="project-card-title">
              <span className="color-dot" style={{ background: project.color }} />
              {project.name}
            </h2>
            <button className="btn btn-secondary" onClick={() => setProjectModal({ mode: "edit", project })}>
              Edit
            </button>
          </div>

          <div className="activity-list">
            {(activitiesByProject.get(project.id) ?? []).map((activity) => (
              <button
                key={activity.id}
                type="button"
                className="activity-list-row"
                onClick={() => setActivityModal({ mode: "edit", activity })}
              >
                <span>{activity.name}</span>
                <span className="activity-list-meta">
                  {activity.jiraKey && <span className="badge">{activity.jiraKey}</span>}
                  {activity.defaultDurationMinutes != null && <span>{activity.defaultDurationMinutes} min</span>}
                </span>
              </button>
            ))}
            {(activitiesByProject.get(project.id) ?? []).length === 0 && (
              <p className="muted">No Activities in this Project yet.</p>
            )}
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setActivityModal({ mode: "new", projectId: project.id })}
          >
            + New Activity
          </button>
        </section>
      ))}

      {projects.length === 0 && (
        <p className="muted">No Projects yet -- create one to start adding Activities.</p>
      )}

      {projectModal && (
        <EditProjectModal
          project={projectModal.mode === "edit" ? projectModal.project : null}
          onSave={handleSaveProject}
          onDelete={projectModal.mode === "edit" ? handleDeleteProject : undefined}
          onClose={() => setProjectModal(null)}
        />
      )}

      {activityModal && (
        <EditActivityModal
          activity={activityModal.mode === "edit" ? activityModal.activity : null}
          projects={projects}
          defaultProjectId={activityModal.mode === "new" ? activityModal.projectId : null}
          settings={settings}
          onSave={handleSaveActivity}
          onArchive={activityModal.mode === "edit" ? handleArchiveActivity : undefined}
          onClose={() => setActivityModal(null)}
        />
      )}

      {importModalOpen && (
        <ImportQdmModal
          settings={settings}
          projects={projects}
          activities={activities}
          onProjectCreated={(project) =>
            // React Strict Mode can invoke a functional setState updater
            // more than once in dev -- guarding on the id already being
            // present keeps a double-invoke from adding the same freshly
            // created Project twice (confirmed happening here directly;
            // same root cause as the drag-duplicate-block bug elsewhere in
            // this app, just on a different piece of state).
            setProjects((prev) => (prev.some((p) => p.id === project.id) ? prev : [...prev, project]))
          }
          onImported={refresh}
          onClose={() => setImportModalOpen(false)}
        />
      )}
    </div>
  );
}
