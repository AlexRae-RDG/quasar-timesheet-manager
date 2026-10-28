import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createNote, deleteNote, listNotes, updateNote, type Note } from "../api/notes";

const SAVE_DELAY_MS = 600;

function formatUpdated(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function sortNewestFirst(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => (a.updatedAt === b.updatedAt ? b.id - a.id : b.updatedAt < a.updatedAt ? -1 : 1));
}

/** Optional scratchpad tab (enabled from Settings → Optional Features): a
 * list of notes on the left, the selected one editable on the right.
 * Edits save themselves shortly after typing stops, and immediately when
 * switching notes or leaving the tab, so there's no Save button to forget. */
export function NotesScreen() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");

  const pending = useRef<{ id: number; title: string; body: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const titleInput = useRef<HTMLInputElement | null>(null);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const edit = pending.current;
    if (!edit) return;
    pending.current = null;
    try {
      const saved = await updateNote(edit);
      setNotes((prev) => sortNewestFirst(prev.map((n) => (n.id === saved.id ? saved : n))));
      if (!pending.current) setSaveState("saved");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Leaving the tab unmounts this screen -- push out whatever was typed
  // in the last moments rather than letting the debounce timer die with it.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  useEffect(() => {
    listNotes()
      .then((list) => {
        const sorted = sortNewestFirst(list);
        setNotes(sorted);
        if (sorted[0]) {
          setSelectedId(sorted[0].id);
          setTitle(sorted[0].title);
          setBody(sorted[0].body);
        }
        setLoaded(true);
      })
      .catch((e) => {
        setError(String(e));
        setLoaded(true);
      });
  }, []);

  function scheduleSave(id: number, nextTitle: string, nextBody: string) {
    pending.current = { id, title: nextTitle, body: nextBody };
    setSaveState("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  async function selectNote(note: Note) {
    if (note.id === selectedId) return;
    await flush();
    setSelectedId(note.id);
    setTitle(note.title);
    setBody(note.body);
    setConfirmingDelete(false);
  }

  async function handleNew() {
    await flush();
    try {
      const note = await createNote();
      // Guarded against already being present: React Strict Mode can run a
      // functional updater twice in dev (same reason as ActivitiesScreen's
      // onProjectCreated), which would otherwise list the new note twice.
      setNotes((prev) => (prev.some((n) => n.id === note.id) ? prev : [note, ...prev]));
      setSearch("");
      setSelectedId(note.id);
      setTitle("");
      setBody("");
      setConfirmingDelete(false);
      window.setTimeout(() => titleInput.current?.focus(), 0);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete() {
    if (selectedId == null) return;
    window.clearTimeout(timer.current);
    pending.current = null;
    const id = selectedId;
    try {
      await deleteNote(id);
    } catch (e) {
      setError(String(e));
      return;
    }
    const remaining = notes.filter((n) => n.id !== id);
    setNotes(remaining);
    setConfirmingDelete(false);
    setSaveState("saved");
    const next = remaining[0] ?? null;
    setSelectedId(next?.id ?? null);
    setTitle(next?.title ?? "");
    setBody(next?.body ?? "");
  }

  const visibleNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
  }, [notes, search]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="notes-screen">
      <aside className="notes-sidebar">
        <div className="notes-sidebar-top">
          <button type="button" className="btn btn-accent notes-new" onClick={handleNew}>
            + New Note
          </button>
          <input
            type="text"
            className="notes-search"
            placeholder="Search notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ul className="notes-list">
          {visibleNotes.map((note) => {
            // The open note's own list row follows what's being typed right
            // now, not the last-saved copy, so it never looks a beat behind.
            const live = note.id === selectedId ? { ...note, title, body } : note;
            return (
              <li key={note.id}>
                <button
                  type="button"
                  className={"notes-item" + (note.id === selectedId ? " notes-item-active" : "")}
                  onClick={() => void selectNote(note)}
                >
                  <span className="notes-item-title">
                    {live.title.trim() || <span className="muted">Untitled note</span>}
                  </span>
                  <span className="notes-item-meta muted">
                    {formatUpdated(note.updatedAt)}
                    {live.body.trim() ? ` · ${live.body.trim().replace(/\s+/g, " ").slice(0, 50)}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
          {loaded && visibleNotes.length === 0 && (
            <li className="muted notes-empty">{notes.length === 0 ? "No notes yet." : "No notes match your search."}</li>
          )}
        </ul>
      </aside>

      <section className="notes-editor">
        {error && <p className="status status-error">{error}</p>}
        {selected ? (
          <>
            <div className="notes-editor-top">
              <input
                ref={titleInput}
                type="text"
                className="notes-title-input"
                placeholder="Title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  scheduleSave(selected.id, e.target.value, body);
                }}
              />
              <span className="muted notes-save-state">{saveState === "saving" ? "Saving…" : "Saved"}</span>
              {confirmingDelete ? (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmingDelete(false)}>
                    Keep
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => void handleDelete()}>
                    Delete note
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </button>
              )}
            </div>
            <textarea
              className="notes-body-input"
              placeholder="Start typing…"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                scheduleSave(selected.id, title, e.target.value);
              }}
            />
          </>
        ) : (
          loaded && (
            <div className="notes-placeholder muted">
              <p>{notes.length === 0 ? "Nothing here yet." : "Select a note to read or edit it."}</p>
              {notes.length === 0 && (
                <button type="button" className="btn btn-accent" onClick={handleNew}>
                  Create your first note
                </button>
              )}
            </div>
          )
        )}
      </section>
    </div>
  );
}
