#!/usr/bin/env python3
"""Offline source export and authorized candidate patch. Never writes upstream."""
import hashlib, json, pathlib, subprocess, sys, tarfile, io
lane=pathlib.Path(__file__).resolve().parents[5]
vendor=pathlib.Path('/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm')
sha='e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3'
out=lane/'var/managed-native-observation/source'
docs=pathlib.Path(__file__).resolve().parent
if out.exists(): raise SystemExit('Refusing to overwrite an existing candidate export')
if subprocess.check_output(['git','rev-parse','HEAD'],cwd=vendor,text=True).strip()!=sha: raise SystemExit('Wrong upstream HEAD')
raw=subprocess.check_output(['git','archive','--format=tar',sha],cwd=vendor)
out.mkdir(parents=True)
with tarfile.open(fileobj=io.BytesIO(raw)) as archive: archive.extractall(out,filter='data')
paths=['packages/openfilm/studio/ui/src/lib/host.ts','packages/openfilm/studio/ui/src/editor/use-film.ts','packages/openfilm/studio/ui/src/components/ProjectView.tsx','packages/openfilm/studio/ui/src/lib/media-queue.ts']
original={p:(out/p).read_bytes() for p in paths}
def replace(s,a,b):
 if s.count(a)!=1: raise RuntimeError('Expected exactly one source preimage: '+a[:100])
 return s.replace(a,b)
p=out/paths[0];s=p.read_text()
s=replace(s,'export interface StudioHost {', '''/** Managed Narralens extension; document DOM commit is distinct from preview/media readiness. */
export type NarralensDocumentState = {
  protocol_version: 1; project_id: string; editor_view_id: string; document_epoch: number;
} & ({ kind: 'document_dom_committed'; native_rev: string; film_sha256: string; utf8_byte_length: number }
  | { kind: 'invalidated'; reason: 'dirty' | 'refresh' | 'broken' | 'external_edit' | 'replaced' | 'hash_failed' | 'unmounted' });

export interface StudioHost {''')
s=replace(s,'  onSelection?: (selection: StudioSelection) => void;', '''  onSelection?: (selection: StudioSelection) => void;
  /** Optional managed extension. Its callback grants no write/approval authority. */
  narralensObservation?: { version: 1; onDocumentState: (state: NarralensDocumentState) => void };''')
p.write_text(s)
p=out/paths[1];s=p.read_text()
s=replace(s,"import { inverse } from './undo';", "import { inverse } from './undo';\nimport { studioHost, type NarralensDocumentState } from '../lib/host';")
s=replace(s,'export type FilmState = { value: Film; rev: string };', '''export type FilmDocumentEvidence = {
  projectId: string; editorViewId: string; epoch: number; text: string; rev: string; value: Film;
};
export type FilmState = { value: Film; rev: string; text?: string; document?: FilmDocumentEvidence | null };''')
s=replace(s,'  const [state, setState] = useState<FilmState | null>(initial);', '''  // Observation metadata follows this very editor store, never a second document reducer.
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
    ? { ...initial, document: null } : null);''')
s=replace(s,'  /** edits applied here and not yet written */\n  const pending = useRef(0);','  /** pending above also prevents proof of optimistic bytes under an old server revision. */')
s=replace(s,'  useEffect(() => { if (initial && !ref.current) setState(initial); }, [initial]);', '''  useEffect(() => {
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
  }, [invalidateDocument, serverDocument]);''')
s=replace(s,'    const latest = await api.film(projectId);', """    invalidateDocument('refresh');
    // A response cannot acquire a fresh proof after a newer request/edit/replacement invalidated it.
    const requestEpoch = observation.current.epoch;
    const latest = await api.film(projectId);
    const currentRequest = observation.current.mounted && observation.current.epoch === requestEpoch;
    // Preserve native reducer behavior, but invalidate any newer proof before an old response replaces its UI.
    if (!currentRequest) invalidateDocument('refresh');""")
