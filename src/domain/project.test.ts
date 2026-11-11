import { describe, expect, it } from 'vitest';
import {
  clipDuration,
  clipEnd,
  createProject,
  deleteClip,
  formatTimecode,
  historyReducer,
  initialHistory,
  makeMediaClip,
  makeTextClip,
  snapTime,
  splitProjectAt,
  type MediaAsset,
} from './project';

const asset: MediaAsset = {
  id: 'asset-one', name: 'road.mp4', path: '/tmp/road.mp4', url: '', kind: 'video', mime: 'video/mp4',
  duration: 12, width: 1920, height: 1080, frameRate: 30, hasAudio: true, size: 1024, thumbnails: [], waveform: [],
};

describe('CapNux timeline project model', () => {
  it('creates a multi-track project with a 1080p sequence', () => {
    const project = createProject('Cut');
    expect(project.name).toBe('Cut');
    expect(project.width).toBe(1920);
    expect(project.height).toBe(1080);
    expect(project.tracks.map((track) => track.kind)).toEqual(['text', 'video', 'video', 'audio']);
  });

  it('derives timeline duration from source range and playback speed', () => {
    const clip = { ...makeMediaClip(asset, 'track-video-1', 2), sourceIn: 1, sourceOut: 9, speed: 2 };
    expect(clipDuration(clip)).toBe(4);
    expect(clipEnd(clip)).toBe(6);
  });

  it('splits a sped-up source into independently editable, time-contiguous clips', () => {
    const project = createProject();
    const clip = { ...makeMediaClip(asset, 'track-video-1', 1), speed: 2 };
    const source = { ...project, clips: [clip] };
    const split = splitProjectAt(source, 5);
    expect(split).not.toBe(source);
    expect(split.clips).toHaveLength(2);
    const [left, right] = split.clips;
    expect(left.id).toBe(clip.id);
    expect(left.start).toBe(1);
    expect(clipEnd(left)).toBe(5);
    expect(right.start).toBe(5);
    expect(right.sourceIn).toBe(8);
    expect(clipEnd(right)).toBe(7);
    expect(right.id).not.toBe(left.id);
  });

  it('does not split outside a clip and leaves text blocks alone', () => {
    const project = createProject();
    const text = makeTextClip('track-text-1', 0, 'Hello');
    const withText = { ...project, clips: [text] };
    expect(splitProjectAt(withText, 2)).toBe(withText);
  });

  it('snaps to nearby clip edges and ignores the clip being dragged', () => {
    const first = makeMediaClip(asset, 'track-video-1', 1);
    const second = makeMediaClip(asset, 'track-video-1', 7);
    expect(snapTime(7.08, [first, second], first.id, 0.15)).toBe(7);
    expect(snapTime(7.08, [first, second], second.id, 0.15)).not.toBe(7);
  });

  it('ripple delete shifts only following clips on the same track', () => {
    const first = makeMediaClip(asset, 'track-video-1', 0);
    first.sourceOut = 4;
    const later = makeMediaClip(asset, 'track-video-1', 8);
    const otherTrack = makeMediaClip(asset, 'track-audio-1', 8);
    const project = { ...createProject(), clips: [first, later, otherTrack] };
    const result = deleteClip(project, first.id, true);
    expect(result.clips.find((clip) => clip.id === later.id)?.start).toBe(4);
    expect(result.clips.find((clip) => clip.id === otherTrack.id)?.start).toBe(8);
  });

  it('commits drag transactions as one undo step', () => {
    const initial = createProject();
    const started = historyReducer(initialHistory(initial), { type: 'begin' });
    const preview = historyReducer(started, { type: 'preview', updater: (project) => ({ ...project, name: 'Moving' }) });
    const committed = historyReducer(preview, { type: 'commit' });
    expect(committed.past).toHaveLength(1);
    expect(committed.present.name).toBe('Moving');
    const undone = historyReducer(committed, { type: 'undo' });
    expect(undone.present.name).toBe(initial.name);
    expect(historyReducer(undone, { type: 'redo' }).present.name).toBe('Moving');
  });

  it('formats project timecode with frame precision', () => {
    expect(formatTimecode(3661.5, 30)).toBe('01:01:01:15');
  });
});
