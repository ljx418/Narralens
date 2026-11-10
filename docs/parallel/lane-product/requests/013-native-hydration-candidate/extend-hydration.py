#!/usr/bin/env python3
"""Source-only managed hydration extension. Never writes upstream or MAIN."""
from pathlib import Path
import json,hashlib,shutil
here=Path(__file__).resolve().parent;lane=here.parents[4];root=lane/'var/managed-native-observation/source';prefix='packages/openfilm/studio/ui/src/'
paths=['lib/host.ts','editor/use-film.ts','components/ProjectView.tsx','lib/use-film-subtitles.ts','lib/use-subtitle-style.ts','components/use-editor-tools.tsx','lib/media-queue.ts']
backup=lane/'var/managed-native-observation/pre-hydration'
if backup.exists():raise SystemExit('Refusing to overwrite preserved source')
for rel in paths:
 p=backup/prefix/rel;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/prefix/rel,p)
(here/'pre-extension-source.json').write_text(json.dumps([{'path':prefix+p,'sha256':hashlib.sha256((root/prefix/p).read_bytes()).hexdigest()} for p in paths],indent=2)+'\n')
def edit(path,a,b):
 p=root/prefix/path;s=p.read_text()
 if s.count(a)!=1:raise RuntimeError('Expected one preimage '+path+' '+a[:70])
 p.write_text(s.replace(a,b))
# Host-only optional protocol; film v1 is untouched.
edit('lib/host.ts','export interface StudioHost {', '''export type NarralensHydrationPart = 'settings' | 'subtitle_style' | 'captions' | 'markers';
export type NarralensHydrationOrigin = 'project' | 'explicit_default' | 'browser_preference';
export type NarralensHydrationPartState = {
  state: 'pending' | 'hydrated' | 'absent_default' | 'dirty' | 'failed' | 'unsupported';
  origin: NarralensHydrationOrigin; effective_sha256: string | null;
};
export type NarralensHydrationState = {
  project_id: string; editor_view_id: string; document_epoch: number; hydration_epoch: number;
  parts: Record<NarralensHydrationPart, NarralensHydrationPartState>;
};

export interface StudioHost {''')
edit('lib/host.ts','  narralensObservation?: { version: 1; onDocumentState: (state: NarralensDocumentState) => void };', '''  narralensObservation?: { version: 1; onDocumentState: (state: NarralensDocumentState) => void };
  /** Managed editor hydration only; it never asserts media decoded or authorizes writes. */
  narralensHydration?: { version: 1; onState: (state: NarralensHydrationState) => void };''')
edit('editor/use-film.ts',"import { studioHost, type NarralensDocumentState } from '../lib/host';", "import { studioHost, type NarralensDocumentState } from '../lib/host';\nimport type { NativeHydrationScope } from '../lib/native-hydration';")
edit('editor/use-film.ts','  const queue = useRef(Promise.resolve());', '''  const hydrationScope = useRef<NativeHydrationScope | null>(null);
  if (!hydrationScope.current) hydrationScope.current = {
    projectId, editorViewId,
    current: () => {
      const evidence = observation.current.evidence;
      return { epoch: observation.current.epoch, valid: observation.current.mounted && pending.current === 0
        && !brokenRev.current && evidence !== null && ref.current?.value === evidence.value && ref.current?.rev === evidence.rev };
    },
  };
  const queue = useRef(Promise.resolve());''')
edit('editor/use-film.ts','    document: state?.document ?? null, invalidateDocument, reportDocument: report,','    document: state?.document ?? null, invalidateDocument, reportDocument: report, hydrationScope: hydrationScope.current,')
# Native hook read outcomes, without replacing their state or write behavior.
edit('lib/use-subtitle-style.ts',"import * as React from 'react';", "import * as React from 'react';\nimport type { NativePartObserver } from './native-hydration';")
edit('lib/use-subtitle-style.ts','export function useSubtitleStyle(projectId: string):', 'export function useSubtitleStyle(projectId: string, hydration?: NativePartObserver):')
edit('lib/use-subtitle-style.ts','    const start = startingStyle();', '    const remembered = readLastSubtitleStyle();\n    const start = remembered ?? SUBTITLE_DEFAULT;\n    const ticket = hydration?.begin();')
edit('lib/use-subtitle-style.ts',"      if (dirty) setStyle((s) => ({ ...s }));", """      if (dirty) setStyle((s) => ({ ...s }));
      if (!ask.signal.aborted && ticket) {
        if (dirty) hydration?.dirty();
        else hydration?.success(ticket, kept ? 'project' : remembered ? 'browser_preference' : 'explicit_default');
      }""")
