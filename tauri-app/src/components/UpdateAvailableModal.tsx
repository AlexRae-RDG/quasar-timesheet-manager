import { useState } from "react";
import { installUpdate, type Update } from "../api/updater";

type State = { kind: "idle" } | { kind: "installing"; downloaded: number; total: number | null } | { kind: "error"; message: string };

function formatBytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Shown either right after launch (App.tsx, auto-checked a few seconds
 * in) or from Settings' own "Check for Updates" button -- same modal
 * either way. "Later" remembers this version in localStorage (not the
 * database -- this is a per-install UI nicety, not real app data) so the
 * auto-check won't ask again until something newer than *that* ships,
 * mirroring the Python app's own update popup; a manual re-check from
 * Settings always shows it regardless. */
export function UpdateAvailableModal({ update, onDismiss }: { update: Update; onDismiss: () => void }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleUpdate() {
    setState({ kind: "installing", downloaded: 0, total: null });
    try {
      await installUpdate(update, (downloaded, total) => setState({ kind: "installing", downloaded, total }));
      // installUpdate relaunches on success -- nothing left to do here, the
      // app is about to restart into the new version.
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }

  function handleLater() {
    try {
      localStorage.setItem("quasar-declined-update-version", update.version);
    } catch {
      // Private window / blocked storage -- worst case this asks again
      // next launch, not worth failing the dismissal over.
    }
    onDismiss();
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h2>Update available -- v{update.version}</h2>
        {update.body && <p className="muted update-notes">{update.body}</p>}

        {state.kind === "error" && <p className="status status-error">{state.message}</p>}

        {state.kind === "installing" ? (
          <p className="muted">
            Downloading and installing
            {state.total ? ` (${formatBytes(state.downloaded)} of ${formatBytes(state.total)})` : ""}… the app will
            restart automatically once it's done.
          </p>
        ) : (
          <div className="modal-actions">
            <div />
            <div className="row">
              <button type="button" className="btn btn-secondary" onClick={handleLater}>
                Later
              </button>
              <button type="button" className="btn btn-accent" onClick={handleUpdate}>
                Update Now
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
