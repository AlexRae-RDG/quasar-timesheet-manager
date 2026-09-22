import { useEffect, useLayoutEffect, useState } from "react";
import type { CSSProperties } from "react";

interface TourStep {
  tab: string;
  /** CSS selector for the element to spotlight -- omitted centers the
   * tooltip with a plain dim overlay instead. */
  selector?: string;
  title: string;
  body: string;
}

// One entry per major feature -- a couple of screens get a second step for
// their single most important interaction, rather than treating every tab
// as equally deep. Each step's `tab` switches the real app to that tab as
// the tour reaches it, so the spotlighted element actually exists in the
// DOM to measure.
const TOUR_STEPS: TourStep[] = [
  {
    tab: "timesheet",
    selector: '[data-tour="tab-timesheet"]',
    title: "Timesheet",
    body: "Your weekly calendar. Click and drag on the grid to log time, and drag a block's edges to resize it.",
  },
  {
    tab: "timesheet",
    selector: '[data-tour="calendar-nav-pill"]',
    title: "Switch Weeks",
    body: "‹ Today › moves you between weeks -- Today always jumps straight back to the current one.",
  },
  {
    tab: "timesheet",
    selector: '[data-tour="calendar-zoom"]',
    title: "Zoom",
    body: "Use the magnifying glass in the grid's corner to make each hour taller or shorter.",
  },
  {
    tab: "timesheet",
    selector: '[data-tour="activity-sidebar"]',
    title: "Activities Sidebar",
    body: "Pick an Activity here before dragging to log time against it -- or drag first and choose one from a popup instead.",
  },
  {
    tab: "timesheet",
    selector: '[data-tour="activity-sidebar"]',
    title: "Edit from the Sidebar",
    body: "Hover an Activity for a pencil to quick-edit it, or hover a Project's name for a + to add a new Activity to it -- no need to leave Timesheet.",
  },
  {
    tab: "timesheet",
    selector: '[data-tour="calendar-grid"]',
    title: "Edit a Time Block",
    body: "Double-click any block to edit it. Add a description in Notes -- that's what gets logged to Jira when you upload.",
  },
  {
    tab: "activities",
    selector: '[data-tour="tab-activities"]',
    title: "Activities",
    body: "Create and manage the Projects and Activities you log time against.",
  },
  {
    tab: "activities",
    selector: '[data-tour="activities-new-project"]',
    title: "Projects",
    body: "Start here to add a new Project -- then add Activities underneath it.",
  },
  {
    tab: "activities",
    selector: '[data-tour="activities-import"]',
    title: "Import from Jira",
    body: "Pull in your assigned Jira sub-tasks automatically, then sort each one into the right Project -- already guessed for you where possible.",
  },
  {
    tab: "template",
    selector: '[data-tour="template-label"]',
    title: "Template",
    body: "Build a recurring Monday-to-Friday schedule once, then apply it to any week from the Timesheet toolbar.",
  },
  {
    tab: "timesheet",
    selector: '[data-tour="apply-template"]',
    title: "Apply the Template",
    body: "Once your Template's built, this fills the current week from it in one click.",
  },
  {
    tab: "timesheet",
    selector: '[data-tour="import-outlook"]',
    title: "Import from Outlook",
    body: "Pull meetings straight from a published Outlook calendar link and turn them into time blocks -- save the link once in Settings so this is a single click every week, or paste one in on the spot.",
  },
  {
    tab: "tasks",
    selector: '[data-tour="tab-tasks"]',
    title: "Tasks",
    body: "A personal kanban board, separate from your Timesheet -- drag cards between To Do, In Progress, and Done, color-coded by priority (green/yellow/red). Done cards clear out automatically every Friday at 9pm so the board doesn't pile up.",
  },
  {
    tab: "summary",
    selector: '[data-tour="summary-project-card"]',
    title: "Summary",
    body: "See totals by Project and Activity for the week or month, and track logged vs. expected hours.",
  },
  {
    tab: "settings",
    selector: '[data-tour="settings-theme"]',
    title: "Settings",
    body: "Customize your theme, work hours, and Jira connection -- everything from onboarding lives here too, if you ever need to change it.",
  },
];

const TOOLTIP_WIDTH = 320;
// Not measured -- the tooltip's actual height varies a little with each
// step's body text, but this only needs to be a safe-enough estimate to
// pick a direction with room to spare; a few px of slack either way is
// invisible, unlike placing it off-screen entirely.
const TOOLTIP_EST_HEIGHT = 200;
const SPOTLIGHT_PADDING = 8;
const TOOLTIP_GAP = 14;
const VIEWPORT_MARGIN = 16;

