import { useMemo, useState } from 'react';
import {
  AudioLines,
  Captions,
  Film,
  FileAudio2,
  FileImage,
  FileVideo2,
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Subtitles,
  TextCursorInput,
  Upload,
} from 'lucide-react';
import type { Clip, MediaAsset, Project } from '../domain/project';
import { formatDuration } from '../domain/project';
import { formatBytes } from '../lib/media';

export type LibraryTab = 'Media' | 'Audio' | 'Text' | 'Effects' | 'Captions';

interface MediaLibraryProps {
  project: Project;
  selectedClip: Clip | null;
  tab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  onImport: (files: FileList | string[]) => void;
  onImportClick: () => void;
  onAddToTimeline: (asset: MediaAsset) => void;
  onRelink: (asset: MediaAsset) => void;
  onAddText: (text: string) => void;
  onApplyLook: (look: 'warm' | 'mono' | 'cinema' | 'reset') => void;
  importing: boolean;
}

const tabs: { name: LibraryTab; icon: typeof Film }[] = [
  { name: 'Media', icon: Film },
  { name: 'Audio', icon: AudioLines },
  { name: 'Text', icon: TextCursorInput },
  { name: 'Effects', icon: Sparkles },
  { name: 'Captions', icon: Captions },
];

function AssetIcon({ kind }: { kind: MediaAsset['kind'] }) {
  if (kind === 'audio') return <FileAudio2 size={16} />;
  if (kind === 'image') return <FileImage size={16} />;
  return <FileVideo2 size={16} />;
}

function AssetCard({ asset, onAdd, onRelink }: { asset: MediaAsset; onAdd: () => void; onRelink: () => void }) {
  const handleDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-capnux-asset', asset.id);
    event.dataTransfer.setData('text/plain', asset.id);
  };

  return (
    <div className={`asset-card ${asset.missing ? 'asset-offline' : ''}`} draggable={!asset.missing} onDragStart={handleDragStart} title={asset.missing ? 'Media file is offline' : `Drag ${asset.name} to a timeline track`}>
      <div className={`asset-art asset-art-${asset.kind}`}>
        {asset.thumbnails[0] ? <img src={asset.thumbnails[0]} alt="" /> : <AssetIcon kind={asset.kind} />}
        <span className="asset-duration">{asset.kind === 'image' ? 'STILL' : formatDuration(asset.duration)}</span>
        {asset.missing && <span className="asset-offline-badge">OFFLINE</span>}
        <button className="asset-add" onClick={asset.missing ? onRelink : onAdd} title={asset.missing ? 'Relink media file' : 'Add to timeline'}>{asset.missing ? <RefreshCw size={14} /> : <Plus size={15} />}</button>
      </div>
      <div className="asset-card-meta">
        <strong title={asset.name}>{asset.name}</strong>
        <span>{asset.missing ? 'RELINK SOURCE' : `${asset.kind.toUpperCase()} · ${formatBytes(asset.size)}`}</span>
      </div>
    </div>
  );
}

