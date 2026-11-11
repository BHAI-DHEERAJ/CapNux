import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Maximize, Pause, Play, Repeat2, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import type { Clip, Project, Track } from '../domain/project';
import { clipEnd, formatTimecode, projectDuration } from '../domain/project';

interface PreviewProps {
  project: Project;
  playhead: number;
  playing: boolean;
  loop: boolean;
  playbackRate: number;
  masterVolume: number;
  selectedClipId: string | null;
  onPlayPause: () => void;
  onFrameStep: (direction: -1 | 1) => void;
  onSetLoop: () => void;
  onPlaybackRate: (rate: number) => void;
  onMasterVolume: (volume: number) => void;
  onSeek: (time: number) => void;
  onSelectClip: (clipId: string) => void;
  onBeginTransaction: () => void;
  onPreviewProject: (updater: (project: Project) => Project) => void;
  onCommitTransaction: () => void;
}

function fadeGain(clip: Clip, playhead: number): number {
  const elapsed = Math.max(0, playhead - clip.start);
  const remaining = Math.max(0, clipEnd(clip) - playhead);
  let gain = 1;
  if (clip.fadeIn > 0) gain = Math.min(gain, elapsed / clip.fadeIn);
  if (clip.fadeOut > 0) gain = Math.min(gain, remaining / clip.fadeOut);
  return Math.max(0, Math.min(1, gain));
}

