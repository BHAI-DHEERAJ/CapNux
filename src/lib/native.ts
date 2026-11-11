import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

export const isDesktopApp = (): boolean => '__TAURI_INTERNALS__' in window;

export async function chooseMediaFiles(): Promise<string[]> {
  const result = await open({
    multiple: true,
    title: 'Import media into CapNux',
    filters: [{ name: 'Video, audio and image files', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  });
  return result ? (Array.isArray(result) ? result : [result]) : [];
}

export async function chooseProjectToOpen(): Promise<string | null> {
  const result = await open({
    multiple: false,
    title: 'Open CapNux project',
    filters: [{ name: 'CapNux project', extensions: ['capnux', 'json'] }],
  });
  return typeof result === 'string' ? result : null;
}

export async function chooseProjectToSave(suggestedName: string): Promise<string | null> {
  const result = await save({
    title: 'Save CapNux project',
    defaultPath: `${suggestedName.replace(/[\\/:*?"<>|]/g, '')}.capnux`,
    filters: [{ name: 'CapNux project', extensions: ['capnux'] }],
  });
  return result ?? null;
}

export async function chooseExportPath(defaultName: string, extension: string): Promise<string | null> {
  const result = await save({
    title: 'Export video',
    defaultPath: defaultName,
    filters: [{ name: `${extension.toUpperCase()} video`, extensions: [extension] }],
  });
  return result ?? null;
}

export function pathToAssetUrl(path: string): string {
  return convertFileSrc(path);
}

export { invoke };
