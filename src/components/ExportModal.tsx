import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AlertTriangle, CheckCircle2, Clapperboard, FolderOpen, Loader2, X } from 'lucide-react';
import type { Project } from '../domain/project';
import { invoke, isDesktopApp } from '../lib/native';
import { chooseExportPath } from '../lib/native';

interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  codec: string;
  container: string;
  videoBitrate: string;
  audioBitrate: string;
}

interface ExportProgress {
  jobId: string;
  progress: number;
  status: 'running' | 'complete' | 'failed' | 'cancelled';
  message?: string;
  outputPath?: string;
}

interface ExportModalProps {
  project: Project;
  ffmpegAvailable: boolean | null;
  onClose: () => void;
}

const extensionFor = (container: string) => container === 'quicktime' ? 'mov' : container;

export function ExportModal({ project, ffmpegAvailable, onClose }: ExportModalProps) {
  const [preset, setPreset] = useState('1080p');
  const [settings, setSettings] = useState<ExportSettings>({
    width: project.width,
    height: project.height,
    fps: project.frameRate,
    codec: 'h264',
    container: 'mp4',
    videoBitrate: '12M',
    audioBitrate: '192k',
  });
  const [custom, setCustom] = useState({ width: project.width, height: project.height });
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [jobId, setJobId] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const unlistenRef = useRef<null | (() => void)>(null);
  const desktop = isDesktopApp();
  const finished = progress?.status === 'complete';

  const availableCodecs = useMemo(() => {
    if (settings.container === 'webm') return ['vp9', 'av1'];
    return ['h264', 'h265', 'av1'];
  }, [settings.container]);

  useEffect(() => {
    if (!availableCodecs.includes(settings.codec)) setSettings((current) => ({ ...current, codec: availableCodecs[0] }));
  }, [availableCodecs, settings.codec]);

  useEffect(() => () => { unlistenRef.current?.(); }, []);

  const selectPreset = (value: string) => {
    setPreset(value);
    if (value === 'custom') {
      setSettings((current) => ({ ...current, width: custom.width, height: custom.height }));
      return;
    }
    const height = Number(value.replace('p', ''));
    const width = Math.round(height * project.width / project.height / 2) * 2;
    setCustom({ width, height });
    setSettings((current) => ({ ...current, width, height }));
  };

  const startExport = async () => {
    setError('');
    if (!desktop) {
      setError('Rendering requires the CapNux Linux desktop app with FFmpeg installed. This browser preview can still import, edit and play media.');
      return;
    }
    if (ffmpegAvailable === false) {
      setError('FFmpeg was not found. Install FFmpeg from your distribution package manager, then restart CapNux.');
      return;
    }
    if (!project.clips.length) {
      setError('Add at least one clip to the timeline before exporting.');
      return;
    }
    setBusy(true);
    try {
      const extension = extensionFor(settings.container);
      const path = await chooseExportPath(`${project.name.replace(/[\\/:*?"<>|]/g, '')}.${extension}`, extension);
      if (!path) {
        setBusy(false);
        return;
      }
      setOutputPath(path);
      unlistenRef.current?.();
      const stopProgress = await listen<ExportProgress>('export-progress', (event) => {
        setProgress(event.payload);
        if (event.payload.status !== 'running') {
          setBusy(false);
          stopProgress();
          unlistenRef.current = null;
        }
      });
      unlistenRef.current = stopProgress;
      const id = await invoke<string>('start_export', { project, outputPath: path, settings });
      setJobId(id);
      setStartedAt(Date.now());
      setProgress({ jobId: id, progress: 0, status: 'running', message: 'Preparing render…', outputPath: path });
    } catch (cause) {
      unlistenRef.current?.();
      unlistenRef.current = null;
      setBusy(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const cancelExport = async () => {
    if (!jobId) {
      onClose();
      return;
    }
    try { await invoke('cancel_export', { jobId }); } catch (cause) { setError(String(cause)); }
    setBusy(false);
  };

  const estimate = () => {
    if (!startedAt || !progress || progress.progress <= 0 || progress.progress >= 100) return 'Calculating…';
    const elapsed = (Date.now() - startedAt) / 1000;
    const remaining = Math.max(0, elapsed / (progress.progress / 100) - elapsed);
    return remaining > 60 ? `~${Math.ceil(remaining / 60)} min remaining` : `~${Math.ceil(remaining)} sec remaining`;
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal-heading">
          <div className="modal-title-icon"><Clapperboard size={18} /></div>
          <div><span className="eyebrow">DELIVERY</span><h2 id="export-title">Export video</h2></div>
          <button className="icon-button subtle" onClick={onClose} disabled={busy} title="Close"><X size={17} /></button>
        </div>
        <div className="export-body">
          {!progress || progress.status === 'failed' || progress.status === 'cancelled' ? <>
            <div className="export-section-label">VIDEO</div>
            <div className="export-grid two-col">
              <label className="field-label">Resolution
                <select value={preset} onChange={(event) => selectPreset(event.target.value)}>
                  <option value="720p">720p · HD</option>
                  <option value="1080p">1080p · Full HD</option>
                  <option value="1440p">1440p · QHD</option>
                  <option value="2160p">4K · UHD</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label className="field-label">Frame rate
                <select value={settings.fps} onChange={(event) => setSettings((current) => ({ ...current, fps: Number(event.target.value) }))}>
                  {[24, 25, 30, 50, 60].map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
                </select>
              </label>
              <label className="field-label">Format
                <select value={settings.container} onChange={(event) => setSettings((current) => ({ ...current, container: event.target.value }))}>
                  <option value="mp4">MP4</option><option value="mov">MOV</option><option value="webm">WebM</option><option value="mkv">MKV</option>
                </select>
              </label>
              <label className="field-label">Video codec
                <select value={settings.codec} onChange={(event) => setSettings((current) => ({ ...current, codec: event.target.value }))}>
                  {availableCodecs.map((codec) => <option key={codec} value={codec}>{codec.toUpperCase()}</option>)}
                </select>
              </label>
              <label className="field-label">Video bitrate<input value={settings.videoBitrate} onChange={(event) => setSettings((current) => ({ ...current, videoBitrate: event.target.value }))} /></label>
              <label className="field-label">Audio bitrate<input value={settings.audioBitrate} onChange={(event) => setSettings((current) => ({ ...current, audioBitrate: event.target.value }))} /></label>
            </div>
            {preset === 'custom' && <div className="export-grid two-col custom-resolution">
              <label className="field-label">Width<input type="number" min="128" step="2" value={custom.width} onChange={(event) => { const width = Number(event.target.value); setCustom((current) => ({ ...current, width })); setSettings((current) => ({ ...current, width })); }} /></label>
              <label className="field-label">Height<input type="number" min="128" step="2" value={custom.height} onChange={(event) => { const height = Number(event.target.value); setCustom((current) => ({ ...current, height })); setSettings((current) => ({ ...current, height })); }} /></label>
            </div>}
            <div className="export-summary">
              <div className="summary-resolution"><b>{settings.width} × {settings.height}</b><span>{settings.fps} fps · {settings.codec.toUpperCase()} · {extensionFor(settings.container).toUpperCase()}</span></div>
              <div className={`ffmpeg-status ${ffmpegAvailable === false ? 'missing' : ''}`}><i />{!desktop ? 'Native app required' : ffmpegAvailable === null ? 'Checking FFmpeg' : ffmpegAvailable ? 'FFmpeg ready' : 'FFmpeg missing'}</div>
            </div>
            {error && <div className="export-error"><AlertTriangle size={15} /><span>{error}</span></div>}
            {progress?.status === 'failed' && <div className="export-error"><AlertTriangle size={15} /><span>{progress.message || 'Render failed.'}</span></div>}
          </> : (
            <div className="export-progress-panel">
              {finished ? <div className="export-done-icon"><CheckCircle2 size={28} /></div> : <Loader2 className="export-spinner" size={28} />}
              <h3>{finished ? 'Export complete' : 'Rendering your edit'}</h3>
              <p>{finished ? outputPath : (progress?.message || 'Compositing timeline and encoding video…')}</p>
              <div className="progress-track"><span style={{ width: `${Math.max(0, Math.min(100, progress?.progress ?? 0))}%` }} /></div>
              <div className="progress-meta"><b>{Math.round(progress?.progress ?? 0)}%</b><span>{finished ? 'Saved to disk' : estimate()}</span></div>
              {error && <div className="export-error"><AlertTriangle size={15} /><span>{error}</span></div>}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="secondary-button" onClick={busy ? cancelExport : onClose}>{busy ? 'Cancel render' : finished ? 'Close' : 'Cancel'}</button>
          {!progress || progress.status === 'failed' || progress.status === 'cancelled' ? (
            <button className="export-confirm" onClick={() => void startExport()} disabled={busy}><FolderOpen size={15} /> Export</button>
          ) : finished ? (
            <button className="export-confirm" onClick={onClose}><CheckCircle2 size={15} /> Done</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
