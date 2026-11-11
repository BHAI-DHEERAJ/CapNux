import { useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  ChevronDown,
  Eye,
  EyeOff,
  Headphones,
  Lock,
  Magnet,
  Minus,
  MoreHorizontal,
  Plus,
  Scissors,
  Trash2,
  Unlock,
  Video,
  Volume2,
  VolumeX,
  ZoomIn,
} from 'lucide-react';
import type { Clip, MediaAsset, Project, Track, TrackKind } from '../domain/project';
import { clipDuration, clipEnd, formatTimecode, snapTime } from '../domain/project';

interface TimelineProps {
  project: Project;
  playhead: number;
  selectedClipId: string | null;
  pixelsPerSecond: number;
  setPixelsPerSecond: (value: number) => void;
  snapping: boolean;
  setSnapping: (value: boolean) => void;
  onSeek: (time: number) => void;
  onSelectClip: (clipId: string | null) => void;
  onBeginTransaction: () => void;
  onPreviewProject: (updater: (project: Project) => Project) => void;
  onCommitTransaction: () => void;
  onUpdateProject: (updater: (project: Project) => Project) => void;
  onSplit: () => void;
  onDelete: (ripple?: boolean) => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onAddAsset: (asset: MediaAsset, trackId: string, start: number) => void;
  onAddTrack: (kind: TrackKind) => void;
  fps: number;
}

interface ClipGesture {
  clip: Clip;
  mode: 'move' | 'left' | 'right';
  startX: number;
  startY: number;
}

function waveformPath(waveform: number[]): string {
  if (!waveform.length) return '';
  const count = Math.min(180, waveform.length);
  const points: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const sourceIndex = Math.floor((index / Math.max(1, count - 1)) * (waveform.length - 1));
    const amplitude = Math.max(0.05, Math.min(1, waveform[sourceIndex]));
    const y = 22 - amplitude * 18;
    points.push(`${(index / Math.max(1, count - 1)) * 100},${y.toFixed(1)}`);
  }
  const lower = points.slice().reverse().map((point) => {
    const [x, y] = point.split(',').map(Number);
    return `${x},${44 - y}`;
  });
  return `M ${points.join(' L ')} L ${lower.join(' L ')} Z`;
}