const CENTERED_TOOLTIP_STYLE: CSSProperties = {
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: TOOLTIP_WIDTH,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/** Prefers below the spotlighted element, then above, then right, then
 * left -- whichever direction actually has room for the tooltip's real
 * size -- and only falls back to an unclamped guess if the element fills
 * so much of the window that none of the four has enough space (at which
 * point every option is a compromise anyway). A target tall enough to
 * leave no room above or below (e.g. the Activity sidebar step) is exactly
 * why this doesn't just try "below, else above" -- that pair alone can
 * leave the tooltip positioned past the bottom of the viewport, entirely
 * invisible with no way to click Next. */
function placeTooltip(cutout: { top: number; left: number; width: number; height: number }): CSSProperties {
  const spaceBelow = window.innerHeight - (cutout.top + cutout.height);
  const spaceAbove = cutout.top;
  const spaceRight = window.innerWidth - (cutout.left + cutout.width);
  const spaceLeft = cutout.left;

  const left = clamp(cutout.left, VIEWPORT_MARGIN, window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_MARGIN);
  const top = clamp(cutout.top, VIEWPORT_MARGIN, window.innerHeight - TOOLTIP_EST_HEIGHT - VIEWPORT_MARGIN);

  if (spaceBelow >= TOOLTIP_EST_HEIGHT + TOOLTIP_GAP) {
    return { left, top: cutout.top + cutout.height + TOOLTIP_GAP, width: TOOLTIP_WIDTH };
  }
  if (spaceAbove >= TOOLTIP_EST_HEIGHT + TOOLTIP_GAP) {
    return { left, top: cutout.top - TOOLTIP_GAP - TOOLTIP_EST_HEIGHT, width: TOOLTIP_WIDTH };
  }
  if (spaceRight >= TOOLTIP_WIDTH + TOOLTIP_GAP) {
    return { left: cutout.left + cutout.width + TOOLTIP_GAP, top, width: TOOLTIP_WIDTH };
  }
  if (spaceLeft >= TOOLTIP_WIDTH + TOOLTIP_GAP) {
    return { left: cutout.left - TOOLTIP_GAP - TOOLTIP_WIDTH, top, width: TOOLTIP_WIDTH };
  }
  return { left, top, width: TOOLTIP_WIDTH };
}

export function OnboardingTour({
  activeTab,
  onSelectTab,
  onFinish,
}: {
  activeTab: string;
  onSelectTab: (id: string) => void;
  onFinish: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = TOUR_STEPS[stepIndex];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  // Scrolling any of the app's own scroll areas while a step is showing
  // would carry the real element out from under its spotlight (measured
  // once per step below, not continuously on scroll) -- see the matching
  // :root[data-tour-active="true"] rules in global.css.
  useEffect(() => {
    document.documentElement.setAttribute("data-tour-active", "true");
    return () => document.documentElement.removeAttribute("data-tour-active");
  }, []);

  useEffect(() => {
    if (step.tab !== activeTab) onSelectTab(step.tab);
  }, [step.tab, activeTab, onSelectTab]);

  useLayoutEffect(() => {
    if (step.tab !== activeTab || !step.selector) {
      setRect(null);
      return;
    }
    function measure() {
      const el = step.selector ? document.querySelector(step.selector) : null;
      setRect(el ? el.getBoundingClientRect() : null);
    }
    measure();
    // A tab switch renders synchronously, but a screen's own data fetch can
    // still settle layout a frame later -- this catches that without
    // needing a fixed delay.
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [step, activeTab]);

  function next() {
    if (isLast) onFinish();
    else setStepIndex((i) => i + 1);
  }
  function back() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  const cutout = rect
    ? {
        top: rect.top - SPOTLIGHT_PADDING,
        left: rect.left - SPOTLIGHT_PADDING,
        width: rect.width + SPOTLIGHT_PADDING * 2,
        height: rect.height + SPOTLIGHT_PADDING * 2,
      }
    : null;

  const tooltipStyle = cutout ? placeTooltip(cutout) : CENTERED_TOOLTIP_STYLE;

  return (
    <div className="tour-overlay">
      {cutout ? <div className="tour-cutout" style={cutout} /> : <div className="tour-dim" />}
      <div className="tour-tooltip" style={tooltipStyle}>
        <div className="tour-step-count">
          Step {stepIndex + 1} of {TOUR_STEPS.length}
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={onFinish}>
            Skip tour
          </button>
          <div className="row">
            {stepIndex > 0 && (
              <button type="button" className="btn btn-secondary" onClick={back}>
                Back
              </button>
            )}
            <button type="button" className="btn btn-accent" onClick={next}>
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