export function MediaLibrary({
  project,
  selectedClip,
  tab,
  onTabChange,
  onImport,
  onImportClick,
  onAddToTimeline,
  onRelink,
  onAddText,
  onApplyLook,
  importing,
}: MediaLibraryProps) {
  const [search, setSearch] = useState('');
  const [captionText, setCaptionText] = useState('');
  const [fileInputKey, setFileInputKey] = useState(0);

  const assets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return project.assets.filter((asset) => {
      if (tab === 'Audio' && asset.kind !== 'audio') return false;
      return !query || asset.name.toLowerCase().includes(query);
    });
  }, [project.assets, search, tab]);

  const importClick = () => onImportClick();
  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) onImport(event.target.files);
    setFileInputKey((value) => value + 1);
  };
  const addText = (text: string) => onAddText(text);

  return (
    <aside className="library-panel">
      <div className="library-tabs" role="tablist" aria-label="Asset library">
        {tabs.map(({ name, icon: Icon }) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            className={`library-tab ${tab === name ? 'active' : ''}`}
            onClick={() => onTabChange(name)}
            title={name}
          >
            <Icon size={16} strokeWidth={1.8} />
            <span>{name}</span>
          </button>
        ))}
      </div>

      {tab === 'Media' || tab === 'Audio' ? (
        <div className="library-content">
          <div className="library-heading-row">
            <div>
              <div className="eyebrow">PROJECT LIBRARY</div>
              <h2>{tab === 'Audio' ? 'Audio' : 'Media'}</h2>
            </div>
            <button className="icon-button subtle" onClick={importClick} title="Import files"><Upload size={16} /></button>
          </div>
          <button className="import-dropzone" onClick={importClick} disabled={importing}>
            <span className="import-icon"><Upload size={17} /></span>
            <span><b>{importing ? 'Reading media…' : 'Import media'}</b><small>Video, audio, image · click or drag files</small></span>
            <span className="keyboard-hint">⌘ I</span>
          </button>
          <label className="search-field">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search media" />
            {search && <button onClick={() => setSearch('')} aria-label="Clear search">×</button>}
          </label>
          <div className="library-subhead">
            <span>{tab === 'Audio' ? 'AUDIO FILES' : 'ALL MEDIA'} <b>{assets.length}</b></span>
            <button className="text-button" onClick={importClick}><Plus size={13} /> Add</button>
          </div>
          {assets.length > 0 ? (
            <div className="asset-grid">
              {assets.map((asset) => <AssetCard key={asset.id} asset={asset} onAdd={() => onAddToTimeline(asset)} onRelink={() => onRelink(asset)} />)}
            </div>
          ) : (
            <div className="empty-library">
              <div className="empty-orbit"><FolderOpen size={22} /></div>
              <b>{search ? 'No matching files' : 'Your library is ready'}</b>
              <span>{search ? 'Try another search.' : 'Import clips, then drag them to the timeline.'}</span>
              {!search && <button className="text-button accent-link" onClick={importClick}>Choose files <span>→</span></button>}
            </div>
          )}
          <input key={fileInputKey} id="capnux-media-input" className="visually-hidden" type="file" multiple accept="video/*,audio/*,image/*,.mkv,.mov,.webm,.flac,.opus" onChange={handleFiles} />
        </div>
      ) : null}

      {tab === 'Text' ? (
        <div className="library-content">
          <div className="eyebrow">TITLES & GRAPHICS</div>
          <h2>Text</h2>
          <p className="panel-copy">Add editable titles to the timeline. Position and style them in the preview and inspector.</p>
          <button className="primary-wide" onClick={() => addText('Your title')}><Plus size={16} /> Add title</button>
          <div className="library-subhead spaced"><span>QUICK STYLES</span></div>
          <button className="text-preset preset-title" onClick={() => addText('A bold headline')}><span className="preset-preview">Aa</span><span><b>Headline</b><small>Large, centered title</small></span><Plus size={15} /></button>
          <button className="text-preset preset-subtitle" onClick={() => addText('Subtitle goes here')}><span className="preset-preview">Aa</span><span><b>Subtitle</b><small>Compact lower caption</small></span><Plus size={15} /></button>
          <div className="helper-note"><TextCursorInput size={15} /><span>Text clips are rendered into the exported video.</span></div>
        </div>
      ) : null}

      {tab === 'Effects' ? (
        <div className="library-content">
          <div className="eyebrow">COLOR & LOOKS</div>
          <h2>Effects</h2>
          <p className="panel-copy">These looks adjust the selected video clip in real time and are included in export.</p>
          {!selectedClip || !['video', 'image'].includes(selectedClip.type) ? (
            <div className="empty-state compact"><Sparkles size={21} /><b>Select a video clip</b><span>Choose a clip on the timeline to apply a look.</span></div>
          ) : (
            <div className="look-list">
              <button className="look-card look-warm" onClick={() => onApplyLook('warm')}><span className="look-swatch" /><span><b>Golden hour</b><small>Warm highlights, rich color</small></span><Plus size={15} /></button>
              <button className="look-card look-mono" onClick={() => onApplyLook('mono')}><span className="look-swatch" /><span><b>Monochrome</b><small>Classic black and white</small></span><Plus size={15} /></button>
              <button className="look-card look-cinema" onClick={() => onApplyLook('cinema')}><span className="look-swatch" /><span><b>Deep cinema</b><small>Contrast and cool shadows</small></span><Plus size={15} /></button>
              <button className="text-button reset-look" onClick={() => onApplyLook('reset')}>Reset adjustments</button>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'Captions' ? (
        <div className="library-content">
          <div className="eyebrow">SUBTITLES</div>
          <h2>Captions</h2>
          <div className="caption-info"><Subtitles size={18} /><div><b>Editable caption blocks</b><span>Speech recognition is not bundled in this build. Add subtitle text manually below.</span></div></div>
          <label className="field-label caption-field">Caption text<textarea value={captionText} onChange={(event) => setCaptionText(event.target.value)} placeholder="Type a subtitle…" rows={3} /></label>
          <button className="primary-wide" disabled={!captionText.trim()} onClick={() => { addText(captionText.trim()); setCaptionText(''); }}><Plus size={16} /> Add caption at playhead</button>
          <div className="helper-note"><Captions size={15} /><span>Caption blocks remain fully editable as text clips.</span></div>
        </div>
      ) : null}
    </aside>
  );
}
