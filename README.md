# CapNux Studio

A Linux-first, CapCut-inspired non-linear video editor. CapNux is an original implementation and brand; the supplied screenshots were used as workflow references, not copied as artwork.

> **Current milestone:** a working editing vertical slice—native Tauri shell, media library, multi-track timeline, live WebView preview, project persistence, and an FFmpeg render path. This is an early editor, not a claim that every advanced feature in the long-term vision is already production-complete.

## Screenshot analysis and design decisions

The references show two complementary parts of the CapCut workflow:

- The three editing screenshots use a charcoal workspace with a compact top command bar, an asset/tool browser at left, a central player, a contextual details/inspector panel at right, and a dense multi-track timeline at the bottom. Track colors, waveform lanes, a ruler, and a high-contrast playhead make the edit legible even in a compact window.
- The home screenshot emphasizes a large “create project” action, quick-start tools, and recent project thumbnails. That is a project-management surface rather than an editing surface.

CapNux follows the editing-workspace hierarchy and visual rhythm, while using its own cyan/teal accent, Manrope and DM Mono typography, original icon, labels, and controls. The first milestone opens directly into an editable workspace so the real timeline is immediately available; project creation, open/save, and project settings are accessible in the command menu and inspector. A dedicated recent-project home screen is a later milestone.

## Architecture

- **Desktop shell:** Tauri 2, targeting Linux/GTK/WebKitGTK. It provides native file dialogs, persistent project files, access to selected media paths, and a small Rust command layer.
- **Editor UI:** React + TypeScript + Vite. The browser preview and the Tauri window use the same editor and project model.
- **Shared project model:** `src/domain/project.ts` defines assets, tracks, clips, sequence settings, split/duplicate/delete operations, snapping, and bounded undo/redo history. The timeline, preview, inspector, and exporter all consume this model.
- **Playback:** real media is decoded and played by the WebKit media elements in the preview; the timeline clock drives seeking and synchronization. Native import/probing, thumbnails, waveforms, and final rendering use FFmpeg/FFprobe. This milestone does **not** yet contain a custom FFmpeg frame-decoder/GPU playback daemon, so decoder support and multi-layer preview accuracy depend on the installed WebKit/GStreamer stack.
- **Rendering:** the Rust layer constructs a filter graph from the project model and invokes the system FFmpeg executable. Video layers are composited, text is drawn into the output, audio is mixed, and progress/cancellation events are sent back to the UI.
- **Project format:** human-readable `.capnux` JSON (`formatVersion: 1`) stores the sequence, absolute media paths, tracks, clips, transforms, audio controls, text and timing. Autosave stores project state in the application WebView's local storage; explicit Save/Save As writes an atomic project file.
- **AI integration:** no AI model/service is included. Captions are manually editable text blocks; speech recognition and other AI tools are explicitly not represented as working features.

### Source layout

```text
src/
  App.tsx                  workspace, project commands, keyboard shortcuts and state
  components/              media library, preview, timeline, inspector, export dialog
  domain/project.ts        common editing model and pure timeline/history operations
  lib/                     media probing/import helpers and Tauri boundary
src-tauri/
  src/lib.rs               FFprobe, thumbnails, waveforms, project I/O, FFmpeg renderer
  capabilities/            Tauri window permissions
  icons/                   generated Linux application icons
  tauri.conf.json          desktop window and Linux bundle configuration
scripts/create_icon.py     reproducible icon generator (Python standard library only)
.github/workflows/         Ubuntu CI, tests and Linux package build
```

## Implemented in this milestone

- Linux desktop shell configuration (Tauri 2) plus a browser-based development preview.
- Dark, resizable workspace inspired by the references: media/tool browser, player, inspector, multi-track timeline, status bar, project menu and export dialog.
- Import video, audio, and still images. The native app probes with FFprobe and generates representative thumbnails/waveforms with FFmpeg; the browser preview uses Web APIs.
- Real preview playback, pause, frame stepping, timeline seeking, loop, playback speed, and project aspect-ratio controls.
- Video, audio, and text tracks; add-track controls; drag media from the library into compatible tracks; move clips between compatible tracks; edge trimming; split at the playhead; snapping; timeline zoom/scroll; track lock, visibility/mute and resize.
- Select, copy, paste, duplicate, delete, and ripple-delete clips; keyboard shortcuts; undo/redo, including single-step drag transactions.
- Live transform, opacity, rotation, color, speed, volume, and fade controls; draggable text overlays; manual caption blocks; several real color-adjustment looks.
- New/open/save/save-as project actions, autosave, sequence resolution and frame-rate settings, missing-media detection/relinking, and a documented JSON project format.
- FFmpeg export to MP4, MOV, WebM, and MKV containers; H.264/H.265/VP9/AV1 encoder choices (availability depends on the installed FFmpeg build); resolution, frame rate and bitrate controls; progress and cancellation.
- CI workflow builds/tests on Ubuntu and uploads `.deb` and `.AppImage` artifacts.