edit('lib/use-subtitle-style.ts',"      if (!ask.signal.aborted) saved.current = '';", "      if (!ask.signal.aborted) { saved.current = ''; if (ticket) hydration?.failed(ticket); }")
edit('lib/use-subtitle-style.ts','  }, [projectId]);', '  }, [projectId, hydration]);')
edit('lib/use-subtitle-style.ts','  return [style, setStyle];', '''  const observedSetStyle = React.useCallback<React.Dispatch<React.SetStateAction<SubtitleStyle>>>((next) => {
    hydration?.dirty(); setStyle(next);
  }, [hydration]);
  return [style, observedSetStyle];''')
edit('lib/use-film-subtitles.ts',"import * as React from 'react';", "import * as React from 'react';\nimport type { NativePartObserver } from './native-hydration';")
edit('lib/use-film-subtitles.ts','export function useFilmSubtitles(projectId: string): FilmSubtitles {', '''export function useFilmSubtitles(projectId: string, hydration?: { style: NativePartObserver; captions: NativePartObserver }): FilmSubtitles {''')
edit('lib/use-film-subtitles.ts','  const [style, setStyle] = useSubtitleStyle(projectId);','  const [style, setStyle] = useSubtitleStyle(projectId, hydration?.style);')
edit('lib/use-film-subtitles.ts','    const ask = ++latest.current;', '    const ask = ++latest.current;\n    const ticket = hydration?.captions.begin();')
edit('lib/use-film-subtitles.ts','      if (ask === latest.current) setCaptions(next);', '      if (ask === latest.current) { setCaptions(next); if (ticket) hydration?.captions.success(ticket); }')
edit('lib/use-film-subtitles.ts','    } catch { /* keep what is shown; the next change asks again */ }', '    } catch { if (ask === latest.current && ticket) hydration?.captions.failed(ticket); /* keep what is shown */ }')
edit('lib/use-film-subtitles.ts','  }, [projectId]);','  }, [projectId, hydration]);')
edit('lib/use-film-subtitles.ts',"      if (event.type !== 'film' && event.type !== 'files') return;", "      if (event.type !== 'film' && event.type !== 'files') return;\n      hydration?.captions.pending();")
# Native effect, translate and line editing all add hydration to the same existing deps below.
edit('lib/use-film-subtitles.ts','    const result = await requestSubtitleTranslation(projectId, language);', '    hydration?.captions.dirty();\n    const result = await requestSubtitleTranslation(projectId, language);')
# Add dependencies only to the remaining callbacks that gained metadata references.
edit('lib/use-film-subtitles.ts','    setTranscribing(true);','    hydration?.captions.dirty();\n    setTranscribing(true);')
edit('lib/use-film-subtitles.ts','  }, [projectId, refresh, setStyle]);','  }, [projectId, refresh, setStyle, hydration]);')
edit('lib/use-film-subtitles.ts','    const ok = await saveSubtitleLine(projectId,', '    hydration?.captions.dirty();\n    const ok = await saveSubtitleLine(projectId,')
p=root/prefix/'lib/use-film-subtitles.ts';s=p.read_text();s=s.replace('}, [projectId, refresh]);','}, [projectId, refresh, hydration]);');p.write_text(s)
edit('components/use-editor-tools.tsx',"import * as React from 'react';", "import * as React from 'react';\nimport type { NativePartObserver } from '@/lib/native-hydration';")
edit('components/use-editor-tools.tsx','  projectId, tracks, film, settings, patchSettings, player, timeRef, seek, edit, record, editModel, selectedClipIds, listing, toast, pickFile,','  projectId, tracks, film, settings, patchSettings, player, timeRef, seek, edit, record, editModel, selectedClipIds, listing, toast, pickFile, markerHydration, settingsHydration,')
edit('components/use-editor-tools.tsx','  settings: ProjectSettings | null;', '  settings: ProjectSettings | null;\n  markerHydration?: NativePartObserver;\n  settingsHydration?: NativePartObserver;')
edit('components/use-editor-tools.tsx','    let live = true;\n    setMarkers([]);', '    let live = true;\n    const ticket = markerHydration?.begin();\n    setMarkers([]);')
edit('components/use-editor-tools.tsx','    void api.markers(projectId).then((raw) => { if (live) setMarkers(parseMarkers(raw)); }, () => {});', '    void api.markers(projectId).then((raw) => { if (live) { setMarkers(parseMarkers(raw)); if (ticket) markerHydration?.success(ticket); } }, () => { if (live && ticket) markerHydration?.failed(ticket); });')
edit('components/use-editor-tools.tsx','    return () => { live = false; };\n  }, [projectId]);', '    return () => { live = false; };\n  }, [projectId, markerHydration]);')
edit('components/use-editor-tools.tsx','  const writeMarkers = React.useCallback((next: Marker[]): Promise<string | null> => {', '  const writeMarkers = React.useCallback((next: Marker[]): Promise<string | null> => {\n    markerHydration?.dirty();')
edit('components/use-editor-tools.tsx','    return done;\n  }, [projectId]);', '    return done;\n  }, [projectId, markerHydration]);')
edit('components/use-editor-tools.tsx','    if (!done && height != null) { setLive({ docIndex: track.docIndex, height }); return; }','    if (!done && height != null) { settingsHydration?.dirty(); setLive({ docIndex: track.docIndex, height }); return; }')
edit('components/use-editor-tools.tsx','  }, [setHeights]);','  }, [setHeights, settingsHydration]);')
edit('components/use-editor-tools.tsx','    tracks: shownTracks,', '''    tracks: shownTracks,
    hydrationMarkers: markers,
    hydrationPlacedMarkers: placed.map(({ marker, ms, clip }) => ({ marker, ms, clip_id: clip?.clipId ?? null })),''')
