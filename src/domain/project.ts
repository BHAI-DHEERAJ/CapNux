export type MediaKind = 'video' | 'audio' | 'image';
export type ClipKind = MediaKind | 'text';
export type TrackKind = 'video' | 'audio' | 'text';

export interface MediaAsset {
  id: string;
  name: string;
  path: string | null;
  url: string;
  kind: MediaKind;
  mime: string;
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
  size: number;
  thumbnails: string[];
  waveform: number[];
  missing?: boolean;
}

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  locked: boolean;
  muted: boolean;
  visible: boolean;
  height: number;
}

export interface Clip {
  id: string;
  assetId: string | null;
  trackId: string;
  type: ClipKind;
  name: string;
  start: number;
  sourceIn: number;
  sourceOut: number;
  speed: number;
  volume: number;
  opacity: number;
  scale: number;
  rotation: number;
  positionX: number;
  positionY: number;
  brightness: number;
  contrast: number;
  saturation: number;
  fadeIn: number;
  fadeOut: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  align: 'left' | 'center' | 'right';
}

export interface Project {
  formatVersion: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  assets: MediaAsset[];
  tracks: Track[];
  clips: Clip[];
  updatedAt: string;
}

export interface HistoryState {
  past: Project[];
  present: Project;
  future: Project[];
  transactionBase: Project | null;
}

export type HistoryAction =
  | { type: 'update'; updater: (project: Project) => Project }
  | { type: 'begin' }
  | { type: 'preview'; updater: (project: Project) => Project }
  | { type: 'commit' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'replace'; project: Project };

export const DEFAULT_PROJECT_NAME = 'Untitled project';
const HISTORY_LIMIT = 80;