function ClipCard({
  clip,
  asset,
  track,
  project,
  selected,
  pixelsPerSecond,
  onSelect,
  onGesture,
  onMenu,
}: {
  clip: Clip;
  asset?: MediaAsset;
  track: Track;
  project: Project;
  selected: boolean;
  pixelsPerSecond: number;
  onSelect: () => void;
  onGesture: (event: React.PointerEvent<HTMLElement>, clip: Clip, mode: ClipGesture['mode']) => void;
  onMenu: (event: React.MouseEvent<HTMLDivElement>, clip: Clip) => void;
}) {
  const duration = clipDuration(clip);
  const width = Math.max(24, duration * pixelsPerSecond);
  const videoLike = clip.type === 'video' || clip.type === 'image';
  const audioLike = clip.type === 'audio';
  const canEdit = !track.locked;
  return (
    <div
      className={`timeline-clip clip-${clip.type} ${selected ? 'selected' : ''} ${track.locked ? 'track-locked' : ''}`}
      style={{ left: clip.start * pixelsPerSecond, width }}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onPointerDown={(event) => onGesture(event, clip, 'move')}
      onContextMenu={(event) => onMenu(event, clip)}
      title={`${clip.name} · ${formatTimecode(clip.start, project.frameRate)} – ${formatTimecode(clipEnd(clip), project.frameRate)}`}
      role="button"
      tabIndex={0}
      aria-label={`${clip.name}, ${formatTimecode(duration, project.frameRate)} long`}
    >
      {canEdit && selected && <button className="trim-handle trim-left" title="Trim start" onPointerDown={(event) => { event.stopPropagation(); onGesture(event, clip, 'left'); }} />}
      {videoLike && asset?.thumbnails.length ? (
        <div className="clip-filmstrip" aria-hidden="true">
          {asset.thumbnails.map((src, index) => <img key={`${clip.id}-thumb-${index}`} src={src} alt="" />)}
          <div className="clip-filmstrip-shade" />
        </div>
      ) : null}
      {audioLike && asset?.waveform.length ? (
        <svg className="clip-waveform" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
          <path d={waveformPath(asset.waveform)} />
        </svg>
      ) : null}
      {videoLike && asset?.waveform.length && <svg className="clip-audio-waveform" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true"><path d={waveformPath(asset.waveform)} /></svg>}
      <div className="clip-label-row">
        <span className="clip-kind-icon">{clip.type === 'text' ? 'T' : clip.type === 'audio' ? <AudioLines size={11} /> : <Video size={11} />}</span>
        <span className="clip-name">{clip.type === 'text' ? clip.text || 'Text overlay' : clip.name}</span>
      </div>
      {width > 70 && <span className="clip-duration-label">{formatTimecode(duration, project.frameRate)}</span>}
      {canEdit && selected && <button className="trim-handle trim-right" title="Trim end" onPointerDown={(event) => { event.stopPropagation(); onGesture(event, clip, 'right'); }} />}
      <span className="clip-edge-highlight" />
    </div>
  );
}

function TrackLabel({
  track,
  onToggle,
  onResize,
}: {
  track: Track;
  onToggle: (key: 'locked' | 'muted' | 'visible') => void;
  onResize: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const Icon = track.kind === 'audio' ? Headphones : track.kind === 'text' ? null : Video;
  return (
    <div className={`track-label track-${track.kind}`} style={{ height: track.height }}>
      <div className="track-type-icon">{Icon ? <Icon size={14} /> : <span>T</span>}</div>
      <div className="track-name-block"><b>{track.name}</b><span>{track.kind === 'video' ? 'VIDEO' : track.kind === 'audio' ? 'AUDIO' : 'TITLES'}</span></div>
      <div className="track-actions">
        {track.kind !== 'text' && <button onClick={() => onToggle(track.kind === 'audio' ? 'muted' : 'visible')} title={track.kind === 'audio' ? (track.muted ? 'Unmute track' : 'Mute track') : (track.visible ? 'Hide track' : 'Show track')}>
          {track.kind === 'audio' ? (track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />) : (track.visible ? <Eye size={13} /> : <EyeOff size={13} />)}
        </button>}
        <button onClick={() => onToggle('locked')} title={track.locked ? 'Unlock track' : 'Lock track'}>{track.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>
      </div>
      <div className="track-resize-grip" onPointerDown={onResize} title="Drag to resize track" />
    </div>
  );
}

export function Timeline({
  project,
  playhead,
  selectedClipId,
  pixelsPerSecond,
  setPixelsPerSecond,
  snapping,
  setSnapping,
  onSeek,
  onSelectClip,
  onBeginTransaction,
  onPreviewProject,
  onCommitTransaction,
  onUpdateProject,
  onSplit,
  onDelete,
  onDuplicate,
  onCopy,
  onPaste,
  onAddAsset,
  onAddTrack,
  fps,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const labelsScrollRef = useRef<HTMLDivElement>(null);
  const [addTrackOpen, setAddTrackOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; clipId: string } | null>(null);
  const contentWidth = Math.max(1500, (Math.max(60, project.clips.reduce((value, clip) => Math.max(value, clipEnd(clip)), 0) + 20)) * pixelsPerSecond);
  const majorTick = pixelsPerSecond >= 75 ? 1 : pixelsPerSecond >= 34 ? 5 : 10;
  const ticks = useMemo(() => {
    const count = Math.ceil(contentWidth / (majorTick * pixelsPerSecond));
    return Array.from({ length: count + 1 }, (_, index) => index * majorTick).filter((time) => time * pixelsPerSecond <= contentWidth);
  }, [contentWidth, majorTick, pixelsPerSecond]);

  const seekFromPointer = (event: React.PointerEvent | React.MouseEvent) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const bounds = scroller.getBoundingClientRect();
    const rawTime = (event.clientX - bounds.left + scroller.scrollLeft) / pixelsPerSecond;
    onSeek(snapping ? snapTime(rawTime, project.clips, undefined, 0.12) : Math.max(0, rawTime));
  };

  const onClipGesture = (event: React.PointerEvent<HTMLElement>, clip: Clip, mode: ClipGesture['mode']) => {
    event.preventDefault();
    event.stopPropagation();
    const track = project.tracks.find((item) => item.id === clip.trackId);
    onSelectClip(clip.id);
    if (track?.locked) return;
    onBeginTransaction();
    const gesture: ClipGesture = { clip, mode, startX: event.clientX, startY: event.clientY };
    const original = clip;
    const move = (pointerEvent: PointerEvent) => {
      const deltaPixels = pointerEvent.clientX - gesture.startX;
      if (mode === 'move' && Math.abs(deltaPixels) <= 1 && Math.abs(pointerEvent.clientY - gesture.startY) <= 2) return;
      if (mode !== 'move' && Math.abs(deltaPixels) <= 1) return;
      const deltaSeconds = deltaPixels / pixelsPerSecond;
      if (mode === 'move') {
        let nextStart = Math.max(0, original.start + deltaSeconds);
        if (snapping) nextStart = snapTime(nextStart, project.clips, original.id, 0.16);
        const target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest<HTMLElement>('[data-track-id]');
        const targetTrack = target?.dataset.trackId;
        onPreviewProject((current) => ({
          ...current,
          clips: current.clips.map((item) => item.id === original.id ? {
            ...item,
            start: nextStart,
            trackId: targetTrack && current.tracks.some((candidate) => candidate.id === targetTrack && candidate.kind === item.type.replace('image', 'video'))
              ? targetTrack
              : item.trackId,
          } : item),
        }));
      } else if (mode === 'left') {
        const nextSourceIn = Math.min(original.sourceOut - 0.1, Math.max(0, original.sourceIn + deltaSeconds * original.speed));
        const nextStart = Math.max(0, original.start + (nextSourceIn - original.sourceIn) / original.speed);
        const sourceIn = original.sourceIn + (nextStart - original.start) * original.speed;
        onPreviewProject((current) => ({
          ...current,
          clips: current.clips.map((item) => item.id === original.id ? { ...item, start: nextStart, sourceIn } : item),
        }));
      } else {
        const asset = project.assets.find((item) => item.id === original.assetId);
        const sourceLimit = original.type === 'text' ? Number.POSITIVE_INFINITY : (asset?.duration ?? original.sourceOut);
        const sourceOut = Math.max(original.sourceIn + 0.1, Math.min(sourceLimit, original.sourceOut + deltaSeconds * original.speed));
        onPreviewProject((current) => ({
          ...current,
          clips: current.clips.map((item) => item.id === original.id ? { ...item, sourceOut } : item),
        }));
      }
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      onCommitTransaction();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  };

  const seekDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const seek = (pointerEvent: PointerEvent) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const bounds = scroller.getBoundingClientRect();
      const time = (pointerEvent.clientX - bounds.left + scroller.scrollLeft) / pixelsPerSecond;
      onSeek(snapping ? snapTime(time, project.clips, undefined, 0.12) : Math.max(0, time));
    };
    seek(event.nativeEvent);
    const move = (pointerEvent: PointerEvent) => seek(pointerEvent);
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  };

  const toggleTrack = (trackId: string, key: 'locked' | 'muted' | 'visible') => {
    onUpdateProject((current) => ({
      ...current,
      tracks: current.tracks.map((track) => track.id === trackId ? { ...track, [key]: !track[key] } : track),
    }));
  };

  const resizeTrack = (event: React.PointerEvent<HTMLDivElement>, track: Track) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const initialHeight = track.height;
    onBeginTransaction();
    const move = (pointerEvent: PointerEvent) => {
      const height = Math.min(180, Math.max(44, initialHeight + pointerEvent.clientY - startY));
      onPreviewProject((current) => ({
        ...current,
        tracks: current.tracks.map((item) => item.id === track.id ? { ...item, height } : item),
      }));
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      onCommitTransaction();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>, track: Track) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('application/x-capnux-asset') || event.dataTransfer.getData('text/plain');
    const asset = project.assets.find((item) => item.id === id);
    if (!asset) return;
    const bounds = scrollRef.current?.getBoundingClientRect();
    if (!bounds) return;
    let start = (event.clientX - bounds.left + (scrollRef.current?.scrollLeft ?? 0)) / pixelsPerSecond;
    if (snapping) start = snapTime(start, project.clips, undefined, 0.14);
    onAddAsset(asset, track.id, start);
  };

  const openClipMenu = (event: React.MouseEvent<HTMLDivElement>, clip: Clip) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectClip(clip.id);
    setContextMenu({ x: event.clientX, y: event.clientY, clipId: clip.id });
  };

  const addTrack = (kind: TrackKind) => {
    onAddTrack(kind);
    setAddTrackOpen(false);
  };

  return (
    <section className="timeline-panel">
      <div className="timeline-toolbar">
        <div className="timeline-tool-group">
          <button className="icon-button timeline-tool" title="Split at playhead (S)" onClick={onSplit}><Scissors size={15} /></button>
          <button className="icon-button timeline-tool" title="Delete selected clip" onClick={() => onDelete(false)} disabled={!selectedClipId}><Trash2 size={15} /></button>
          <span className="toolbar-divider" />
          <button className={`icon-button timeline-tool snap-toggle ${snapping ? 'is-active' : ''}`} title={snapping ? 'Disable snapping' : 'Enable snapping'} onClick={() => setSnapping(!snapping)}><Magnet size={15} /></button>
          <button className="tool-text" onClick={onCopy} disabled={!selectedClipId} title="Copy selected clip">Copy</button>
          <button className="tool-text" onClick={onPaste} title="Paste clip at playhead">Paste</button>
        </div>
        <div className="timeline-tool-group">
          <span className="timeline-timecode">{formatTimecode(playhead, fps)}</span>
          <div className="add-track-wrap">
            <button className="add-track-button" onClick={() => setAddTrackOpen((value) => !value)}><Plus size={14} /> Track <ChevronDown size={12} /></button>
            {addTrackOpen && <div className="track-add-menu">
              <button onClick={() => addTrack('video')}><Video size={14} /> Video track</button>
              <button onClick={() => addTrack('audio')}><AudioLines size={14} /> Audio track</button>
              <button onClick={() => addTrack('text')}><span className="menu-text-icon">T</span> Text track</button>
            </div>}
          </div>
          <span className="toolbar-divider" />
          <button className="icon-button timeline-tool" title="Zoom out" onClick={() => setPixelsPerSecond(Math.max(16, pixelsPerSecond - 8))}><Minus size={15} /></button>
          <input className="zoom-slider" type="range" min="16" max="140" value={pixelsPerSecond} onChange={(event) => setPixelsPerSecond(Number(event.target.value))} aria-label="Timeline zoom" />
          <button className="icon-button timeline-tool" title="Zoom in" onClick={() => setPixelsPerSecond(Math.min(140, pixelsPerSecond + 8))}><ZoomIn size={15} /></button>
          <span className="zoom-readout">{Math.round((pixelsPerSecond / 48) * 100)}%</span>
        </div>
      </div>

      <div className="timeline-body">
        <div className="track-label-column">
          <div className="ruler-gutter"><MoreHorizontal size={15} /><span>TRACKS</span></div>
          <div className="track-labels-scroll" ref={labelsScrollRef}>
            {project.tracks.map((track) => <TrackLabel key={track.id} track={track} onToggle={(key) => toggleTrack(track.id, key)} onResize={(event) => resizeTrack(event, track)} />)}
          </div>
          <div className="timeline-footer-gutter"><span>CAPNUX EDITOR</span><i /></div>
        </div>
        <div className="timeline-scroll" ref={scrollRef} onScroll={(event) => { if (labelsScrollRef.current) labelsScrollRef.current.scrollTop = event.currentTarget.scrollTop; }}>
          <div className="timeline-content" style={{ width: contentWidth }}>
            <div className="timeline-ruler" style={{ width: contentWidth }} onClick={seekFromPointer}>
              {ticks.map((time) => <div className="ruler-tick" key={time} style={{ left: time * pixelsPerSecond }}><span>{time === 0 ? '00:00' : formatTimecode(time, fps).slice(3, 8)}</span><i /></div>)}
              <div className="playhead-cap" style={{ left: playhead * pixelsPerSecond }}>
                <button aria-label="Drag playhead" title="Drag playhead" onPointerDown={seekDrag} />
              </div>
            </div>
            {project.tracks.map((track) => (
              <div
                className={`timeline-lane lane-${track.kind} ${track.locked ? 'lane-locked' : ''}`}
                key={track.id}
                data-track-id={track.id}
                style={{ width: contentWidth, height: track.height }}
                onClick={seekFromPointer}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(event) => handleDrop(event, track)}
              >
                <div className="lane-grid" style={{ backgroundSize: `${pixelsPerSecond * majorTick}px 100%` }} />
                {project.clips.filter((clip) => clip.trackId === track.id).map((clip) => (
                  <ClipCard
                    key={clip.id}
                    clip={clip}
                    asset={project.assets.find((item) => item.id === clip.assetId)}
                    track={track}
                    project={project}
                    selected={selectedClipId === clip.id}
                    pixelsPerSecond={pixelsPerSecond}
                    onSelect={() => onSelectClip(clip.id)}
                    onGesture={onClipGesture}
                    onMenu={openClipMenu}
                  />
                ))}
              </div>
            ))}
            <div className="timeline-bottom-pad" style={{ width: contentWidth }} onClick={seekFromPointer}>
              <span>Drag clips here to arrange your edit</span>
            </div>
            <div className="playhead-line" style={{ left: playhead * pixelsPerSecond }} aria-hidden="true"><i /></div>
          </div>
        </div>
      </div>
      {contextMenu && (
        <>
          <button className="menu-dismiss" aria-label="Close clip menu" onClick={() => setContextMenu(null)} />
          <div className="clip-context-menu" style={{ left: Math.min(contextMenu.x, window.innerWidth - 210), top: Math.min(contextMenu.y, window.innerHeight - 190) }}>
            <button onClick={() => { onCopy(); setContextMenu(null); }}>Copy clip <kbd>Ctrl C</kbd></button>
            <button onClick={() => { onDuplicate(); setContextMenu(null); }}>Duplicate <kbd>Ctrl D</kbd></button>
            <button onClick={() => { onDelete(true); setContextMenu(null); }}>Ripple delete</button>
            <button className="danger-menu-item" onClick={() => { onDelete(false); setContextMenu(null); }}><Trash2 size={13} /> Delete clip <kbd>Del</kbd></button>
          </div>
        </>
      )}
      <button className="sr-only" onClick={onDuplicate}>Duplicate selected clip</button>
    </section>
  );
}
