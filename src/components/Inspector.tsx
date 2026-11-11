import { useEffect, useState } from 'react';
import { AudioLines, Check, ChevronDown, Film, RotateCcw, Type, Video } from 'lucide-react';
import type { Clip, Project } from '../domain/project';
import { formatDuration } from '../domain/project';

interface InspectorProps {
  project: Project;
  clip: Clip | null;
  onUpdateProject: (updater: (project: Project) => Project) => void;
  onBeginTransaction: () => void;
  onPreviewProject: (updater: (project: Project) => Project) => void;
  onCommitTransaction: () => void;
}

function patchClip(project: Project, clipId: string, patch: Partial<Clip>): Project {
  return { ...project, clips: project.clips.map((item) => item.id === clipId ? { ...item, ...patch } : item) };
}

function RangeControl({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
  onBegin,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: string;
  onChange: (value: number) => void;
  onBegin: () => void;
  onCommit: () => void;
}) {
  return (
    <label className="range-control">
      <span><span>{label}</span><b>{display ?? value}</b></span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onFocus={onBegin}
        onPointerDown={onBegin}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onBlur={onCommit}
        aria-label={label}
      />
    </label>
  );
}

export function Inspector({ project, clip, onUpdateProject, onBeginTransaction, onPreviewProject, onCommitTransaction }: InspectorProps) {
  const [panel, setPanel] = useState<'clip' | 'project'>(clip ? 'clip' : 'project');
  const [textDraft, setTextDraft] = useState(clip?.text ?? '');
  const asset = clip?.assetId ? project.assets.find((item) => item.id === clip.assetId) : undefined;
  const track = clip ? project.tracks.find((item) => item.id === clip.trackId) : undefined;

  useEffect(() => {
    if (clip) {
      setPanel('clip');
      setTextDraft(clip.text);
    } else {
      setPanel('project');
    }
  }, [clip?.id]);

  const updateClip = (patch: Partial<Clip>) => {
    if (!clip) return;
    onUpdateProject((current) => patchClip(current, clip.id, patch));
  };
  const previewClip = (patch: Partial<Clip>) => {
    if (!clip) return;
    onPreviewProject((current) => patchClip(current, clip.id, patch));
  };
  const range = (label: string, value: number, min: number, max: number, step: number, patch: (value: number) => Partial<Clip>, display?: (value: number) => string) => (
    <RangeControl
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      display={display?.(value)}
      onBegin={onBeginTransaction}
      onCommit={onCommitTransaction}
      onChange={(next) => previewClip(patch(next))}
    />
  );

  return (
    <aside className="inspector-panel">
      <div className="inspector-tabs">
        <button className={panel === 'clip' && clip ? 'active' : ''} onClick={() => clip && setPanel('clip')} disabled={!clip}>Clip</button>
        <button className={panel === 'project' ? 'active' : ''} onClick={() => setPanel('project')}>Project</button>
      </div>
      {panel === 'clip' && clip ? (
        <div className="inspector-content">
          <div className="selected-clip-card">
            <div className={`selected-clip-icon type-${clip.type}`}>{clip.type === 'text' ? <Type size={16} /> : clip.type === 'audio' ? <AudioLines size={16} /> : clip.type === 'image' ? <Film size={16} /> : <Video size={16} />}</div>
            <div><b>{clip.type === 'text' ? 'Text overlay' : clip.name}</b><span>{clip.type.toUpperCase()} CLIP {asset?.duration ? `· ${formatDuration(asset.duration)}` : ''}</span></div>
          </div>
          {clip.type === 'text' ? (
            <section className="inspector-section">
              <h3>Text</h3>
              <label className="field-label">Content
                <textarea
                  value={textDraft}
                  rows={3}
                  onFocus={onBeginTransaction}
                  onChange={(event) => {
                    setTextDraft(event.target.value);
                    previewClip({ text: event.target.value, name: event.target.value.slice(0, 34) || 'Text overlay' });
                  }}
                  onBlur={onCommitTransaction}
                />
              </label>
              <div className="form-grid two-col">
                <label className="field-label">Font size<input type="number" min="12" max="240" value={clip.fontSize} onChange={(event) => updateClip({ fontSize: Number(event.target.value) })} /></label>
                <label className="field-label">Color<input className="color-field" type="color" value={clip.color} onChange={(event) => updateClip({ color: event.target.value })} /></label>
              </div>
              <label className="field-label">Font family
                <select value={clip.fontFamily} onChange={(event) => updateClip({ fontFamily: event.target.value })}>
                  <option value="Inter, sans-serif">Inter / system sans</option>
                  <option value="serif">Serif</option>
                  <option value="monospace">Monospace</option>
                  <option value="cursive">Cursive</option>
                </select>
              </label>
              <div className="segmented-control" aria-label="Text alignment">
                {(['left', 'center', 'right'] as const).map((align) => <button key={align} className={clip.align === align ? 'active' : ''} onClick={() => updateClip({ align })}>{align}</button>)}
              </div>
              {range('Opacity', Math.round(clip.opacity * 100), 0, 100, 1, (value) => ({ opacity: value / 100 }), (value) => `${value}%`)}
            </section>
          ) : (
            <>
              {(clip.type === 'video' || clip.type === 'image') && <section className="inspector-section">
                <h3>Transform <span>LIVE</span></h3>
                <div className="form-grid two-col transform-grid">
                  <label className="field-label">Position X<input type="number" step="1" value={Math.round(clip.positionX)} onChange={(event) => updateClip({ positionX: Number(event.target.value) })} /></label>
                  <label className="field-label">Position Y<input type="number" step="1" value={Math.round(clip.positionY)} onChange={(event) => updateClip({ positionY: Number(event.target.value) })} /></label>
                  <label className="field-label">Scale<input type="number" min="0.1" max="5" step="0.05" value={Number(clip.scale.toFixed(2))} onChange={(event) => updateClip({ scale: Math.max(0.1, Number(event.target.value)) })} /></label>
                  <label className="field-label">Rotation<input type="number" step="1" value={Math.round(clip.rotation)} onChange={(event) => updateClip({ rotation: Number(event.target.value) })} /></label>
                </div>
                {range('Scale', Math.round(clip.scale * 100), 10, 300, 1, (value) => ({ scale: value / 100 }), (value) => `${value}%`)}
                {range('Opacity', Math.round(clip.opacity * 100), 0, 100, 1, (value) => ({ opacity: value / 100 }), (value) => `${value}%`)}
                <button className="reset-button" onClick={() => updateClip({ positionX: 0, positionY: 0, scale: 1, rotation: 0, opacity: 1 })}><RotateCcw size={13} /> Reset transform</button>
              </section>}
              <section className="inspector-section">
                <h3>{clip.type === 'audio' ? 'Audio' : 'Color'} <span>LIVE</span></h3>
                {clip.type === 'audio' || (clip.type === 'video' && asset?.hasAudio) ? <>
                  {range('Volume', Math.round(clip.volume * 100), 0, 200, 1, (value) => ({ volume: value / 100 }), (value) => `${value}%`)}
                  <div className="form-grid two-col">
                    <label className="field-label">Fade in<input type="number" min="0" step="0.1" value={clip.fadeIn} onChange={(event) => updateClip({ fadeIn: Math.max(0, Number(event.target.value)) })} /></label>
                    <label className="field-label">Fade out<input type="number" min="0" step="0.1" value={clip.fadeOut} onChange={(event) => updateClip({ fadeOut: Math.max(0, Number(event.target.value)) })} /></label>
                  </div>
                </> : null}
                {(clip.type === 'video' || clip.type === 'image') && <>
                  {range('Brightness', Math.round(clip.brightness * 100), -100, 100, 1, (value) => ({ brightness: value / 100 }), (value) => `${value > 0 ? '+' : ''}${value}`)}
                  {range('Contrast', Math.round(clip.contrast * 100), 0, 200, 1, (value) => ({ contrast: value / 100 }), (value) => `${value}%`)}
                  {range('Saturation', Math.round(clip.saturation * 100), 0, 200, 1, (value) => ({ saturation: value / 100 }), (value) => `${value}%`)}
                </>}
              </section>
              <section className="inspector-section">
                <h3>Timing</h3>
                <div className="form-grid two-col">
                  <label className="field-label">Speed<select value={clip.speed} onChange={(event) => updateClip({ speed: Number(event.target.value) })}>{[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((speed) => <option value={speed} key={speed}>{speed}×</option>)}</select></label>
                  <label className="field-label">Track<input value={track?.name ?? 'Missing track'} readOnly /></label>
                </div>
              </section>
            </>
          )}
        </div>
      ) : (
        <div className="inspector-content">
          <div className="project-details-heading"><div className="project-detail-icon"><Film size={17} /></div><div><b>Project settings</b><span>Sequence & timeline</span></div><Check size={14} className="saved-check" /></div>
          <section className="inspector-section">
            <h3>Canvas</h3>
            <div className="form-grid two-col">
              <label className="field-label">Width<input type="number" min="128" max="7680" step="2" value={project.width} onChange={(event) => onUpdateProject((current) => ({ ...current, width: Math.max(128, Number(event.target.value)) }))} /></label>
              <label className="field-label">Height<input type="number" min="128" max="4320" step="2" value={project.height} onChange={(event) => onUpdateProject((current) => ({ ...current, height: Math.max(128, Number(event.target.value)) }))} /></label>
            </div>
            <label className="field-label">Aspect ratio
              <select value={`${project.width}:${project.height}`} onChange={(event) => {
                const [width, height] = event.target.value.split(':').map(Number);
                onUpdateProject((current) => ({ ...current, width, height }));
              }}>
                <option value="1920:1080">16:9 · Landscape</option>
                <option value="1080:1920">9:16 · Portrait</option>
                <option value="1080:1080">1:1 · Square</option>
                <option value="1440:1080">4:3 · Classic</option>
                <option value={`${project.width}:${project.height}`}>Custom · {project.width}:{project.height}</option>
              </select>
            </label>
            <label className="field-label">Frame rate
              <select value={project.frameRate} onChange={(event) => onUpdateProject((current) => ({ ...current, frameRate: Number(event.target.value) }))}>
                {[24, 25, 30, 50, 60].map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
              </select>
            </label>
          </section>
          <section className="inspector-section">
            <h3>Project information</h3>
            <div className="detail-list">
              <div><span>Media assets</span><b>{project.assets.length}</b></div>
              <div><span>Timeline clips</span><b>{project.clips.length}</b></div>
              <div><span>Tracks</span><b>{project.tracks.length}</b></div>
              <div><span>Color space</span><b>SDR · Rec.709</b></div>
            </div>
          </section>
          <div className="project-format-note"><ChevronDown size={14} /><span>CapNux project format v1 · changes autosave locally</span></div>
        </div>
      )}
    </aside>
  );
}
