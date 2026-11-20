/**
 * The film being edited: film.html as the server last wrote it, plus the edits made here since, already applied.
 *
 * An edit shows at once: it is applied here with the server's own code (server/ops.mjs), the picture is told, and the
 * edit is sent to be written, one request at a time, each against the revision the last one produced. When the
 * server answers that the film moved on without it (the agent removed the clip), the film here becomes the server's;
 * so it does when the folder's film, once every edit here is written, is not the one here (the agent wrote it a moment
 * before, and the server applied the edit on top). A film.html that cannot be read (the agent is halfway through
 * writing it, or wrote it wrong) is `broken`: the film here stays as it last was, and edits wait for it to be whole.
 *
 * Undo and redo are edits too, worked out by clip id from the film before and after (`inverse`), so undoing a move
 * puts that clip back without putting back what the agent changed meanwhile.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyOps, EditError } from '../../../server/ops.mjs';
import { filmHead } from '../../../../src/film-doc.mjs';
import { api, ApiError, projectEvents, type Film, type Op } from '../api';
import { inverse } from './undo';
import { studioHost, type NarralensDocumentState } from '../lib/host';

export type FilmDocumentEvidence = {
  projectId: string; editorViewId: string; epoch: number; text: string; rev: string; value: Film;
};
export type FilmState = { value: Film; rev: string; text?: string; document?: FilmDocumentEvidence | null };

/**
 * One edit a person made here, undoable: what undoes it, what makes it again, and what to call it in the history.
 * `outside`: an edit of another file than film.html (a subtitle's times, in its transcript), undone and made again by
 * its own calls, which resolve to null or why they could not; its `undo` and `redo` are empty.
 */
export type Step = { undo: Op[]; redo: Op[]; label: string; at: number; outside?: OutsideStep };
export type OutsideStep = { undo: () => Promise<string | null>; redo: () => Promise<string | null> };

/**
 * The film of a project, editable. `onChange(value, kind, head)` tells the picture: `edit` for an edit made here (try
 * it in place), `server` for the film as the folder has it now (the agent wrote it, or an edit was refused), with its
 * file's head when known (a changed one is the film loaded again: its styles are not in the value).
 */
