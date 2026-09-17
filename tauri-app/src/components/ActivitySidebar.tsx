import { useMemo } from "react";
import type { Activity, Project } from "../api/calendar";

export function ActivitySidebar({
  projects,
  activities,
  armedActivityId,
  onArm,
}: {
  projects: Project[];
  activities: Activity[];
  armedActivityId: number | null;
  onArm: (id: number | null) => void;
}) {
  const byProject = useMemo(() => {
    const map = new Map<number | null, Activity[]>();
    for (const activity of activities) {
      const list = map.get(activity.projectId) ?? [];
      list.push(activity);
      map.set(activity.projectId, list);
    }
    return map;
  }, [activities]);

  return (
    <div className="activity-sidebar">
      <div className="activity-sidebar-hint">
        {armedActivityId == null
          ? "Select an Activity, then drag on the grid to log time."
          : "Drag on the grid to create a block, or click a slot for the default duration."}
      </div>
      {projects.map((project) => {
        const list = byProject.get(project.id) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={project.id} className="activity-project-group">
            <div className="activity-project-name">
              <span className="color-dot" style={{ background: project.color }} />
              {project.name}
            </div>
            {list.map((activity) => (
              <button
                key={activity.id}
                type="button"
                className={"activity-row" + (armedActivityId === activity.id ? " activity-row-armed" : "")}
                onClick={() => onArm(armedActivityId === activity.id ? null : activity.id)}
              >
                {activity.name}
              </button>
            ))}
          </div>
        );
      })}
      {activities.length === 0 && (
        <p className="muted">No Activities yet -- create one in the Python app for now; Activity/Project management isn't built here yet.</p>
      )}
    </div>
  );
}