function makeId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`;
}

export function createProject(name = DEFAULT_PROJECT_NAME): Project {
  const now = new Date().toISOString();
  return {
    formatVersion: 1,
    id: makeId('project'),
    name,
    width: 1920,
    height: 1080,
    frameRate: 30,
    assets: [],
    tracks: [
      { id: 'track-text-1', name: 'Text 1', kind: 'text', locked: false, muted: false, visible: true, height: 58 },
      { id: 'track-video-2', name: 'Video 2', kind: 'video', locked: false, muted: false, visible: true, height: 72 },
      { id: 'track-video-1', name: 'Video 1', kind: 'video', locked: false, muted: false, visible: true, height: 72 },
      { id: 'track-audio-1', name: 'Audio 1', kind: 'audio', locked: false, muted: false, visible: true, height: 58 },
    ],
    clips: [],
    updatedAt: now,
  };
}

export function initialHistory(project: Project): HistoryState {
  return { past: [], present: project, future: [], transactionBase: null };
}

function pushHistory(state: HistoryState, before: Project, next: Project): HistoryState {
  if (next === before) return state;
  return {
    past: [...state.past, before].slice(-HISTORY_LIMIT),
    present: { ...next, updatedAt: new Date().toISOString() },
    future: [],
    transactionBase: null,
  };
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'update': {
      const next = action.updater(state.present);
      return pushHistory(state, state.present, next);
    }
    case 'begin':
      return state.transactionBase ? state : { ...state, transactionBase: state.present };
    case 'preview': {
      const next = action.updater(state.present);
      return next === state.present ? state : { ...state, present: next };
    }
    case 'commit': {
      const base = state.transactionBase;
      if (!base || base === state.present) return { ...state, transactionBase: null };
      return {
        past: [...state.past, base].slice(-HISTORY_LIMIT),
        present: { ...state.present, updatedAt: new Date().toISOString() },
        future: [],
        transactionBase: null,
      };
    }
    case 'undo': {
      if (state.transactionBase) return { ...state, present: state.transactionBase, transactionBase: null };
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        transactionBase: null,
      };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const next = state.future[0];
      return {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: next,
        future: state.future.slice(1),
        transactionBase: null,
      };
    }
    case 'replace':
      return initialHistory(action.project);
    default:
      return state;
  }
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0 || state.transactionBase !== null;
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0;
}

export function clipDuration(clip: Clip): number {
  const sourceDuration = Math.max(0, clip.sourceOut - clip.sourceIn);
  return clip.type === 'text' ? sourceDuration : sourceDuration / Math.max(0.25, clip.speed);
}

export function clipEnd(clip: Clip): number {
  return clip.start + clipDuration(clip);
}

export function projectDuration(project: Project): number {
  return Math.max(0, ...project.clips.map(clipEnd));
}

export function makeMediaClip(asset: MediaAsset, trackId: string, start: number): Clip {
  return {
    id: makeId('clip'),
    assetId: asset.id,
    trackId,
    type: asset.kind,
    name: asset.name,
    start: Math.max(0, start),
    sourceIn: 0,
    sourceOut: Math.max(0.25, asset.duration || 5),
    speed: 1,
    volume: 1,
    opacity: 1,
    scale: 1,
    rotation: 0,
    positionX: 0,
    positionY: 0,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    fadeIn: 0,
    fadeOut: 0,
    text: '',
    fontSize: 72,
    fontFamily: 'Inter, sans-serif',
    color: '#ffffff',
    align: 'center',
  };
}

export function makeTextClip(trackId: string, start: number, text = 'Your title'): Clip {
  return {
    id: makeId('clip'),
    assetId: null,
    trackId,
    type: 'text',
    name: 'Text overlay',
    start: Math.max(0, start),
    sourceIn: 0,
    sourceOut: 4,
    speed: 1,
    volume: 1,
    opacity: 1,
    scale: 1,
    rotation: 0,
    positionX: 0,
    positionY: 0,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    fadeIn: 0,
    fadeOut: 0,
    text,
    fontSize: 72,
    fontFamily: 'Inter, sans-serif',
    color: '#ffffff',
    align: 'center',
  };
}

export function snapTime(time: number, clips: Clip[], excludeId?: string, threshold = 0.14): number {
  let closest = time;
  let distance = threshold;
  for (const clip of clips) {
    if (clip.id === excludeId) continue;
    for (const edge of [clip.start, clipEnd(clip)]) {
      const nextDistance = Math.abs(edge - time);
      if (nextDistance < distance) {
        distance = nextDistance;
        closest = edge;
      }
    }
  }
  return Math.max(0, closest);
}

export function splitProjectAt(project: Project, time: number): Project {
  const nextClips: Clip[] = [];
  let changed = false;
  for (const clip of project.clips) {
    const end = clipEnd(clip);
    if (clip.type === 'text' || time <= clip.start + 0.02 || time >= end - 0.02) {
      nextClips.push(clip);
      continue;
    }
    const elapsed = time - clip.start;
    const sourceSplit = clip.sourceIn + elapsed * clip.speed;
    if (sourceSplit <= clip.sourceIn || sourceSplit >= clip.sourceOut) {
      nextClips.push(clip);
      continue;
    }
    nextClips.push({ ...clip, sourceOut: sourceSplit });
    nextClips.push({ ...clip, id: makeId('clip'), start: time, sourceIn: sourceSplit });
    changed = true;
  }
  return changed ? { ...project, clips: nextClips } : project;
}

export function duplicateClip(project: Project, clipId: string, gap = 0.25): Project {
  const source = project.clips.find((clip) => clip.id === clipId);
  if (!source) return project;
  const copy = { ...source, id: makeId('clip'), name: `${source.name} copy`, start: clipEnd(source) + gap };
  return { ...project, clips: [...project.clips, copy] };
}

export function deleteClip(project: Project, clipId: string, ripple = false): Project {
  const target = project.clips.find((clip) => clip.id === clipId);
  if (!target) return project;
  const duration = clipDuration(target);
  return {
    ...project,
    clips: project.clips
      .filter((clip) => clip.id !== clipId)
      .map((clip) => {
        if (ripple && clip.trackId === target.trackId && clip.start >= clipEnd(target)) {
          return { ...clip, start: Math.max(0, clip.start - duration) };
        }
        return clip;
      }),
  };
}

export function addAssetToProject(project: Project, asset: MediaAsset): Project {
  if (project.assets.some((item) => item.id === asset.id)) return project;
  return { ...project, assets: [...project.assets, asset] };
}

export function safeProjectName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 100) || DEFAULT_PROJECT_NAME;
}

export function formatTimecode(seconds: number, fps: number): string {
  const safe = Math.max(0, seconds);
  const wholeSeconds = Math.floor(safe);
  const frame = Math.floor((safe - wholeSeconds) * fps + 0.0001);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;
  return [hours, minutes, secs, frame]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours > 0 ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