export function useFilm(projectId: string, initial: FilmState | null, onChange: (value: Film, kind: 'edit' | 'server', head?: string) => void) {
  // Observation metadata follows this very editor store, never a second document reducer.
  const [editorViewId] = useState(() => crypto.randomUUID());
  const observation = useRef<{ epoch: number; evidence: FilmDocumentEvidence | null; mounted: boolean }>({ epoch: 0, evidence: null, mounted: true });
  const pending = useRef(0);
  const report = useCallback((event: NarralensDocumentState) => {
    try { if (studioHost?.narralensObservation?.version === 1) studioHost.narralensObservation.onDocumentState(event); }
    catch { /* An optional observer cannot break native editing. */ }
  }, []);
  const invalidateDocument = useCallback((reason: Extract<NarralensDocumentState, {kind: 'invalidated'}>['reason']) => {
    observation.current.evidence = null;
    const epoch = ++observation.current.epoch;
    if (!observation.current.mounted) return;
    report({ protocol_version: 1, kind: 'invalidated', project_id: projectId, editor_view_id: editorViewId, document_epoch: epoch, reason });
  }, [projectId, editorViewId, report]);
  const serverDocument = useCallback((value: Film, rev: string, text: string | undefined): FilmDocumentEvidence | null => {
    if (!observation.current.mounted || pending.current !== 0 || text === undefined) return null;
    const evidence = { projectId, editorViewId, epoch: ++observation.current.epoch, text, rev, value };
    observation.current.evidence = evidence;
    return evidence;
  }, [projectId, editorViewId]);
  const [state, setState] = useState<FilmState | null>(() => initial
    ? { ...initial, document: null } : null);
  const [error, setError] = useState<string | null>(null);
  /** why film.html cannot be read now (null: it can) */
  const [broken, setBroken] = useState<string | null>(null);
  const brokenRev = useRef<string | null>(null);
  /** pending above also prevents proof of optimistic bytes under an old server revision. */
  const [steps, setStepsState] = useState<{ done: Step[]; undone: Step[] }>({ done: [], undone: [] });
  /* the steps as they are now, ahead of the render: an undo pressed right after an edit (a nudge written the moment
     before it) undoes that edit, not the one before */
  const stepsRef = useRef(steps);
  const setSteps = useCallback((next: (s: { done: Step[]; undone: Step[] }) => { done: Step[]; undone: Step[] }) => {
    stepsRef.current = next(stepsRef.current);
    setStepsState(stepsRef.current);
  }, []);
  const ref = useRef(state);
  ref.current = state;
  const queue = useRef(Promise.resolve());
  /**
   * revisions this editor wrote, oldest first: their echo from the folder watcher is not news. The watcher reports the
   * file as it is once writes settle, so an echo also stands for every write before it, unreported; those are
   * forgotten with it, or an outside write that happens to match one of them (the agent putting back an earlier text)
   * would be taken for an echo and never shown.
   */
  const ours = useRef(new Set<string>());
  const echoOf = (rev: string) => {
    if (!ours.current.has(rev)) return false;
    for (const r of ours.current) { ours.current.delete(r); if (r === rev) break; }
    return true;
  };
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(() => {
    if (initial && (!ref.current || (observation.current.epoch === 0
      && ref.current.value === initial.value && ref.current.rev === initial.rev))) {
      ref.current = { ...initial, document: serverDocument(initial.value, initial.rev, initial.text) };
      setState(ref.current);
    }
  }, [initial, serverDocument]);
  // Stable view identity plus a monotonically increasing epoch makes StrictMode/remounts distinguishable.
  useEffect(() => {
    observation.current.mounted = true;
    const here = ref.current;
    // StrictMode cleanup/setup must renew the token; real unmounts cannot publish late responses.
    if (here?.document && !observation.current.evidence && pending.current === 0 && !brokenRev.current) {
      ref.current = { ...here, document: serverDocument(here.value, here.rev, here.document.text) };
      setState(ref.current);
    }
    return () => { invalidateDocument('unmounted'); observation.current.mounted = false; };
  }, [invalidateDocument, serverDocument]);

  /** The film as the folder has it now; false when film.html cannot be read (`broken` says why). */
  const fromServer = useCallback(async (): Promise<boolean> => {
    invalidateDocument('refresh');
    const latest = await api.film(projectId);
    if (!latest.doc || !latest.value) {
      invalidateDocument('broken');
      brokenRev.current = latest.rev;
      setBroken(latest.problems.join('\n') || 'film.html cannot be read');
      return false;
    }
    if (brokenRev.current) { brokenRev.current = null; setBroken(null); setError(null); }
    const next = { value: latest.value, rev: latest.rev, document: serverDocument(latest.value, latest.rev, latest.text) };
    ref.current = next;
    setState(next);
    changed.current(next.value, 'server', filmHead(latest.text));
    return true;
  }, [projectId, invalidateDocument, serverDocument]);

  /* the agent's writes: the film becomes the folder's (an edit of ours still on its way is applied on top by the server) */
  useEffect(() => projectEvents(projectId, (event) => {
    if (event.type !== 'film' || echoOf(event.rev)) return;
    /* the same text as here is news only after the file could not be read (written whole again) */
    if (event.rev === ref.current?.rev && !brokenRev.current) return;
    /* not read: Studio went away (it was stopping) — it tells again when it is back */
    void queue.current.then(fromServer).catch(() => {});
  }), [projectId, fromServer]);

  /**
   * Apply `ops` here at once, then write them. Resolves once written: null, or why it was not (the film here is then
   * the folder's again). Resolves at once with the reason when the film here refuses them.
   */
  /* `quiet`: the caller says why it was refused itself (the inspector, beside its field), so `error` is not set */
  const run = useCallback((ops: Op[], record: 'do' | 'undo' | 'redo' = 'do', label = 'history.stepEdit', quiet = false): Promise<string | null> => {
    const current = ref.current;
    if (!current || !ops.length) return Promise.resolve(null);
    /* film.html cannot be read: the edit could not be written, and shown it would draw the picture again from the
       broken file. Nothing changes; the note on the film already says why (`broken`) */
    if (brokenRev.current) return Promise.resolve(null);
    let after: Film;
    try { after = applyOps(structuredClone(current.value), ops) as Film; }
    catch (e) {
      const why = e instanceof EditError ? e.message : String(e);
      if (!quiet) setError(why);
      return Promise.resolve(why);
    }
    const before = current.value;
    invalidateDocument('dirty');
    const next = { value: after, rev: current.rev, document: null };
    ref.current = next;
    setState(next);
    setError(null);
    changed.current(after, 'edit');
    pending.current += 1;
    const step: Step = { undo: inverse(before, after, ops), redo: ops, label, at: Date.now() };
    setSteps((s) => (record === 'do' ? { done: [...s.done.slice(-99), step], undone: [] }
      : record === 'undo' ? { done: s.done.slice(0, -1), undone: [...s.undone, s.done[s.done.length - 1]] }
        : { done: [...s.done, s.undone[s.undone.length - 1]], undone: s.undone.slice(0, -1) }));
    const written = queue.current.then(async (): Promise<string | null> => {
      try {
        const done = await api.edit(projectId, ref.current?.rev ?? null, ops);
        ours.current.delete(done.rev);
        ours.current.add(done.rev);
        pending.current -= 1;
        const here = ref.current;
        if (!here) return null;
        /* every edit here written: the folder's film is the truth (another write came in under this one) */
        const theirs = pending.current === 0 ? done.value : null;
        if (theirs && (done.rebased || JSON.stringify(theirs) !== JSON.stringify(here.value))) {
          ref.current = { value: theirs, rev: done.rev, document: done.doc ? serverDocument(theirs, done.rev, done.text) : null };
          setState(ref.current);
          changed.current(theirs, 'server', filmHead(done.text));
        } else {
          const document = done.doc && done.value && pending.current === 0
            && JSON.stringify(done.value) === JSON.stringify(here.value)
            ? serverDocument(here.value, done.rev, done.text) : null;
          ref.current = { ...here, rev: done.rev, document };
          setState((s) => (s ? { ...s, rev: done.rev, document: s.value === here.value ? document : null } : s));
        }
        return null;
      } catch (e) {
        pending.current -= 1;
        const why = e instanceof ApiError ? e.message : String(e);
        /* what was not written is not a step to undo */
        if (record === 'do') setSteps((s) => ({ ...s, done: s.done.filter((x) => x !== step) }));
        if (!(await fromServer())) {
          /* the folder's film cannot be read: back to the film as it was before this edit (the note on the film says
             why, so it is not said again) */
          ref.current = { ...current, document: null };
          setState(ref.current);
          changed.current(current.value, 'server');
          return null;
        }
        if (!quiet) setError(why);
        return why;
      }
    });
    queue.current = written.then(() => {});
    return written;
  }, [projectId, fromServer, setSteps, invalidateDocument, serverDocument]);

  /* a step of another file: moved between the lists at once, its call made in turn with the film's writes; one that
     cannot be undone (the file changed since, elsewhere) leaves both lists, and says why */
  const runOutside = useCallback((step: Step, kind: 'undo' | 'redo') => {
    invalidateDocument('external_edit');
    setSteps((s) => (kind === 'undo' ? { done: s.done.slice(0, -1), undone: [...s.undone, step] } : { done: [...s.done, step], undone: s.undone.slice(0, -1) }));
    const written = queue.current.then(async () => {
      const why = await step.outside![kind]().catch((e: unknown) => String(e instanceof Error ? e.message : e));
      if (why) {
        setError(why);
        setSteps((s) => ({ done: s.done.filter((x) => x !== step), undone: s.undone.filter((x) => x !== step) }));
      }
    });
    queue.current = written;
  }, [setSteps, invalidateDocument]);
  const step = useCallback((one: Step, kind: 'undo' | 'redo') => {
    if (one.outside) runOutside(one, kind);
    else void run(kind === 'undo' ? one.undo : one.redo, kind);
  }, [run, runOutside]);
  const undo = useCallback(() => {
    const one = stepsRef.current.done[stepsRef.current.done.length - 1];
    if (one) step(one, 'undo');
  }, [step]);
  const redo = useCallback(() => {
    const one = stepsRef.current.undone[stepsRef.current.undone.length - 1];
    if (one) step(one, 'redo');
  }, [step]);
  /** Undo or redo until `done` steps are done (the edit history's rows: click one to go back or forward to it). */
  const rollbackTo = useCallback((done: number) => {
    let { done: d, undone: u } = stepsRef.current;
    while (d.length > done && d.length) { const one = d[d.length - 1]; step(one, 'undo'); u = [...u, one]; d = d.slice(0, -1); }
    while (d.length < done && u.length) { const one = u[u.length - 1]; step(one, 'redo'); d = [...d, one]; u = u.slice(0, -1); }
  }, [step]);
  const edit = useCallback((ops: Op[], label?: string, quiet?: boolean) => run(ops, 'do', label, quiet), [run]);
  /** An edit of another file, made already: kept as a step, so ⌘Z undoes it in turn with the film's. */
  const record = useCallback((label: string, outside: OutsideStep) => {
    invalidateDocument('external_edit');
    setSteps((s) => ({ done: [...s.done.slice(-99), { undo: [], redo: [], label, at: Date.now(), outside }], undone: [] }));
  }, [setSteps, invalidateDocument]);
  /** The film was replaced as a whole (an earlier version put back): the edits made before are not undone into it. */
  const forget = useCallback(() => { invalidateDocument('replaced'); setSteps(() => ({ done: [], undone: [] })); }, [setSteps, invalidateDocument]);

  return {
    film: state?.value ?? null, rev: state?.rev ?? null, error, broken, edit, record, undo, redo, rollbackTo, forget, steps,
    document: state?.document ?? null, invalidateDocument, reportDocument: report,
    isDocumentCurrent: (evidence: FilmDocumentEvidence) => observation.current.mounted && observation.current.evidence === evidence
      && pending.current === 0 && !brokenRev.current && ref.current?.value === evidence.value && ref.current?.rev === evidence.rev,
    canUndo: steps.done.length > 0, canRedo: steps.undone.length > 0, settled: () => queue.current,
  };
}