# ProjectView owns the actual DOM commit and consumes the original hook/state values.
edit('components/ProjectView.tsx',"import { useFilmSubtitles } from '@/lib/use-film-subtitles';", """import { useFilmSubtitles } from '@/lib/use-film-subtitles';
import { useNativeHydration, hydrationCanonicalJson, type HydrationSnapshots } from '@/lib/native-hydration';
import { parseMarkers } from '@/lib/markers';
import { ownTrackHeight } from '@/lib/track-heights';""")
edit('components/ProjectView.tsx',"import { cueAt, filmSubtitleStyleFor, sameFilmSubtitleLanguage } from '@/lib/subtitles';", "import { cueAt, filmSubtitleStyleFor, sameFilmSubtitleLanguage, fetchFilmCaptions, fetchSubtitleStyle, SUBTITLE_DEFAULT } from '@/lib/subtitles';")
edit('components/ProjectView.tsx','  personSteps.current = film.steps.done;', '''  const hydration = useNativeHydration(film.hydrationScope);
  const subtitleHydration = React.useMemo(() => ({ style: hydration.observer.parts.subtitle_style,
    captions: hydration.observer.parts.captions }), [hydration.observer]);
  React.useEffect(() => projectEvents(projectId, (event) => {
    if (event.type === 'film' || event.type === 'files') hydration.observer.invalidateChecks();
  }), [projectId, hydration.observer]);
  personSteps.current = film.steps.done;''')
edit('components/ProjectView.tsx', '''    setSettings(null);
    void api.settings(projectId).then(setSettings, () => setSettings({}));
  }, [projectId]);''', '''    const ticket = hydration.observer.parts.settings.begin();
    setSettings(null);
    void api.settings(projectId).then((next) => { setSettings(next); hydration.observer.parts.settings.success(ticket); },
      () => { setSettings({}); hydration.observer.parts.settings.failed(ticket); });
  }, [projectId, hydration.observer]);''')
