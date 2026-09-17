import { useMemo } from "react";
import type { Activity, Project } from "../api/activities";

export function ActivitySidebar({
  projects,
  activities,
  armedActivityId,
  onArm,
  onToggleCollapse,
  width,
}: {
  projects: Project[];
  activities: Activity[];
  armedActivityId: number | null;
  onArm: (id: number | null) => void;
  onToggleCollapse: (projectId: number) => void;
  width: number;
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
    <div className="activity-sidebar" style={{ width }}>
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
            <button
              type="button"
              className="activity-project-name"
              onClick={() => onToggleCollapse(project.id)}
              aria-expanded={!project.collapsed}
            >
              <span
                className={"disclosure-arrow" + (project.collapsed ? " disclosure-arrow-collapsed" : "")}
                style={{ color: project.color }}
              >
                ▾
              </span>
              {project.name}
            </button>
            {!project.collapsed &&
              list.map((activity) => (
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
      {activities.length === 0 && <p className="muted">No Activities yet -- add one in the Activities tab.</p>}
    </div>
  );
}
