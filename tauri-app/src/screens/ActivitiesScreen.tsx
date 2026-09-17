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
import { EditActivityModal, type ActivityFormValues } from "../components/EditActivityModal";
import { EditProjectModal } from "../components/EditProjectModal";

type ProjectModalState = { mode: "new" } | { mode: "edit"; project: Project } | null;
type ActivityModalState = { mode: "new"; projectId: number | null } | { mode: "edit"; activity: Activity } | null;

export function ActivitiesScreen() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [projectModal, setProjectModal] = useState<ProjectModalState>(null);
  const [activityModal, setActivityModal] = useState<ActivityModalState>(null);

  const refresh = () => {
    listProjects().then(setProjects).catch((e) => setError(String(e)));
    listActivities().then(setActivities).catch((e) => setError(String(e)));
  };

  useEffect(refresh, []);

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
        issueType: values.issueType || undefined,
      };
      if (activityModal?.mode === "edit") {
        await updateActivity({ id: activityModal.activity.id, ...input });
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
    try {
      await archiveActivity(activityModal.activity.id);
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
      <header className="page-header">
        <h1>Activities</h1>
        <button className="btn btn-accent" onClick={() => setProjectModal({ mode: "new" })}>
          New Project
        </button>
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
          onSave={handleSaveActivity}
          onArchive={activityModal.mode === "edit" ? handleArchiveActivity : undefined}
          onClose={() => setActivityModal(null)}
        />
      )}
    </div>
  );
}
