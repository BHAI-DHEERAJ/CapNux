import type { MediaAsset, MediaKind } from '../domain/project';
import { invoke, pathToAssetUrl } from './native';

interface NativeMediaInfo {
  name: string;
  kind: MediaKind;
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
  size: number;
}

const assetId = (): string => `asset-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

function guessKind(file: File): MediaKind {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'tif', 'tiff'].includes(extension ?? '')) return 'image';
  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aiff'].includes(extension ?? '')) return 'audio';
  return 'video';
}

function waitFor(target: EventTarget, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      target.removeEventListener(event, done);
      target.removeEventListener('error', failed);
      resolve();
    };
    const failed = () => {
      target.removeEventListener(event, done);
      target.removeEventListener('error', failed);
      reject(new Error('Could not read media metadata.'));
    };
    target.addEventListener(event, done, { once: true });
    target.addEventListener('error', failed, { once: true });
  });
}

async function inspectInBrowser(url: string, kind: MediaKind): Promise<{ duration: number; width: number; height: number; hasAudio: boolean }> {
  if (kind === 'image') {
    const image = new Image();
    image.src = url;
    await (image.decode?.() ?? waitFor(image, 'load'));
    return { duration: 5, width: image.naturalWidth, height: image.naturalHeight, hasAudio: false };
  }

  const element = document.createElement(kind === 'audio' ? 'audio' : 'video');
  element.preload = 'metadata';
  element.src = url;
  await waitFor(element, 'loadedmetadata');
  const hasAudio = kind === 'audio' || kind === 'video';
  const metadata = {
    duration: Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 5,
    width: kind === 'video' ? (element as HTMLVideoElement).videoWidth : 0,
    height: kind === 'video' ? (element as HTMLVideoElement).videoHeight : 0,
    hasAudio,
  };
  element.removeAttribute('src');
  element.load();
  return metadata;
}

async function browserThumbnails(url: string, kind: MediaKind, duration: number): Promise<string[]> {
  if (kind === 'image') return [url];
  if (kind !== 'video') return [];
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.src = url;
  try {
    await waitFor(video, 'loadedmetadata');
    const frames: string[] = [];
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = Math.max(1, Math.round(160 * (video.videoHeight / Math.max(1, video.videoWidth))));
    const context = canvas.getContext('2d');
    if (!context) return [];
    const count = Math.min(5, Math.max(1, Math.ceil(duration / 5)));
    for (let index = 0; index < count; index += 1) {
      const target = Math.min(Math.max(0.05, duration - 0.05), ((index + 1) / (count + 1)) * duration);
      video.currentTime = target;
      await waitFor(video, 'seeked');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', 0.72));
    }
    return frames;
  } catch {
    return [];
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

async function browserWaveform(file: File, kind: MediaKind): Promise<number[]> {
  if (kind === 'image' || file.size > 80 * 1024 * 1024) return [];
  try {
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channel = buffer.getChannelData(0);
    const bins = 160;
    const result: number[] = [];
    for (let bin = 0; bin < bins; bin += 1) {
      const start = Math.floor((bin / bins) * channel.length);
      const end = Math.max(start + 1, Math.floor(((bin + 1) / bins) * channel.length));
      let peak = 0;
      for (let sample = start; sample < end; sample += 1) peak = Math.max(peak, Math.abs(channel[sample]));
      result.push(peak);
    }
    await context.close();
    return result;
  } catch {
    return [];
  }
}

export async function mediaAssetFromFile(file: File): Promise<MediaAsset> {
  const kind = guessKind(file);
  const url = URL.createObjectURL(file);
  const metadata = await inspectInBrowser(url, kind);
  const [thumbnails, waveform] = await Promise.all([
    browserThumbnails(url, kind, metadata.duration),
    browserWaveform(file, kind),
  ]);
  return {
    id: assetId(),
    name: file.name,
    path: null,
    url,
    kind,
    mime: file.type || `${kind}/unknown`,
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    frameRate: 30,
    hasAudio: metadata.hasAudio,
    size: file.size,
    thumbnails,
    waveform,
    missing: false,
  };
}

export async function mediaAssetFromPath(path: string): Promise<MediaAsset> {
  const info = await invoke<NativeMediaInfo>('probe_media', { path });
  const url = pathToAssetUrl(path);
  const [thumbnails, waveform] = await Promise.all([
    invoke<string[]>('generate_thumbnails', { path, count: 5 }).catch(() => info.kind === 'image' ? [url] : []),
    info.kind === 'image' ? Promise.resolve([]) : invoke<number[]>('generate_waveform', { path, bins: 160 }).catch(() => []),
  ]);
  return {
    id: assetId(),
    name: info.name,
    path,
    url,
    kind: info.kind,
    mime: `${info.kind}/unknown`,
    duration: info.duration || 5,
    width: info.width,
    height: info.height,
    frameRate: info.frameRate || 30,
    hasAudio: info.hasAudio,
    size: info.size,
    thumbnails,
    waveform,
    missing: false,
  };
}

export function mediaAssetFromSavedPath(asset: MediaAsset, path: string): MediaAsset {
  return { ...asset, path, url: pathToAssetUrl(path) };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
