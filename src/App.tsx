import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  CircleHelp,
  Cloud,
  FilePlus2,
  FolderOpen,
  Menu as MenuIcon,
  Redo2,
  Save,
  Undo2,
  X,
} from 'lucide-react';
import { ExportModal } from './components/ExportModal';
import { Inspector } from './components/Inspector';
import { MediaLibrary, type LibraryTab } from './components/MediaLibrary';
import { Preview } from './components/Preview';
import { Timeline } from './components/Timeline';
import {
  addAssetToProject,
  canRedo,
  canUndo,
  createProject,
  deleteClip,
  formatDuration,
  historyReducer,
  initialHistory,
  makeMediaClip,
  makeTextClip,
  projectDuration,
  safeProjectName,
  splitProjectAt,
  type Clip,
  type MediaAsset,
  type Project,
  type TrackKind,
} from './domain/project';
import { mediaAssetFromFile, mediaAssetFromPath } from './lib/media';
import { chooseMediaFiles, chooseProjectToOpen, chooseProjectToSave, isDesktopApp, invoke, pathToAssetUrl } from './lib/native';
import './styles.css';

const AUTOSAVE_KEY = 'capnux.autosave.v1';

function hydrateProject(value: unknown): Project {
  if (!value || typeof value !== 'object') throw new Error('This is not a valid CapNux project file.');
  const stored = value as Partial<Project>;
  if (stored.formatVersion !== 1 || !Array.isArray(stored.tracks) || !Array.isArray(stored.clips) || !Array.isArray(stored.assets)) {
    throw new Error('Unsupported or damaged CapNux project file.');
  }
  const desktop = isDesktopApp();
  const base = createProject(typeof stored.name === 'string' ? stored.name : 'Untitled project');
  return {
    ...base,
    ...stored,
    assets: stored.assets.map((asset) => ({
      ...asset,
      url: desktop && asset.path ? '' : (asset.url?.startsWith('data:') ? asset.url : ''),
      thumbnails: asset.thumbnails ?? [],
      waveform: asset.waveform ?? [],
      missing: !asset.path && !asset.url?.startsWith('data:'),
    })),
    updatedAt: stored.updatedAt ?? new Date().toISOString(),
  } as Project;
}

function loadAutosave(): Project {
  try {
    const value = localStorage.getItem(AUTOSAVE_KEY);
    if (value) return hydrateProject(JSON.parse(value));
  } catch {
    localStorage.removeItem(AUTOSAVE_KEY);
  }
  return createProject();
}

function projectFileContents(project: Project): string {
  const saved = {
    ...project,
    assets: project.assets.map(({ url: _url, ...asset }) => asset),
  };
  return `${JSON.stringify(saved, null, 2)}\n`;
}

function newId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function updateClip(project: Project, clipId: string, patch: Partial<Clip>): Project {
  return { ...project, clips: project.clips.map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip) };
}

function CapNuxMark() {
  return <span className="brand-mark" aria-hidden="true"><span /><i /></span>;
}