## Deliberate limitations / next milestones

This code is a functional starting point, not the complete final vision. The following are not implemented yet: GPU effects/rendering, proxy generation, advanced transitions, keyframe UI, masks/chroma key, stabilization, motion tracking, compound/nested sequences, automatic speech-to-text, text-to-speech, a recent-project home screen, export queue/resume, and hardware-encoder discovery. WebView preview uses platform codecs rather than FFmpeg decode, so unusual codecs may require proxies or conversion. Playback synchronization is designed around one project clock but still needs stress testing with long, variable-frame-rate media and many simultaneous layers. The `.deb` has an FFmpeg package dependency; AppImage users need a compatible FFmpeg available on their system because it is not statically bundled.

## Requirements

- Linux x86-64 with a GTK desktop and WebKitGTK 4.1.
- Node.js 22 and npm.
- Rust stable toolchain (`rustup`, `cargo`).
- FFmpeg and FFprobe on `PATH` for native import analysis, waveform/thumbnail generation and rendering.

### System dependencies

Ubuntu / Debian / Linux Mint:

```bash
sudo apt update
sudo apt install build-essential curl wget file pkg-config patchelf \
  libssl-dev libxdo-dev librsvg2-dev libayatana-appindicator3-dev \
  libwebkit2gtk-4.1-dev ffmpeg
```

Fedora (package names can differ slightly by release):

```bash
sudo dnf install gcc gcc-c++ make curl wget file pkgconf-pkg-config \
  openssl-devel libxdo-devel librsvg2-devel libayatana-appindicator-gtk3-devel \
  webkit2gtk4.1-devel ffmpeg
```

Arch Linux / derivatives:

```bash
sudo pacman -S --needed base-devel curl wget file openssl webkit2gtk-4.1 \
  libxdo librsvg libayatana-appindicator ffmpeg
```

Install Rust if needed:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## Run and build

```bash
npm ci
npm test
npm run build

# Browser development preview. Media import and editing work; native FFmpeg export is desktop-only.
npm run dev

# Native Linux editor (Tauri + FFmpeg)
npm run tauri:dev

# Linux packages
npm run tauri:build -- --bundles deb,appimage
```

The build artifacts are created under `src-tauri/target/release/bundle/`. The app probes for FFmpeg at startup and reports a clear status in the footer and export dialog if it is missing.

## GitHub CI

`.github/workflows/linux.yml` runs the TypeScript editing-model tests, builds the React UI, runs Rust engine tests, then builds `.deb` and `.AppImage` packages on Ubuntu 24.04. The packages are published as a downloadable workflow artifact. It runs on pushes to `main` and `arena/**`, pull requests to `main`, and manual dispatch.

## Tests and editing smoke test

Automated tests:

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Native desktop acceptance smoke test (requires a Linux desktop session and FFmpeg):

1. Start CapNux, import a local MP4, and add it to **Video 1**.
2. Press **Space**; verify that the preview shows moving source footage and its source audio.
3. Click/drag the timeline ruler and verify that the preview seeks; use left/right arrows for frame stepping.
4. Split inside the clip with **S**, move one segment, and trim either edge.
5. Add **Video track**, place an overlay clip there, then import music and place it on an audio track.
6. Add a title in **Text**; drag the title in the preview and adjust transform/color in the inspector.
7. Play the edit, save the `.capnux` project, then export and check the result in a media player.

The project model tests cover split timing (including speed changes), snapping, ripple delete, undo/redo transactions, and timecode formatting. The full desktop acceptance list above still needs execution on Linux hardware; the development container does not include Rust, WebKitGTK, or FFmpeg, so native packaging and media-render integration are delegated to the configured GitHub workflow.