s=replace(s,'      brokenRev.current = latest.rev;', "      invalidateDocument('broken');\n      brokenRev.current = latest.rev;")
s=replace(s,'    const next = { value: latest.value, rev: latest.rev };', '    const next = { value: latest.value, rev: latest.rev, document: currentRequest ? serverDocument(latest.value, latest.rev, latest.text) : null };')
s=replace(s,'  }, [projectId]);\n\n  /* the agent', '  }, [projectId, invalidateDocument, serverDocument]);\n\n  /* the agent')
s=replace(s,'    const next = { value: after, rev: current.rev };', "    invalidateDocument('dirty');\n    const next = { value: after, rev: current.rev, document: null };")
s=replace(s,'          ref.current = { value: theirs, rev: done.rev };', '          ref.current = { value: theirs, rev: done.rev, document: done.doc ? serverDocument(theirs, done.rev, done.text) : null };')
s=replace(s,'''          ref.current = { ...here, rev: done.rev };
          setState((s) => (s ? { ...s, rev: done.rev } : s));''','''          const document = done.doc && done.value && pending.current === 0
            && JSON.stringify(done.value) === JSON.stringify(here.value)
            ? serverDocument(here.value, done.rev, done.text) : null;
          ref.current = { ...here, rev: done.rev, document };
          setState((s) => (s ? { ...s, rev: done.rev, document: s.value === here.value ? document : null } : s));''')
s=replace(s,'''          ref.current = current;
          setState(current);''','''          ref.current = { ...current, document: null };
          setState(ref.current);''')
s=replace(s,'  }, [projectId, fromServer, setSteps]);','  }, [projectId, fromServer, setSteps, invalidateDocument, serverDocument]);')
s=replace(s,"  const runOutside = useCallback((step: Step, kind: 'undo' | 'redo') => {", "  const runOutside = useCallback((step: Step, kind: 'undo' | 'redo') => {\n    invalidateDocument('external_edit');")
s=replace(s,'    queue.current = written;\n  }, [setSteps]);','    queue.current = written;\n  }, [setSteps, invalidateDocument]);')
s=replace(s,'  const record = useCallback((label: string, outside: OutsideStep) => {', "  const record = useCallback((label: string, outside: OutsideStep) => {\n    invalidateDocument('external_edit');")
s=replace(s,"  }, [setSteps]);\n  /** The film was replaced", "  }, [setSteps, invalidateDocument]);\n  /** The film was replaced")
s=replace(s,'  const forget = useCallback(() => setSteps(() => ({ done: [], undone: [] })), [setSteps]);', "  const forget = useCallback(() => { invalidateDocument('replaced'); setSteps(() => ({ done: [], undone: [] })); }, [setSteps, invalidateDocument]);")
s=replace(s,'    film: state?.value ?? null, rev: state?.rev ?? null, error, broken, edit, record, undo, redo, rollbackTo, forget, steps,', '''    film: state?.value ?? null, rev: state?.rev ?? null, error, broken, edit, record, undo, redo, rollbackTo, forget, steps,
    document: state?.document ?? null, invalidateDocument, reportDocument: report,
    isDocumentCurrent: (evidence: FilmDocumentEvidence) => observation.current.mounted && observation.current.evidence === evidence
      && pending.current === 0 && !brokenRev.current && ref.current?.value === evidence.value && ref.current?.rev === evidence.rev,''')