edit('components/ProjectView.tsx','    void api.patchSettings(projectId, patch).then(setSettings, (e: Error) => toast.showError(e.message));', '    hydration.observer.parts.settings.dirty();\n    void api.patchSettings(projectId, patch).then(setSettings, (e: Error) => toast.showError(e.message));')
edit('components/ProjectView.tsx','  }, [projectId, toast]);\n  /* the rate frames', '  }, [projectId, toast, hydration.observer]);\n  /* the rate frames')
edit('components/ProjectView.tsx','  const subs = useFilmSubtitles(projectId);','  const subs = useFilmSubtitles(projectId, subtitleHydration);')
edit('components/ProjectView.tsx','    projectId, tracks: timelineTracks, film: film.film, settings, patchSettings, player, timeRef, seek, edit: editOps, record: film.record,','    projectId, tracks: timelineTracks, film: film.film, settings, patchSettings, player, timeRef, seek, edit: editOps, record: film.record,\n    markerHydration: hydration.observer.parts.markers, settingsHydration: hydration.observer.parts.settings,')
edit('components/ProjectView.tsx','  const documentEvidence = film.document;','''  const documentEvidence = film.document;
  const hydrationSnapshots: HydrationSnapshots = {
    settings: settings === null ? null : {
      basis: settings,
      value: { settings, resolved_fps: projectFps, fps_source: settings.fps == null ? 'footage_or_default' : 'project',
        track_names: [...trackNames].sort(([a], [b]) => a - b).map(([doc_index, name]) => ({ doc_index, name })),
        track_heights: tools.tracks.map((track) => ({ lane: track.lane, doc_index: track.docIndex ?? null,
          index: track.index, height: track.height ?? ownTrackHeight(track) })) },
      read: async () => ({ basis: await api.settings(projectId), origin: 'project', state: 'hydrated' }),
    },
    subtitle_style: {
      basis: subs.style, value: subs.style,
      read: async () => { const kept = await fetchSubtitleStyle(projectId);
        return { basis: kept ?? SUBTITLE_DEFAULT, origin: kept ? 'project' : 'explicit_default', state: kept ? 'hydrated' : 'absent_default' }; },
    },
    captions: subs.captions === null ? null : {
      basis: { cues: subs.captions.cues, sourceLanguage: subs.captions.sourceLanguage,
        languages: subs.captions.languages, untranscribed: subs.captions.untranscribed },
      value: { cues: subs.captions.cues, sourceLanguage: subs.captions.sourceLanguage,
        languages: subs.captions.languages, untranscribed: subs.captions.untranscribed },
      read: async () => { const next = await fetchFilmCaptions(projectId);
        return { basis: { cues: next.cues, sourceLanguage: next.sourceLanguage, languages: next.languages,
          untranscribed: next.untranscribed }, origin: 'project', state: 'hydrated' }; },
    },
    markers: {
      basis: tools.hydrationMarkers, value: { placed: tools.hydrationPlacedMarkers },
      read: async () => ({ basis: parseMarkers(await api.markers(projectId)), origin: 'project', state: 'hydrated' }),
    },
  };
  let hydrationKey = 'unsupported';
  try { hydrationKey = hydrationCanonicalJson(Object.fromEntries(Object.entries(hydrationSnapshots)
    .map(([part, snapshot]) => [part, snapshot ? { basis: snapshot.basis, value: snapshot.value } : null]))); }
  catch { /* The managed observer reports unsupported values without breaking the editor. */ }
  React.useLayoutEffect(() => {
    const root = documentRoot.current;
    if (!root || failure) return;
    return hydration.observer.observe(root, hydrationSnapshots);
  }, [hydration.observer, hydration.revision, hydrationKey, documentEvidence, failure, projectId]);''')
# Bundle helper source is explicit, portable and independently hashable.
helper=here/'native-hydration.ts'
if helper.exists(): (root/prefix/'lib/native-hydration.ts').write_bytes(helper.read_bytes())