function VideoLayer({
  clip,
  track,
  project,
  playhead,
  playing,
  playbackRate,
  masterVolume,
  zIndex,
  onSelect,
}: {
  clip: Clip;
  track: Track;
  project: Project;
  playhead: number;
  playing: boolean;
  playbackRate: number;
  masterVolume: number;
  zIndex: number;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const asset = project.assets.find((item) => item.id === clip.assetId);
  const currentSourceTime = clip.sourceIn + Math.max(0, playhead - clip.start) * clip.speed;

  useEffect(() => {
    const video = ref.current;
    if (!video || !asset?.url) return;
    video.src = asset.url;
    video.load();
    const seekWhenReady = () => {
      try { video.currentTime = currentSourceTime; } catch { /* metadata can arrive before the media is seekable */ }
      if (playing) void video.play().catch(() => undefined);
    };
    video.addEventListener('loadedmetadata', seekWhenReady, { once: true });
    return () => {
      video.removeEventListener('loadedmetadata', seekWhenReady);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
    // A new element is keyed by clip id; only media-source changes should reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.url, clip.id]);

  useEffect(() => {
    const video = ref.current;
    if (!video || !asset?.url || video.readyState < 1) return;
    const target = Math.min(clip.sourceOut, Math.max(clip.sourceIn, currentSourceTime));
    const drift = Math.abs(video.currentTime - target);
    if (!playing || drift > 0.3) {
      try { video.currentTime = target; } catch { /* the browser will catch up on its next seekable range */ }
    }
    video.playbackRate = Math.max(0.25, Math.min(4, clip.speed * playbackRate));
    video.volume = Math.max(0, Math.min(1, clip.volume * fadeGain(clip, playhead) * masterVolume));
    video.muted = track.muted;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [asset?.url, clip.sourceIn, clip.sourceOut, clip.speed, clip.volume, clip.fadeIn, clip.fadeOut, clip.start, currentSourceTime, playhead, playing, playbackRate, masterVolume, track.muted]);

  if (!asset?.url) return null;
  return (
    <video
      ref={ref}
      className="preview-media"
      playsInline
      preload="auto"
      onClick={onSelect}
      style={{
        zIndex,
        opacity: clip.opacity,
        left: `calc(50% + ${clip.positionX}%)`,
        top: `calc(50% + ${clip.positionY}%)`,
        transform: `translate(-50%, -50%) scale(${clip.scale}) rotate(${clip.rotation}deg)`,
        filter: `brightness(${Math.max(0, 1 + clip.brightness)}) contrast(${clip.contrast}) saturate(${clip.saturation})`,
      }}
      aria-label={`Preview ${clip.name}`}
    />
  );
}

function ImageLayer({ clip, project, zIndex, onSelect }: { clip: Clip; project: Project; zIndex: number; onSelect: () => void }) {
  const asset = project.assets.find((item) => item.id === clip.assetId);
  if (!asset?.url) return null;
  return (
    <img
      className="preview-media"
      src={asset.url}
      alt=""
      onClick={onSelect}
      style={{
        zIndex,
        opacity: clip.opacity,
        left: `calc(50% + ${clip.positionX}%)`,
        top: `calc(50% + ${clip.positionY}%)`,
        transform: `translate(-50%, -50%) scale(${clip.scale}) rotate(${clip.rotation}deg)`,
        filter: `brightness(${Math.max(0, 1 + clip.brightness)}) contrast(${clip.contrast}) saturate(${clip.saturation})`,
      }}
    />
  );
}

function AudioLayer({ clip, track, project, playhead, playing, playbackRate, masterVolume }: {
  clip: Clip;
  track: Track;
  project: Project;
  playhead: number;
  playing: boolean;
  playbackRate: number;
  masterVolume: number;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const asset = project.assets.find((item) => item.id === clip.assetId);
  const currentSourceTime = clip.sourceIn + Math.max(0, playhead - clip.start) * clip.speed;

  useEffect(() => {
    const audio = ref.current;
    if (!audio || !asset?.url) return;
    audio.src = asset.url;
    audio.load();
    const seekWhenReady = () => {
      try { audio.currentTime = currentSourceTime; } catch { /* a file can report metadata before its first frame */ }
      if (playing && !track.muted) void audio.play().catch(() => undefined);
    };
    audio.addEventListener('loadedmetadata', seekWhenReady, { once: true });
    return () => {
      audio.removeEventListener('loadedmetadata', seekWhenReady);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.url, clip.id]);

  useEffect(() => {
    const audio = ref.current;
    if (!audio || !asset?.url || audio.readyState < 1) return;
    const target = Math.min(clip.sourceOut, Math.max(clip.sourceIn, currentSourceTime));
    if (!playing || Math.abs(audio.currentTime - target) > 0.32) {
      try { audio.currentTime = target; } catch { /* wait for the media element to become seekable */ }
    }
    audio.playbackRate = Math.max(0.25, Math.min(4, clip.speed * playbackRate));
    audio.volume = Math.max(0, Math.min(1, clip.volume * fadeGain(clip, playhead) * masterVolume));
    if (playing && !track.muted) void audio.play().catch(() => undefined);
    else audio.pause();
  }, [asset?.url, clip.sourceIn, clip.sourceOut, clip.speed, clip.volume, clip.fadeIn, clip.fadeOut, clip.start, currentSourceTime, playhead, playing, playbackRate, masterVolume, track.muted]);

  return <audio ref={ref} preload="auto" aria-hidden="true" />;
}

export function Preview(props: PreviewProps) {
  const {
    project, playhead, playing, loop, playbackRate, masterVolume, selectedClipId,
    onPlayPause, onFrameStep, onSetLoop, onPlaybackRate, onMasterVolume, onSeek, onSelectClip,
    onBeginTransaction, onPreviewProject, onCommitTransaction,
  } = props;
  const [fullscreen, setFullscreen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  const duration = projectDuration(project);

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const active = useMemo(() => project.clips.filter((clip) => {
    if (playhead < clip.start || playhead >= clipEnd(clip)) return false;
    const track = project.tracks.find((item) => item.id === clip.trackId);
    return track?.visible ?? false;
  }), [project.clips, project.tracks, playhead]);
  const videoLayers = active.filter((clip) => clip.type === 'video' || clip.type === 'image').sort((a, b) => {
    const aIndex = project.tracks.findIndex((track) => track.id === a.trackId);
    const bIndex = project.tracks.findIndex((track) => track.id === b.trackId);
    return bIndex - aIndex;
  });
  const audioLayers = active.filter((clip) => clip.type === 'audio');
  const textLayers = active.filter((clip) => clip.type === 'text');

  const toggleFullscreen = async () => {
    if (!playerRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await playerRef.current.requestFullscreen();
    } catch { /* fullscreen is optional in constrained webviews */ }
  };

  const beginTextDrag = (event: React.PointerEvent<HTMLDivElement>, clip: Clip) => {
    event.preventDefault();
    event.stopPropagation();
    const canvas = playerRef.current?.querySelector('.preview-canvas');
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const initialX = clip.positionX;
    const initialY = clip.positionY;
    onSelectClip(clip.id);
    onBeginTransaction();
    const move = (pointerEvent: PointerEvent) => {
      const dx = ((pointerEvent.clientX - startX) / bounds.width) * 100;
      const dy = ((pointerEvent.clientY - startY) / bounds.height) * 100;
      onPreviewProject((current) => ({
        ...current,
        clips: current.clips.map((item) => item.id === clip.id
          ? { ...item, positionX: initialX + dx, positionY: initialY + dy }
          : item),
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

  const aspectRatio = `${project.width} / ${project.height}`;
  return (
    <section className="preview-panel" ref={playerRef}>
      <header className="panel-titlebar">
        <div className="panel-title-left"><span className="panel-kicker">PLAYER</span><span className="live-pill"><i /> LIVE</span></div>
        <div className="preview-header-right">
          <span className="preview-resolution">{project.width} × {project.height}</span>
          <button className="icon-button tiny" onClick={() => setVolumeOpen((value) => !value)} title="Preview volume"><Volume2 size={15} /></button>
          {volumeOpen && <div className="preview-volume-popover"><b>Preview volume</b><input type="range" min="0" max="100" value={Math.round(masterVolume * 100)} onChange={(event) => onMasterVolume(Number(event.target.value) / 100)} aria-label="Preview volume" /><span>{Math.round(masterVolume * 100)}%</span></div>}
        </div>
      </header>
      <div className="preview-workspace">
        <div className="preview-canvas-wrap">
          <div className="preview-canvas" style={{ aspectRatio, '--canvas-ratio': project.width / project.height } as React.CSSProperties}>
            {videoLayers.map((clip, index) => {
              if (clip.type === 'image') return <ImageLayer key={clip.id} clip={clip} project={project} zIndex={index + 1} onSelect={() => onSelectClip(clip.id)} />;
              const track = project.tracks.find((item) => item.id === clip.trackId)!;
              return <VideoLayer key={clip.id} clip={clip} track={track} project={project} playhead={playhead} playing={playing} playbackRate={playbackRate} masterVolume={masterVolume} zIndex={index + 1} onSelect={() => onSelectClip(clip.id)} />;
            })}
            {textLayers.map((clip, index) => (
              <div
                key={clip.id}
                className={`preview-text-layer ${selectedClipId === clip.id ? 'selected' : ''}`}
                onPointerDown={(event) => beginTextDrag(event, clip)}
                onClick={() => onSelectClip(clip.id)}
                style={{
                  zIndex: videoLayers.length + index + 2,
                  left: `calc(50% + ${clip.positionX}%)`,
                  top: `calc(50% + ${clip.positionY}%)`,
                  opacity: clip.opacity,
                  color: clip.color,
                  fontSize: `clamp(12px, ${Math.max(12, (clip.fontSize / project.height) * 100)}cqh, 11cqh)`,
                  fontFamily: clip.fontFamily,
                  textAlign: clip.align,
                  transform: `translate(-50%, -50%) rotate(${clip.rotation}deg) scale(${clip.scale})`,
                  width: '82%',
                }}
              >
                {clip.text || ' '}
                {selectedClipId === clip.id && <span className="text-selection-hint">DRAG TO REPOSITION</span>}
              </div>
            ))}
            {!videoLayers.length && !textLayers.length && (
              <div className="preview-empty">
                <div className="preview-empty-mark"><Play size={19} fill="currentColor" /></div>
                <b>{project.clips.length ? 'No video at this position' : 'Your preview starts here'}</b>
                <span>{project.clips.length ? 'Move the playhead over a clip.' : 'Import a clip and drop it onto Video 1.'}</span>
              </div>
            )}
            {audioLayers.map((clip) => {
              const track = project.tracks.find((item) => item.id === clip.trackId)!;
              return <AudioLayer key={clip.id} clip={clip} track={track} project={project} playhead={playhead} playing={playing} playbackRate={playbackRate} masterVolume={masterVolume} />;
            })}
          </div>
        </div>
      </div>
      <footer className="player-controls">
        <div className="player-time"><b>{formatTimecode(playhead, project.frameRate)}</b><span>/</span>{formatTimecode(duration, project.frameRate)}</div>
        <div className="transport-controls">
          <button className={`icon-button transport ${loop ? 'is-active' : ''}`} title={loop ? 'Disable loop' : 'Loop playback'} onClick={onSetLoop}><Repeat2 size={15} /></button>
          <button className="icon-button transport" title="Previous frame" onClick={() => onFrameStep(-1)}><SkipBack size={16} /></button>
          <button className="play-button" title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={onPlayPause}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
          <button className="icon-button transport" title="Next frame" onClick={() => onFrameStep(1)}><SkipForward size={16} /></button>
          <label className="speed-select" title="Playback speed">
            <select value={playbackRate} onChange={(event) => onPlaybackRate(Number(event.target.value))} aria-label="Playback speed">
              {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option value={rate} key={rate}>{rate}×</option>)}
            </select>
            <ChevronDown size={12} />
          </label>
        </div>
        <button className="icon-button fullscreen-button" title={fullscreen ? 'Exit fullscreen' : 'Fullscreen preview'} onClick={() => void toggleFullscreen()}><Maximize size={15} /></button>
      </footer>
      <span className="sr-only">Selected clip: {selectedClipId ?? 'none'}</span>
      <button className="sr-only" onClick={() => onSeek(0)}>Return playhead to start</button>
    </section>
  );
}