p.write_text(s)
p=out/paths[2];s=p.read_text()
s=replace(s,'? { value: loaded.value, rev: loaded.rev } : null)', '? { value: loaded.value, rev: loaded.rev, text: loaded.project.id === projectId ? loaded.text : undefined } : null)')
s=replace(s,': null), [loaded]);', ': null), [loaded, projectId]);')
# Declare hooks before the existing conditional returns; attach to only the actual editor root.
s=replace(s,'  if (failure) {\n    return (', '''  const documentRoot = React.useRef<HTMLDivElement>(null);
  const documentEvidence = film.document;
  // Hash the exact server text only after the actual native document render committed.
  React.useLayoutEffect(() => {
    const evidence = documentEvidence;
    const root = documentRoot.current;
    if (!evidence || !root || failure || evidence.projectId !== projectId || !film.isDocumentCurrent(evidence)) return;
    let cancelled = false;
    const bytes = new TextEncoder().encode(evidence.text);
    void crypto.subtle.digest('SHA-256', bytes).then((digest) => {
      if (cancelled || !root.isConnected || documentRoot.current !== root || !film.isDocumentCurrent(evidence)) return;
      const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      if (!/^[a-f0-9]{16}$/.test(evidence.rev) || sha256.slice(0, 16) !== evidence.rev) {
        film.invalidateDocument('hash_failed'); return;
      }
      film.reportDocument({ protocol_version: 1, kind: 'document_dom_committed', project_id: projectId,
        editor_view_id: evidence.editorViewId, document_epoch: evidence.epoch,
        native_rev: evidence.rev, film_sha256: sha256, utf8_byte_length: bytes.byteLength });
    }).catch(() => {
      if (!cancelled && film.isDocumentCurrent(evidence)) film.invalidateDocument('hash_failed');
    });
    return () => { cancelled = true; };
  }, [documentEvidence, failure, projectId]);

  if (failure) {
    return (''')
s=replace(s,'    <div className="workspace-shell flex flex-col bg-[var(--dock-shell)]">','    <div ref={documentRoot} className="workspace-shell flex flex-col bg-[var(--dock-shell)]">')
p.write_text(s)
p=out/paths[3];s=p.read_text()
s=replace(s,"import * as React from 'react';", """import * as React from 'react';

// Managed readonly media transport; the Host owns project/path/capability validation.
declare global {
  var narralensNativeTransport: { readonly mediaUrl: (url: string) => string } | undefined;
}""")
s=replace(s,'export const MEDIA_IN_FLIGHT = 2;', """/** Identity without a managed Host; Host normalization must be idempotent for an already scoped URL. */
const mediaUrl = (url: string): string => globalThis.narralensNativeTransport?.mediaUrl(url) ?? url;

export const MEDIA_IN_FLIGHT = 2;""")
s=replace(s,'export async function mediaImage(url: string, still?: () => boolean): Promise<boolean | null> {', 'export async function mediaImage(url: string, still?: () => boolean): Promise<boolean | null> {\n  url = mediaUrl(url);')
s=replace(s,'export function useMediaImage(url: string | null | undefined, wanted = true): string | null {', 'export function useMediaImage(url: string | null | undefined, wanted = true): string | null {\n  url = url ? mediaUrl(url) : url;')
s=replace(s,'export function useMediaImages(urls: Readonly<Record<string, string>>): Readonly<Record<string, string>> {', """export function useMediaImages(urls: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const inputUrls = urls;
  urls = React.useMemo(() => globalThis.narralensNativeTransport
    ? Object.fromEntries(Object.entries(inputUrls).map(([key, url]) => [key, mediaUrl(url)])) : inputUrls, [inputUrls]);""")
p.write_text(s)
# Diff only the explicitly authorized files, with portable a/ and b/ paths.
patch=[]; manifest=[]
import difflib
for path in paths:
 after=(out/path).read_bytes()
 patch.extend(difflib.unified_diff(original[path].decode().splitlines(True),after.decode().splitlines(True),fromfile='a/'+path,tofile='b/'+path))
 manifest.append({'path':path,'pre_sha256':hashlib.sha256(original[path]).hexdigest(),'post_sha256':hashlib.sha256(after).hexdigest()})
patch_bytes=''.join(patch).encode();(docs/'candidate.patch').write_bytes(patch_bytes)
(docs/'source-manifest.json').write_text(json.dumps({'upstream_sha':sha,'patch_sha256':hashlib.sha256(patch_bytes).hexdigest(),'files':manifest,'status':'SOURCE_CANDIDATE_NOT_COMPILED','build':'NOT_RUN','browser':'NOT_RUN'},indent=2)+'\n')
print(json.dumps({'export':str(out),'upstream_sha':sha,'patch_sha256':hashlib.sha256(patch_bytes).hexdigest(),'changed_files':len(manifest),'build':'NOT_RUN'}))
