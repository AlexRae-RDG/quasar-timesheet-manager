import { useMemo } from "react";
import type { Activity, Project } from "../api/activities";

/** Pencil glyph for the hover-revealed "edit this Activity" affordance --
 * plain inline SVG (same approach as JiraIcon/CalendarGrid's ZoomGlyph)
 * using currentColor so it follows the button's own idle/hover color. */
function EditGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 20 L4 16 L15.5 4.5 C16.3 3.7 17.6 3.7 18.4 4.5 L19.5 5.6 C20.3 6.4 20.3 7.7 19.5 8.5 L8 20 Z M14 6 L18 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ActivitySidebar({
  projects,
  activities,
  armedActivityId,
  onArm,
  onToggleCollapse,
  onEditActivity,
  onAddActivity,
  width,
}: {
  projects: Project[];
  activities: Activity[];
  armedActivityId: number | null;
  onArm: (id: number | null) => void;
  onToggleCollapse: (projectId: number) => void;
  /** Opens the Edit Activity modal for this Activity -- lets a quick rename
   * or Jira key fix happen without leaving Timesheet for the Activities
   * tab. Omit to hide the hover pencil entirely. */
  onEditActivity?: (activity: Activity) => void;
  /** Opens the New Activity modal pre-filled with this Project -- same
   * reasoning as onEditActivity, for the common "just need one more row in
   * this Project" case. */
  onAddActivity?: (projectId: number) => void;
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
    <div className="activity-sidebar" data-tour="activity-sidebar" style={{ width }}>
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
            <div className="activity-project-header">
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
              {onAddActivity && (
                <button
                  type="button"
                  className="activity-project-add"
                  title={`New Activity in ${project.name}`}
                  aria-label={`New Activity in ${project.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddActivity(project.id);
                  }}
                >
                  +
                </button>
              )}
            </div>
            {!project.collapsed &&
              list.map((activity) => (
                <div
                  key={activity.id}
                  className={"activity-row" + (armedActivityId === activity.id ? " activity-row-armed" : "")}
                >
                  <button type="button" className="activity-row-main" onClick={() => onArm(armedActivityId === activity.id ? null : activity.id)}>
                    <span className="color-dot" style={{ background: project.color }} />
                    {activity.name}
                  </button>
                  {onEditActivity && (
                    <button
                      type="button"
                      className="activity-row-edit"
                      title={`Edit ${activity.name}`}
                      aria-label={`Edit ${activity.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditActivity(activity);
                      }}
                    >
                      <EditGlyph />
                    </button>
                  )}
                </div>
              ))}
          </div>
        );
      })}
      {activities.length === 0 && <p className="muted">No Activities yet -- add one in the Activities tab.</p>}
    </div>
  );
}