export default function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => initialHistory(loadAutosave()));
  const project = history.present;
  const [playhead, setPlayheadState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [masterVolume, setMasterVolume] = useState(1);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [copiedClip, setCopiedClip] = useState<Clip | null>(null);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('Media');
  const [pixelsPerSecond, setPixelsPerSecond] = useState(48);
  const [snapping, setSnapping] = useState(true);
  const [timelineHeight, setTimelineHeight] = useState(280);
  const [leftWidth, setLeftWidth] = useState(292);
  const [rightWidth, setRightWidth] = useState(286);
  const [importing, setImporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [relinkTargetId, setRelinkTargetId] = useState<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState(project.name);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const playheadRef = useRef(0);
  const toastTimeout = useRef<number | undefined>(undefined);
  const duration = projectDuration(project);
  const selectedClip = useMemo(() => project.clips.find((clip) => clip.id === selectedClipId) ?? null, [project.clips, selectedClipId]);

  const updateProject = useCallback((updater: (current: Project) => Project) => {
    dispatch({ type: 'update', updater });
  }, []);
  const previewProject = useCallback((updater: (current: Project) => Project) => {
    dispatch({ type: 'preview', updater });
  }, []);
  const beginTransaction = useCallback(() => dispatch({ type: 'begin' }), []);
  const commitTransaction = useCallback(() => dispatch({ type: 'commit' }), []);

  const seek = useCallback((time: number) => {
    const next = Math.max(0, Math.min(time, Math.max(duration, 0)));
    playheadRef.current = next;
    setPlayheadState(next);
  }, [duration]);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimeout.current) window.clearTimeout(toastTimeout.current);
    toastTimeout.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    setProjectNameDraft(project.name);
  }, [project.name]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, projectFileContents(project));
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    }, 550);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    if (!isDesktopApp()) return;
    void invoke<boolean>('check_ffmpeg').then(setFfmpegAvailable).catch(() => setFfmpegAvailable(false));
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) return;
    const missingUrls = project.assets.filter((asset) => asset.path && !asset.url && !asset.missing);
    if (!missingUrls.length) return;
    void invoke<string[]>('allow_media_paths', { paths: missingUrls.map((asset) => asset.path).filter((path): path is string => Boolean(path)) })
      .then((missingPaths) => {
        const missing = new Set(missingPaths);
        previewProject((current) => ({
          ...current,
          assets: current.assets.map((asset) => asset.path && !asset.url
            ? { ...asset, missing: missing.has(asset.path), url: missing.has(asset.path) ? '' : pathToAssetUrl(asset.path) }
            : asset),
        }));
        if (missingPaths.length) notify(`${missingPaths.length} project media ${missingPaths.length === 1 ? 'file is' : 'files are'} offline. Relink them from the media library.`);
      })
      .catch((cause) => notify(`Could not relink project media: ${cause instanceof Error ? cause.message : String(cause)}`));
  }, [project.assets, previewProject, notify]);

  useEffect(() => {
    if (!playing) return;
    const end = projectDuration(project);
    if (end <= 0) {
      setPlaying(false);
      return;
    }
    let frameId = 0;
    let previous = performance.now();
    let lastPaint = previous;
    let accumulated = 0;
    const tick = (now: number) => {
      accumulated += Math.min(0.15, (now - previous) / 1000) * playbackRate;
      previous = now;
      if (now - lastPaint >= 28) {
        lastPaint = now;
        const step = accumulated;
        accumulated = 0;
        const next = playheadRef.current + step;
        if (next >= end) {
          if (loop) {
            playheadRef.current = 0;
            setPlayheadState(0);
            previous = now;
            frameId = requestAnimationFrame(tick);
            return;
          }
          playheadRef.current = end;
          setPlayheadState(end);
          setPlaying(false);
          return;
        }
        playheadRef.current = next;
        setPlayheadState(next);
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playing, project, playbackRate, loop]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches('input, textarea, select, [contenteditable="true"]');
      const mod = event.metaKey || event.ctrlKey;
      if (typing && !(mod && ['s', 'o', 'n'].includes(event.key.toLowerCase()))) return;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveProject(false);
        return;
      }
      if (mod && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void openProject();
        return;
      }
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newProject();
        return;
      }
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (typing) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      } else if (event.key.toLowerCase() === 's' && !mod) {
        event.preventDefault();
        splitAtPlayhead();
      } else if ((event.key === 'Backspace' || event.key === 'Delete') && selectedClipId) {
        event.preventDefault();
        removeSelectedClip(false);
      } else if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelectedClip();
      } else if (mod && event.key.toLowerCase() === 'c' && selectedClip) {
        event.preventDefault();
        setCopiedClip(selectedClip);
        notify('Clip copied');
      } else if (mod && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteClip();
      } else if (mod && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        setLibraryTab('Media');
        if (isDesktopApp()) void handleImport();
        else window.setTimeout(() => document.getElementById('capnux-media-input')?.click(), 0);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        setPlaying(false);
        seek(playheadRef.current + (event.key === 'ArrowLeft' ? -1 : 1) / project.frameRate);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handleImport = async (selection?: FileList | string[]) => {
    setImporting(true);
    const assets: MediaAsset[] = [];
    try {
      let sources: (File | string)[];
      if (selection === undefined) sources = isDesktopApp() ? await chooseMediaFiles() : [];
      else if (Array.isArray(selection)) sources = selection;
      else sources = Array.from(selection);
      for (const source of sources) {
        try {
          assets.push(typeof source === 'string' ? await mediaAssetFromPath(source) : await mediaAssetFromFile(source));
        } catch (cause) {
          notify(`Could not import ${typeof source === 'string' ? source.split(/[\\/]/).pop() : source.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }
      if (assets.length) {
        updateProject((current) => assets.reduce(addAssetToProject, current));
        notify(`${assets.length} ${assets.length === 1 ? 'file' : 'files'} added to the library`);
      }
    } catch (cause) {
      notify(`Import failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setImporting(false);
    }
  };

  const applyRelink = (assetId: string, replacement: MediaAsset) => {
    const original = project.assets.find((asset) => asset.id === assetId);
    if (!original) return;
    if (replacement.kind !== original.kind) {
      notify(`Choose a ${original.kind} file to relink ${original.name}`);
      return;
    }
    updateProject((current) => ({
      ...current,
      assets: current.assets.map((asset) => asset.id === assetId ? { ...replacement, id: asset.id, missing: false } : asset),
      clips: current.clips.map((clip) => {
        if (clip.assetId !== assetId) return clip;
        const sourceLimit = Math.max(0.1, replacement.duration);
        const sourceIn = Math.min(clip.sourceIn, sourceLimit - 0.1);
        const sourceOut = Math.min(Math.max(sourceIn + 0.1, clip.sourceOut), sourceLimit);
        return { ...clip, name: replacement.name, sourceIn, sourceOut };
      }),
    }));
    setRelinkTargetId(null);
    notify(`${original.name} relinked successfully`);
  };

  const relinkAsset = async (asset: MediaAsset) => {
    setRelinkTargetId(asset.id);
    if (!isDesktopApp()) {
      document.getElementById('capnux-relink-input')?.click();
      return;
    }
    try {
      const paths = await chooseMediaFiles();
      if (!paths.length) return;
      const replacement = await mediaAssetFromPath(paths[0]);
      applyRelink(asset.id, replacement);
    } catch (cause) {
      notify(`Relink failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setRelinkTargetId(null);
    }
  };

  const handleRelinkFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const targetId = relinkTargetId;
    if (!file || !targetId) return;
    try {
      const replacement = await mediaAssetFromFile(file);
      applyRelink(targetId, replacement);
    } catch (cause) {
      notify(`Relink failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setRelinkTargetId(null);
      event.target.value = '';
    }
  };

  const addAssetToTimeline = (asset: MediaAsset, trackId?: string, start = playheadRef.current) => {
    let targetTrack = trackId ? project.tracks.find((track) => track.id === trackId) : undefined;
    const expectedKind = asset.kind === 'audio' ? 'audio' : 'video';
    if (!targetTrack || targetTrack.kind !== expectedKind) {
      targetTrack = project.tracks.find((track) => track.kind === expectedKind && !track.locked);
    }
    if (!targetTrack) {
      notify(`Add an unlocked ${expectedKind} track first`);
      return;
    }
    const clip = makeMediaClip(asset, targetTrack.id, start);
    updateProject((current) => ({ ...current, clips: [...current.clips, clip] }));
    setSelectedClipId(clip.id);
    notify(`${asset.name} added to ${targetTrack.name}`);
  };

  const addText = (text: string) => {
    let track = project.tracks.find((item) => item.kind === 'text' && !item.locked);
    if (!track) {
      addTrack('text');
      track = project.tracks.find((item) => item.kind === 'text' && !item.locked);
    }
    if (!track) return;
    const clip = makeTextClip(track.id, playheadRef.current, text);
    updateProject((current) => ({ ...current, clips: [...current.clips, clip] }));
    setSelectedClipId(clip.id);
    setLibraryTab('Text');
    notify('Text clip added at the playhead');
  };

  const addTrack = (kind: TrackKind) => {
    const siblings = project.tracks.filter((track) => track.kind === kind);
    const typeName = kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Text';
    const track = {
      id: newId(`track-${kind}`),
      name: `${typeName} ${siblings.length + 1}`,
      kind,
      locked: false,
      muted: false,
      visible: true,
      height: kind === 'video' ? 72 : 58,
    } as const;
    updateProject((current) => {
      const next = [...current.tracks];
      if (kind === 'text') {
        const lastText = next.map((item) => item.kind).lastIndexOf('text');
        next.splice(lastText + 1, 0, track);
      } else if (kind === 'video') {
        const firstVideo = next.findIndex((item) => item.kind === 'video');
        next.splice(firstVideo < 0 ? 0 : firstVideo, 0, track);
      } else {
        next.push(track);
      }
      return { ...current, tracks: next };
    });
    notify(`${track.name} created`);
  };

  const splitAtPlayhead = () => {
    const next = splitProjectAt(project, playheadRef.current);
    if (next === project) {
      notify('Place the playhead inside a clip to split it');
      return;
    }
    const rightClip = next.clips.find((clip) => Math.abs(clip.start - playheadRef.current) < 0.02);
    dispatch({ type: 'update', updater: () => next });
    if (rightClip) setSelectedClipId(rightClip.id);
    notify('Clip split at playhead');
  };

  const removeSelectedClip = (ripple = false) => {
    if (!selectedClipId) return;
    updateProject((current) => deleteClip(current, selectedClipId, ripple));
    setSelectedClipId(null);
    notify(ripple ? 'Clip removed and following clips shifted' : 'Clip deleted');
  };

  const duplicateSelectedClip = () => {
    if (!selectedClipId) return;
    const source = project.clips.find((clip) => clip.id === selectedClipId);
    if (!source) return;
    const duplicate = {
      ...source,
      id: newId('clip'),
      name: `${source.name} copy`,
      start: source.start + (source.sourceOut - source.sourceIn) / source.speed + 0.25,
    };
    updateProject((current) => ({ ...current, clips: [...current.clips, duplicate] }));
    setSelectedClipId(duplicate.id);
  };

  const copySelectedClip = () => {
    if (!selectedClip) return;
    setCopiedClip(selectedClip);
    notify('Clip copied');
  };

  const pasteClip = () => {
    if (!copiedClip) {
      notify('Copy a clip first');
      return;
    }
    const destinationTrack = project.tracks.find((track) => track.id === copiedClip.trackId && !track.locked)
      ?? project.tracks.find((track) => track.kind === (copiedClip.type === 'audio' ? 'audio' : copiedClip.type === 'text' ? 'text' : 'video') && !track.locked);
    if (!destinationTrack) {
      notify('No compatible unlocked track is available');
      return;
    }
    const pasted = { ...copiedClip, id: newId('clip'), trackId: destinationTrack.id, start: Math.max(0, playheadRef.current) };
    updateProject((current) => ({ ...current, clips: [...current.clips, pasted] }));
    setSelectedClipId(pasted.id);
  };

  const applyLook = (look: 'warm' | 'mono' | 'cinema' | 'reset') => {
    if (!selectedClip) return;
    const values = {
      warm: { brightness: 0.04, contrast: 1.08, saturation: 1.18 },
      mono: { brightness: 0, contrast: 1.08, saturation: 0 },
      cinema: { brightness: -0.035, contrast: 1.16, saturation: 0.92 },
      reset: { brightness: 0, contrast: 1, saturation: 1 },
    }[look];
    updateProject((current) => updateClip(current, selectedClip.id, values));
    notify(`${look === 'reset' ? 'Adjustments reset' : 'Color look applied'} · live preview updated`);
  };

  const saveProject = async (saveAs: boolean) => {
    setSaveStatus('saving');
    try {
      const data = projectFileContents(project);
      if (isDesktopApp()) {
        const path = !saveAs && projectPath ? projectPath : await chooseProjectToSave(project.name);
        if (!path) {
          setSaveStatus('saved');
          return;
        }
        await invoke<void>('write_project_file', { path, content: data });
        setProjectPath(path);
        notify('Project saved');
      } else {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${safeProjectName(project.name)}.capnux`;
        anchor.click();
        URL.revokeObjectURL(url);
        notify('Project file downloaded');
      }
      setSaveStatus('saved');
    } catch (cause) {
      setSaveStatus('error');
      notify(`Save failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const openProject = async () => {
    if (!isDesktopApp()) {
      document.getElementById('capnux-project-input')?.click();
      return;
    }
    try {
      const path = await chooseProjectToOpen();
      if (!path) return;
      const content = await invoke<string>('read_project_file', { path });
      dispatch({ type: 'replace', project: hydrateProject(JSON.parse(content)) });
      setProjectPath(path);
      setPlayheadState(0);
      playheadRef.current = 0;
      setSelectedClipId(null);
      setPlaying(false);
      notify('Project opened');
    } catch (cause) {
      notify(`Could not open project: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const openBrowserProject = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      dispatch({ type: 'replace', project: hydrateProject(JSON.parse(await file.text())) });
      setProjectPath(null);
      setSelectedClipId(null);
      setPlayheadState(0);
      playheadRef.current = 0;
      notify('Project opened. Relink media files if the preview is offline.');
    } catch (cause) {
      notify(`Could not open project: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    event.target.value = '';
  };

  const newProject = () => {
    if ((project.clips.length || project.assets.length) && !window.confirm('Create a new project? Save this edit as a .capnux file first if you want to keep it; the current autosave will be replaced.')) return;
    dispatch({ type: 'replace', project: createProject() });
    setProjectPath(null);
    setPlayheadState(0);
    playheadRef.current = 0;
    setSelectedClipId(null);
    setPlaying(false);
    setMenuOpen(false);
    notify('New project created');
  };

  const togglePlayback = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!duration) {
      notify('Add a clip to the timeline to start playback');
      return;
    }
    if (playheadRef.current >= duration) seek(0);
    setPlaying(true);
  };

  const onFrameStep = (direction: -1 | 1) => {
    setPlaying(false);
    seek(playheadRef.current + direction / project.frameRate);
  };

  const resizeStart = (event: React.PointerEvent<HTMLDivElement>, pane: 'left' | 'right' | 'timeline') => {
    event.preventDefault();
    const startX = event.clientX;
    const initial = pane === 'left' ? leftWidth : pane === 'right' ? rightWidth : timelineHeight;
    const move = (pointerEvent: PointerEvent) => {
      if (pane === 'left') setLeftWidth(Math.min(480, Math.max(220, initial + pointerEvent.clientX - startX)));
      if (pane === 'right') setRightWidth(Math.min(420, Math.max(230, initial - (pointerEvent.clientX - startX))));
      if (pane === 'timeline') setTimelineHeight(Math.min(520, Math.max(190, initial - (pointerEvent.clientY - event.clientY))));
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  };

  const openExport = () => {
    setExportOpen(true);
    setMenuOpen(false);
  };

  const handleLook = (look: 'warm' | 'mono' | 'cinema' | 'reset') => applyLook(look);

  return (
    <main className="app-shell" style={{
      '--left-width': `${leftWidth}px`,
      '--right-width': `${rightWidth}px`,
      '--timeline-height': `${timelineHeight}px`,
    } as React.CSSProperties}>
      <header className="app-header">
        <div className="brand-lockup"><CapNuxMark /><span>Cap<span>Nux</span></span><i className="linux-badge">LINUX</i></div>
        <div className="header-divider" />
        <div className="project-menu-wrap">
          <button className={`menu-button ${menuOpen ? 'is-open' : ''}`} onClick={() => setMenuOpen((open) => !open)}><MenuIcon size={14} /> Menu <ChevronDown size={12} /></button>
          {menuOpen && <>
            <button className="menu-backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
            <div className="app-menu-dropdown">
              <div className="menu-label">PROJECT</div>
              <button onClick={newProject}><FilePlus2 size={15} /> New project <kbd>Ctrl N</kbd></button>
              <button onClick={() => { setMenuOpen(false); void openProject(); }}><FolderOpen size={15} /> Open project <kbd>Ctrl O</kbd></button>
              <button onClick={() => { setMenuOpen(false); void saveProject(false); }}><Save size={15} /> Save project <kbd>Ctrl S</kbd></button>
              <button onClick={() => { setMenuOpen(false); void saveProject(true); }}><Save size={15} /> Save as…</button>
              <div className="menu-separator" />
              <button onClick={() => { setMenuOpen(false); setShortcutsOpen(true); }}><CircleHelp size={15} /> Keyboard shortcuts</button>
            </div>
          </>}
        </div>
        <div className="project-title-wrap">
          <input
            className="project-title-input"
            value={projectNameDraft}
            maxLength={100}
            aria-label="Project name"
            onChange={(event) => setProjectNameDraft(event.target.value)}
            onBlur={() => updateProject((current) => ({ ...current, name: safeProjectName(projectNameDraft) }))}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          />
          <button className="project-title-chevron" onClick={() => setLibraryTab('Media')} title="Project library"><ChevronDown size={13} /></button>
        </div>
        <div className="autosave-status"><span className={`autosave-dot ${saveStatus}`} />{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Autosave issue' : 'Autosaved'}</div>
        <div className="header-spacer" />
        <button className="header-undo" disabled={!canUndo(history)} title="Undo (Ctrl Z)" onClick={() => dispatch({ type: 'undo' })}><Undo2 size={15} /></button>
        <button className="header-undo" disabled={!canRedo(history)} title="Redo (Ctrl Shift Z)" onClick={() => dispatch({ type: 'redo' })}><Redo2 size={15} /></button>
        <span className="header-divider slim" />
        <button className="header-shortcuts" onClick={() => setShortcutsOpen(true)}><CircleHelp size={14} /><span>Shortcuts</span></button>
        <button className="export-button" onClick={openExport}><ArrowDownToLine size={15} /> Export</button>
        <input id="capnux-project-input" className="visually-hidden" type="file" accept=".capnux,.json,application/json" onChange={(event) => void openBrowserProject(event)} />
        <input id="capnux-relink-input" className="visually-hidden" type="file" accept="video/*,audio/*,image/*,.mkv,.mov,.webm,.flac,.opus" onChange={(event) => void handleRelinkFile(event)} />
      </header>

      <div className="workspace" style={{ gridTemplateColumns: 'var(--left-width) 5px minmax(320px, 1fr) 5px var(--right-width)' }}>
        <MediaLibrary
          project={project}
          selectedClip={selectedClip}
          tab={libraryTab}
          onTabChange={setLibraryTab}
          onImport={(files) => void handleImport(files)}
          onImportClick={() => {
            if (isDesktopApp()) void handleImport();
            else document.getElementById('capnux-media-input')?.click();
          }}
          onAddToTimeline={(asset) => addAssetToTimeline(asset)}
          onRelink={(asset) => void relinkAsset(asset)}
          onAddText={addText}
          onApplyLook={handleLook}
          importing={importing}
        />
        <div className="pane-splitter vertical" onPointerDown={(event) => resizeStart(event, 'left')} title="Drag to resize library" />
        <Preview
          project={project}
          playhead={playhead}
          playing={playing}
          loop={loop}
          playbackRate={playbackRate}
          masterVolume={masterVolume}
          selectedClipId={selectedClipId}
          onPlayPause={togglePlayback}
          onFrameStep={onFrameStep}
          onSetLoop={() => setLoop((value) => !value)}
          onPlaybackRate={setPlaybackRate}
          onMasterVolume={setMasterVolume}
          onSeek={seek}
          onSelectClip={setSelectedClipId}
          onBeginTransaction={beginTransaction}
          onPreviewProject={previewProject}
          onCommitTransaction={commitTransaction}
        />
        <div className="pane-splitter vertical" onPointerDown={(event) => resizeStart(event, 'right')} title="Drag to resize inspector" />
        <Inspector
          project={project}
          clip={selectedClip}
          onUpdateProject={updateProject}
          onBeginTransaction={beginTransaction}
          onPreviewProject={previewProject}
          onCommitTransaction={commitTransaction}
        />
      </div>
      <div className="pane-splitter horizontal" onPointerDown={(event) => resizeStart(event, 'timeline')} title="Drag to resize timeline" />
      <Timeline
        project={project}
        playhead={playhead}
        selectedClipId={selectedClipId}
        pixelsPerSecond={pixelsPerSecond}
        setPixelsPerSecond={setPixelsPerSecond}
        snapping={snapping}
        setSnapping={setSnapping}
        onSeek={seek}
        onSelectClip={setSelectedClipId}
        onBeginTransaction={beginTransaction}
        onPreviewProject={previewProject}
        onCommitTransaction={commitTransaction}
        onUpdateProject={updateProject}
        onSplit={splitAtPlayhead}
        onDelete={removeSelectedClip}
        onDuplicate={duplicateSelectedClip}
        onCopy={copySelectedClip}
        onPaste={pasteClip}
        onAddAsset={addAssetToTimeline}
        onAddTrack={addTrack}
        fps={project.frameRate}
      />

      <footer className="status-bar">
        <span><Cloud size={13} /> {saveStatus === 'error' ? 'Autosave unavailable' : 'Project autosaved locally'}</span>
        <span className="status-separator" />
        <span>{project.width} × {project.height} · {project.frameRate} fps</span>
        <span className="status-spacer" />
        <span>{project.assets.length} media · {project.clips.length} clips · {formatDuration(duration)}</span>
        <span className={`status-engine ${ffmpegAvailable ? 'ready' : ''}`}><i />{isDesktopApp() ? (ffmpegAvailable === false ? 'FFmpeg missing' : ffmpegAvailable ? 'FFmpeg ready' : 'Engine check…') : 'Browser preview'}</span>
      </footer>

      {toast && <div className="toast-message"><Check size={15} />{toast}</div>}
      {exportOpen && <ExportModal project={project} ffmpegAvailable={ffmpegAvailable} onClose={() => setExportOpen(false)} />}
      {shortcutsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShortcutsOpen(false); }}>
        <div className="shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
          <div className="modal-heading"><div className="modal-title-icon"><CircleHelp size={18} /></div><div><span className="eyebrow">WORK FASTER</span><h2 id="shortcuts-title">Keyboard shortcuts</h2></div><button className="icon-button subtle" onClick={() => setShortcutsOpen(false)}><X size={17} /></button></div>
          <div className="shortcuts-list">
            {[["Play / Pause", "Space"], ["Split at playhead", "S"], ["Undo", "Ctrl  Z"], ["Redo", "Ctrl  Shift  Z"], ["Copy / Paste", "Ctrl  C / V"], ["Duplicate clip", "Ctrl  D"], ["Delete selected", "Delete"], ["Save project", "Ctrl  S"], ["Import media", "Ctrl  I"], ["Frame step", "←  /  →"]].map(([label, keys]) => <div key={label}><span>{label}</span><kbd>{keys}</kbd></div>)}
          </div>
          <div className="modal-footer"><span className="shortcuts-footer-note">Linux / Windows keyboard layout</span><button className="secondary-button" onClick={() => setShortcutsOpen(false)}>Close</button></div>
        </div>
      </div>}
    </main>
  );
}
