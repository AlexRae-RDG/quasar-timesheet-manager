import { useEffect, useLayoutEffect, useState } from "react";
import type { CSSProperties } from "react";
import { getZoomFactor } from "../lib/windowsScale";

interface TourStep {
  tab: string;
  /** CSS selector for the element to spotlight -- omitted centers the
   * tooltip with a plain dim overlay instead. */
  selector?: string;
  title: string;
  body: string;
  /** Names a modal ActivitiesScreen should force open for this step (see
   * its own tourOpenImportModal prop) -- currently only "import-qdm", for
   * the two steps that walk through the Import QDMs modal itself rather
   * than just the button that opens it. Consecutive steps sharing the
   * same value keep the modal open across the transition between them
   * instead of closing and reopening it. */
  openModal?: string;
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
    tab: "activities",
    openModal: "import-qdm",
    // The whole scrollable list, not just the Select All/Deselect All
    // controls -- this step's own body invites unchecking ANY row, and
    // the tour now genuinely blocks clicks outside whatever it spotlights
    // (see .tour-block-band), so the spotlight has to cover every row a
    // colleague might actually try that on, not just the header above them.
    selector: ".qdm-scroll-area",
    title: "Selecting What to Import",
    body: "Every match is checked by default. Uncheck any row you'd rather leave for next time, or use Select All / Deselect All to handle the whole list at once.",
  },
  {
    tab: "activities",
    openModal: "import-qdm",
    selector: '[data-tour="qdm-row-project"]',
    title: "Choosing a Project",
    body: "Each row's already guessed a Project where it could -- open this dropdown on any row to change it, or pick \"+ New Project…\" to create one without leaving this screen. Import Selected sorts everything checked into the Project shown here.",
  },
  {
    tab: "template",
    selector: '[data-tour="tab-template"]',
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
  onRequestModal,
  onFinish,
}: {
  activeTab: string;
  onSelectTab: (id: string) => void;
  /** Called with step.openModal on entering a step that names one, and
   * with null on leaving it (including on unmount) -- see ActivitiesScreen's
   * tourOpenImportModal prop, the only consumer so far. */
  onRequestModal: (id: string | null) => void;
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

  useEffect(() => {
    onRequestModal(step.openModal ?? null);
    // Also clears it on unmount (tour skipped/finished) -- onFinish's own
    // stage change already unmounts everything that would show the modal,
    // but this keeps the request from lingering in App.tsx's state
    // regardless.
    return () => onRequestModal(null);
  }, [step.openModal, onRequestModal]);

  useLayoutEffect(() => {
    if (step.tab !== activeTab || !step.selector) {
      setRect(null);
      return;
    }
    let attempts = 0;
    let settleAttempts = 0;
    let lastRectKey: string | null = null;
    let timer: number | undefined;
    function measure() {
      const el = step.selector ? document.querySelector(step.selector) : null;
      if (el) {
        let rect = el.getBoundingClientRect();
        // The target can be scrolled out of view inside .shell-content
        // (Settings' Theme section, well below the fold on a shorter
        // window) -- data-tour-active's own overflow:hidden (below) then
        // stops the user from scrolling it into view themselves, which is
        // exactly what got a colleague stuck unable to reach Finish on the
        // last step. Scrolling programmatically here, before ever
        // measuring/positioning the spotlight off of it, means the
        // element (and so the tooltip anchored to it) is always grounded
        // somewhere actually visible -- scrollIntoView walks every
        // scrollable ancestor as needed, not just the window, so this
        // works the same whether the target's inside .shell-content, a
        // modal, or nested deeper than that.
        const inView = rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth;
        if (!inView) {
          el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
          rect = el.getBoundingClientRect();
        }
        setRect(rect);
        // The target itself can exist right away while a SIBLING above it
        // (Settings' own Outlook Calendars list, fetched async) is still
        // loading and hasn't pushed it down the page yet -- measuring once
        // on first sight caught the target at its pre-shift position, which
        // then stayed stale for the rest of the step (nothing here re-runs
        // measure() on a plain layout reflow). Keep re-measuring for a bit
        // after every change, stopping once the rect settles twice in a row.
        const rectKey = `${rect.top},${rect.left},${rect.width},${rect.height}`;
        if (rectKey === lastRectKey) return;
        lastRectKey = rectKey;
        if (settleAttempts < 10) {
          settleAttempts++;
          timer = window.setTimeout(measure, 250);
        }
        return;
      }
      // A tab switch renders synchronously, but a screen's own data fetch
      // (or, for a step that opens a modal, that modal's own Jira search)
      // can take real time to settle -- keep trying for a few seconds,
      // falling back to a plain dim overlay (rect stays null) if the
      // target genuinely never shows up.
      if (attempts < 20) {
        attempts++;
        timer = window.setTimeout(measure, 250);
      } else {
        setRect(null);
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      if (timer != null) clearTimeout(timer);
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

  const rawTooltipStyle = cutout ? placeTooltip(cutout) : CENTERED_TOOLTIP_STYLE;

  // Both .tour-cutout and .tour-tooltip are position:fixed, and every
  // number here (cutout's four fields, plus placeTooltip's left/top) was
  // measured off a real element via getBoundingClientRect -- see
  // getZoomFactor's comment for why writing a measured pixel value like
  // that straight into a position:fixed element's inline style needs
  // dividing by the current Windows-scale zoom first, or it renders
  // shrunk and offset at anything other than 100% scaling. Percentages
  // (CENTERED_TOOLTIP_STYLE's "50%") and authored constants
  // (TOOLTIP_WIDTH) were never measured off anything, so they're left
  // untouched.
  const zoom = getZoomFactor();
  const cutoutBox = cutout
    ? {
        top: cutout.top / zoom,
        left: cutout.left / zoom,
        width: cutout.width / zoom,
        height: cutout.height / zoom,
      }
    : null;
  const tooltipStyle: CSSProperties = {
    ...rawTooltipStyle,
    ...(typeof rawTooltipStyle.left === "number" ? { left: rawTooltipStyle.left / zoom } : {}),
    ...(typeof rawTooltipStyle.top === "number" ? { top: rawTooltipStyle.top / zoom } : {}),
  };

  // Four bands tiling the viewport around the cutout -- see
  // .tour-block-band's own comment for why this, rather than just
  // pointer-events on .tour-overlay/.tour-cutout, is what actually blocks
  // clicks everywhere except the spotlighted element itself.
  const bands: CSSProperties[] = cutoutBox
    ? [
        { top: 0, left: 0, right: 0, height: Math.max(0, cutoutBox.top) },
        { top: cutoutBox.top + cutoutBox.height, left: 0, right: 0, bottom: 0 },
        { top: cutoutBox.top, height: cutoutBox.height, left: 0, width: Math.max(0, cutoutBox.left) },
        { top: cutoutBox.top, height: cutoutBox.height, left: cutoutBox.left + cutoutBox.width, right: 0 },
      ]
    : [];

  return (
    <div className="tour-overlay">
      {cutoutBox ? (
        <>
          {bands.map((band, i) => (
            <div key={i} className="tour-block-band" style={band} />
          ))}
          <div className="tour-cutout" style={cutoutBox} />
        </>
      ) : (
        <div className="tour-dim" />
      )}
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
