use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

#[derive(Default, Clone)]
struct ExportManager {
    jobs: Arc<Mutex<HashMap<String, ExportJob>>>,
}

#[derive(Clone)]
struct ExportJob {
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaInfo {
    name: String,
    kind: String,
    duration: f64,
    width: u32,
    height: u32,
    frame_rate: f64,
    has_audio: bool,
    size: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Project {
    #[serde(default)]
    name: String,
    width: u32,
    height: u32,
    frame_rate: f64,
    #[serde(default)]
    assets: Vec<Asset>,
    #[serde(default)]
    tracks: Vec<Track>,
    #[serde(default)]
    clips: Vec<Clip>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Asset {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    path: Option<String>,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    has_audio: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Track {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    kind: String,
    #[serde(default = "default_true")]
    visible: bool,
    #[serde(default)]
    muted: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Clip {
    #[serde(default)]
    id: String,
    asset_id: Option<String>,
    track_id: String,
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    start: f64,
    #[serde(default)]
    source_in: f64,
    #[serde(default)]
    source_out: f64,
    #[serde(default = "default_speed")]
    speed: f64,
    #[serde(default = "default_one")]
    volume: f64,
    #[serde(default = "default_one")]
    opacity: f64,
    #[serde(default = "default_one")]
    scale: f64,
    #[serde(default)]
    rotation: f64,
    #[serde(default)]
    position_x: f64,
    #[serde(default)]
    position_y: f64,
    #[serde(default)]
    brightness: f64,
    #[serde(default = "default_one")]
    contrast: f64,
    #[serde(default = "default_one")]
    saturation: f64,
    #[serde(default)]
    fade_in: f64,
    #[serde(default)]
    fade_out: f64,
    #[serde(default)]
    text: String,
    #[serde(default = "default_font_size")]
    font_size: f64,
    #[serde(default)]
    font_family: String,
    #[serde(default = "default_color")]
    color: String,
    #[serde(default)]
    align: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportSettings {
    width: u32,
    height: u32,
    fps: f64,
    codec: String,
    container: String,
    video_bitrate: String,
    audio_bitrate: String,
}

#[derive(Clone)]
struct PreparedMediaClip {
    clip: Clip,
    asset: Asset,
    track: Track,
    input_index: usize,
    render_video: bool,
    render_audio: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExportEvent {
    job_id: String,
    progress: f64,
    status: String,
    message: Option<String>,
    output_path: Option<String>,
}

fn default_true() -> bool { true }
fn default_one() -> f64 { 1.0 }
fn default_speed() -> f64 { 1.0 }
fn default_font_size() -> f64 { 72.0 }
fn default_color() -> String { "#ffffff".to_string() }

#[tauri::command]
fn check_ffmpeg() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn allow_media_paths(app: AppHandle, paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut missing = Vec::new();
    for path in paths {
        let file = PathBuf::from(&path);
        if !file.exists() {
            missing.push(path);
            continue;
        }
        app.asset_protocol_scope()
            .allow_file(&file)
            .map_err(|error| format!("Could not authorize media path {}: {error}", file.display()))?;
    }
    Ok(missing)
}

#[tauri::command]
async fn probe_media(app: AppHandle, path: String) -> Result<MediaInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = PathBuf::from(&path);
        let metadata = fs::metadata(&file).map_err(|error| format!("Cannot open media file: {error}"))?;
        if !metadata.is_file() {
            return Err("The selected path is not a regular file.".to_string());
        }
        app.asset_protocol_scope()
            .allow_file(&file)
            .map_err(|error| format!("Could not authorize the selected file: {error}"))?;
        probe_media_info(&file, metadata.len())
    }).await.map_err(|error| format!("Media probe task failed: {error}"))?
}

fn probe_media_info(path: &Path, size: u64) -> Result<MediaInfo, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v", "error", "-show_entries",
            "format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate,duration",
            "-of", "json",
        ])
        .arg(path)
        .output()
        .map_err(|error| format!("Could not start ffprobe. Install FFmpeg: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Could not read media metadata: {error}"))?;
    let streams = parsed.get("streams").and_then(|value| value.as_array()).cloned().unwrap_or_default();
    let video = streams.iter().find(|stream| stream.get("codec_type").and_then(|value| value.as_str()) == Some("video"));
    let audio = streams.iter().any(|stream| stream.get("codec_type").and_then(|value| value.as_str()) == Some("audio"));
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let still_image = matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" | "avif" | "tif" | "tiff");
    let format_duration = parsed.get("format").and_then(|format| format.get("duration")).and_then(value_as_f64).unwrap_or(0.0);
    let stream_duration = streams.iter()
        .filter_map(|stream| stream.get("duration").and_then(value_as_f64))
        .fold(0.0_f64, f64::max);
    let mut duration = format_duration.max(stream_duration);
    if still_image { duration = 5.0; }
    if duration <= 0.0 { duration = 5.0; }
    let width = video.and_then(|stream| stream.get("width").and_then(|value| value.as_u64())).unwrap_or(0) as u32;
    let height = video.and_then(|stream| stream.get("height").and_then(|value| value.as_u64())).unwrap_or(0) as u32;
    let frame_rate = video
        .and_then(|stream| stream.get("avg_frame_rate").or_else(|| stream.get("r_frame_rate")))
        .and_then(|value| value.as_str())
        .map(parse_frame_rate)
        .unwrap_or(30.0);
    let has_video = video.is_some();
    if !has_video && !audio {
        return Err("FFprobe did not find an audio or video stream in this file.".to_string());
    }
    let kind = if still_image { "image" } else if has_video { "video" } else { "audio" };
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("Imported media").to_string();
    Ok(MediaInfo { name, kind: kind.to_string(), duration, width, height, frame_rate, has_audio: audio, size })
}

fn value_as_f64(value: &serde_json::Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
}

fn parse_frame_rate(value: &str) -> f64 {
    let mut parts = value.split('/');
    let numerator = parts.next().and_then(|part| part.parse::<f64>().ok()).unwrap_or(30.0);
    let denominator = parts.next().and_then(|part| part.parse::<f64>().ok()).unwrap_or(1.0);
    if denominator == 0.0 { 30.0 } else { (numerator / denominator).clamp(1.0, 240.0) }
}

#[tauri::command]
async fn generate_thumbnails(path: String, count: usize) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
    let file = PathBuf::from(&path);
    let metadata = fs::metadata(&file).map_err(|error| error.to_string())?;
    let info = probe_media_info(&file, metadata.len())?;
    if info.kind == "audio" { return Ok(Vec::new()); }
    let samples = count.clamp(1, 8);
    let mut thumbnails = Vec::with_capacity(samples);
    for index in 0..samples {
        let seconds = if info.kind == "image" {
            0.0
        } else {
            (((index + 1) as f64 / (samples + 1) as f64) * info.duration).clamp(0.03, (info.duration - 0.03).max(0.03))
        };
        let output = Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-ss"])
            .arg(format!("{seconds:.3}"))
            .arg("-i")
            .arg(&file)
            .args(["-frames:v", "1", "-vf", "scale=240:240:force_original_aspect_ratio=decrease", "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"])
            .output()
            .map_err(|error| format!("Could not generate a thumbnail: {error}"))?;
        if output.status.success() && !output.stdout.is_empty() {
            thumbnails.push(format!("data:image/jpeg;base64,{}", BASE64.encode(output.stdout)));
        }
    }
    Ok(thumbnails)
    }).await.map_err(|error| format!("Thumbnail task failed: {error}"))?
}

#[tauri::command]
async fn generate_waveform(path: String, bins: usize) -> Result<Vec<f32>, String> {
    tauri::async_runtime::spawn_blocking(move || {
    let file = PathBuf::from(path);
    let bins = bins.clamp(32, 512);
    let output = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(&file)
        .args(["-vn", "-ac", "1", "-ar", "1000", "-f", "f32le", "pipe:1"])
        .output()
        .map_err(|error| format!("Could not decode audio for waveform: {error}"))?;
    if !output.status.success() || output.stdout.len() < 4 {
        return Ok(Vec::new());
    }
    let samples: Vec<f32> = output.stdout.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]).abs())
        .filter(|sample| sample.is_finite())
        .collect();
    if samples.is_empty() { return Ok(Vec::new()); }
    let peak = samples.iter().copied().fold(0.0_f32, f32::max).max(0.0001);
    let mut waveform = Vec::with_capacity(bins);
    for index in 0..bins {
        let start = index * samples.len() / bins;
        let end = ((index + 1) * samples.len() / bins).max(start + 1).min(samples.len());
        let value = samples[start..end].iter().copied().fold(0.0_f32, f32::max) / peak;
        waveform.push(value.clamp(0.0, 1.0));
    }
    Ok(waveform)
    }).await.map_err(|error| format!("Waveform task failed: {error}"))?
}

#[tauri::command]
async fn read_project_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fs::read_to_string(&path).map_err(|error| format!("Could not read project file: {error}")))
        .await.map_err(|error| format!("Project read task failed: {error}"))?
}

#[tauri::command]
async fn write_project_file(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
    let destination = PathBuf::from(&path);
    let parent = destination.parent().ok_or_else(|| "Project path has no parent directory.".to_string())?;
    if !parent.exists() {
        return Err("The selected project folder no longer exists.".to_string());
    }
    let file_name = destination.file_name().and_then(|value| value.to_str()).ok_or_else(|| "Invalid project filename.".to_string())?;
    let temporary = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let mut file = fs::File::create(&temporary).map_err(|error| format!("Could not create project file: {error}"))?;
    if let Err(error) = file.write_all(content.as_bytes()).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Could not write project file: {error}"));
    }
    fs::rename(&temporary, &destination).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Could not finish saving project: {error}")
    })
    }).await.map_err(|error| format!("Project write task failed: {error}"))?
}

#[tauri::command]
fn start_export(
    app: AppHandle,
    manager: State<'_, ExportManager>,
    project: Project,
    output_path: String,
    settings: ExportSettings,
) -> Result<String, String> {
    if !check_ffmpeg() {
        return Err("FFmpeg is not installed or is not available on PATH.".to_string());
    }
    let (arguments, duration) = build_export_arguments(&project, &settings, &output_path)?;
    let job_id = Uuid::new_v4().to_string();
    let mut process = Command::new("ffmpeg")
        .args(&arguments)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start FFmpeg: {error}"))?;
    let stdout = process.stdout.take().ok_or_else(|| "Could not open FFmpeg progress stream.".to_string())?;
    let stderr = process.stderr.take().ok_or_else(|| "Could not open FFmpeg error stream.".to_string())?;
    let child = Arc::new(Mutex::new(process));
    let cancelled = Arc::new(AtomicBool::new(false));
    manager.jobs.lock().map_err(|_| "Export manager is unavailable.".to_string())?.insert(
        job_id.clone(),
        ExportJob { child: Arc::clone(&child), cancelled: Arc::clone(&cancelled) },
    );
    let jobs = Arc::clone(&manager.jobs);
    let event_app = app.clone();
    let thread_job_id = job_id.clone();
    let output_for_thread = output_path.clone();
    std::thread::spawn(move || {
        let error_reader = std::thread::spawn(move || {
            let mut errors = String::new();
            let _ = BufReader::new(stderr).read_to_string(&mut errors);
            errors
        });
        let reader = BufReader::new(stdout);
        let mut latest_progress = 0.0_f64;
        let mut last_emit = 0.0_f64;
        for line in reader.lines().flatten() {
            if let Some(value) = line.strip_prefix("out_time_ms=").or_else(|| line.strip_prefix("out_time_us=")) {
                if let Ok(microseconds) = value.parse::<f64>() {
                    latest_progress = ((microseconds / (duration * 1_000_000.0)) * 100.0).clamp(0.0, 99.5);
                    if latest_progress - last_emit >= 0.4 {
                        last_emit = latest_progress;
                        emit_export_event(&event_app, &thread_job_id, latest_progress, "running", Some("Rendering timeline…".to_string()), Some(output_for_thread.clone()));
                    }
                }
            }
            if cancelled.load(Ordering::Relaxed) { break; }
        }
        let exit_status = child.lock().map(|mut process| process.wait()).unwrap_or_else(|_| Err(std::io::Error::new(std::io::ErrorKind::Other, "FFmpeg process lock failed")));
        let error_text = error_reader.join().unwrap_or_default();
        let was_cancelled = cancelled.load(Ordering::Relaxed);
        let success = exit_status.map(|status| status.success()).unwrap_or(false) && !was_cancelled;
        if success {
            emit_export_event(&event_app, &thread_job_id, 100.0, "complete", Some("Export complete.".to_string()), Some(output_for_thread.clone()));
        } else if was_cancelled {
            let _ = fs::remove_file(&output_for_thread);
            emit_export_event(&event_app, &thread_job_id, latest_progress, "cancelled", Some("Export cancelled.".to_string()), Some(output_for_thread.clone()));
        } else {
            let _ = fs::remove_file(&output_for_thread);
            let message = error_text.lines().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" ");
            emit_export_event(&event_app, &thread_job_id, latest_progress, "failed", Some(if message.is_empty() { "FFmpeg could not render this timeline. Check your media and codec selection.".to_string() } else { message }), Some(output_for_thread.clone()));
        }
        if let Ok(mut map) = jobs.lock() { map.remove(&thread_job_id); }
    });
    Ok(job_id)
}

#[tauri::command]
fn cancel_export(manager: State<'_, ExportManager>, job_id: String) -> Result<(), String> {
    let job = manager.jobs.lock().map_err(|_| "Export manager is unavailable.".to_string())?
        .get(&job_id).cloned().ok_or_else(|| "Export job is no longer running.".to_string())?;
    job.cancelled.store(true, Ordering::Relaxed);
    job.child.lock().map_err(|_| "Could not access the FFmpeg process.".to_string())?
        .kill().map_err(|error| format!("Could not cancel FFmpeg: {error}"))
}

fn emit_export_event(app: &AppHandle, job_id: &str, progress: f64, status: &str, message: Option<String>, output_path: Option<String>) {
    let _ = app.emit("export-progress", ExportEvent {
        job_id: job_id.to_string(),
        progress,
        status: status.to_string(),
        message,
        output_path,
    });
}

fn build_export_arguments(project: &Project, settings: &ExportSettings, output_path: &str) -> Result<(Vec<String>, f64), String> {
    if project.clips.is_empty() { return Err("The timeline is empty.".to_string()); }
    let width = settings.width.clamp(128, 7680) / 2 * 2;
    let height = settings.height.clamp(128, 4320) / 2 * 2;
    let fps = settings.fps.clamp(1.0, 120.0);
    let tracks: HashMap<&str, &Track> = project.tracks.iter().map(|track| (track.id.as_str(), track)).collect();
    let assets: HashMap<&str, &Asset> = project.assets.iter().map(|asset| (asset.id.as_str(), asset)).collect();
    let duration = project.clips.iter()
        .map(|clip| clip.start.max(0.0) + clip_duration(clip))
        .fold(0.0_f64, f64::max);
    if duration <= 0.0 { return Err("The timeline has no renderable duration.".to_string()); }

    let mut prepared = Vec::new();
    let mut next_input = 0usize;
    for clip in &project.clips {
        if clip.kind == "text" { continue; }
        let track = tracks.get(clip.track_id.as_str()).ok_or_else(|| format!("Clip '{}' refers to a missing track.", clip.name))?;
        let asset_id = clip.asset_id.as_deref().ok_or_else(|| format!("Clip '{}' has no linked media asset.", clip.name))?;
        let asset = assets.get(asset_id).ok_or_else(|| format!("Media for '{}' is missing from the project.", clip.name))?;
        let render_video = matches!(clip.kind.as_str(), "video" | "image") && track.visible;
        let render_audio = asset.has_audio && !track.muted && clip.kind != "image" && (track.kind == "audio" || track.kind == "video");
        if !render_video && !render_audio { continue; }
        let path = asset.path.as_deref().ok_or_else(|| format!("'{}' has no saved file path. Re-import this media in the Linux app.", asset.name))?;
        if !Path::new(path).is_file() { return Err(format!("Media file not found: {path}")); }
        let input_index = next_input;
        next_input += 1;
        prepared.push(PreparedMediaClip {
            clip: clip.clone(), asset: (*asset).clone(), track: (*track).clone(), input_index, render_video, render_audio,
        });
    }

    let mut arguments: Vec<String> = vec![
        "-hide_banner".into(), "-y".into(), "-progress".into(), "pipe:1".into(), "-nostats".into(), "-loglevel".into(), "error".into(),
    ];
    for media in &prepared {
        let path = media.asset.path.as_deref().expect("path checked above");
        let source_duration = (media.clip.source_out - media.clip.source_in).max(0.05);
        if media.asset.kind == "image" {
            arguments.extend(["-loop".into(), "1".into(), "-t".into(), format_decimal(source_duration), "-i".into(), path.to_string()]);
        } else {
            arguments.extend(["-ss".into(), format_decimal(media.clip.source_in.max(0.0)), "-t".into(), format_decimal(source_duration), "-i".into(), path.to_string()]);
        }
    }

    let mut filters = Vec::new();
    filters.push(format!("color=c=black:s={width}x{height}:r={fps}:d={duration},format=rgba[base0]"));
    let mut current_video = "base0".to_string();
    let track_order: HashMap<&str, usize> = project.tracks.iter().enumerate().map(|(index, track)| (track.id.as_str(), index)).collect();
    let mut video_clips: Vec<&PreparedMediaClip> = prepared.iter().filter(|media| media.render_video).collect();
    video_clips.sort_by(|left, right| {
        let left_order = *track_order.get(left.track.id.as_str()).unwrap_or(&0);
        let right_order = *track_order.get(right.track.id.as_str()).unwrap_or(&0);
        right_order.cmp(&left_order).then_with(|| left.clip.start.total_cmp(&right.clip.start))
    });
    let mut video_sequence = 0usize;
    for media in video_clips {
        let clip = &media.clip;
        let source_duration = (clip.source_out - clip.source_in).max(0.05);
        let timeline_duration = clip_duration(clip).max(0.05);
        let speed = clip.speed.clamp(0.25, 4.0);
        let clip_label = format!("vclip{video_sequence}");
        let next_label = format!("vcomp{video_sequence}");
        let brightness = clip.brightness.clamp(-1.0, 1.0);
        let contrast = clip.contrast.clamp(0.0, 3.0);
        let saturation = clip.saturation.clamp(0.0, 3.0);
        let scale = clip.scale.clamp(0.05, 10.0);
        let opacity = clip.opacity.clamp(0.0, 1.0);
        let rotation = clip.rotation;
        filters.push(format!(
            "[{}:v:0]trim=duration={source_duration},setpts=PTS-STARTPTS,scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,scale=iw*{scale}:ih*{scale},format=rgba,colorchannelmixer=aa={opacity},eq=brightness={brightness}:contrast={contrast}:saturation={saturation},rotate={rotation}*PI/180:ow=rotw(iw):oh=roth(ih):c=none,setpts=PTS/{speed}+{}/TB[{clip_label}]",
            media.input_index, format_decimal(clip.start.max(0.0))
        ));
        let x = clip.position_x.clamp(-1000.0, 1000.0);
        let y = clip.position_y.clamp(-1000.0, 1000.0);
        let start = clip.start.max(0.0);
        let end = start + timeline_duration;
        filters.push(format!(
            "[{current_video}][{clip_label}]overlay=x='(W-w)/2+{x}*W/100':y='(H-h)/2+{y}*H/100':enable='between(t,{start},{end})':eof_action=pass:repeatlast=0:shortest=0,format=rgba[{next_label}]"
        ));
        current_video = next_label;
        video_sequence += 1;
    }

    let mut text_clips: Vec<&Clip> = project.clips.iter().filter(|clip| {
        clip.kind == "text" && tracks.get(clip.track_id.as_str()).map(|track| track.visible).unwrap_or(false) && !clip.text.trim().is_empty()
    }).collect();
    text_clips.sort_by(|left, right| {
        let left_order = *track_order.get(left.track_id.as_str()).unwrap_or(&0);
        let right_order = *track_order.get(right.track_id.as_str()).unwrap_or(&0);
        right_order.cmp(&left_order).then_with(|| left.start.total_cmp(&right.start))
    });
    for (index, clip) in text_clips.iter().enumerate() {
        let next_label = format!("textcomp{index}");
        let text = escape_drawtext(&clip.text);
        let color = sanitize_color(&clip.color);
        let font_size = (clip.font_size * height as f64 / project.height.max(1) as f64).clamp(8.0, height as f64 * 0.6);
        let family = clip.font_family.to_lowercase();
        let font = if family.contains("mono") { "DejaVu Sans Mono" } else if family.contains("serif") && !family.contains("sans") { "DejaVu Serif" } else { "DejaVu Sans" };
        let x = match clip.align.as_str() {
            "left" => format!("{width}*0.07+{}*w/100", clip.position_x),
            "right" => format!("w-text_w-{width}*0.07+{}*w/100", clip.position_x),
            _ => format!("(w-text_w)/2+{}*w/100", clip.position_x),
        };
        let y = format!("(h-text_h)/2+{}*h/100", clip.position_y);
        let start = clip.start.max(0.0);
        let end = clip.start.max(0.0) + clip_duration(clip);
        filters.push(format!(
            "[{current_video}]drawtext=font='{font}':text='{text}':fontcolor={color}:fontsize={font_size}:x='{x}':y='{y}':alpha={}:enable='between(t,{start},{end})'[{next_label}]",
            clip.opacity.clamp(0.0, 1.0)
        ));
        current_video = next_label;
    }
    filters.push(format!("[{current_video}]format=yuv420p[vout]"));

    let audio_clips: Vec<&PreparedMediaClip> = prepared.iter().filter(|media| media.render_audio).collect();
    let mut audio_labels = Vec::new();
    for (index, media) in audio_clips.iter().enumerate() {
        let clip = &media.clip;
        let source_duration = (clip.source_out - clip.source_in).max(0.05);
        let timeline_duration = clip_duration(clip).max(0.05);
        let speed = clip.speed.clamp(0.25, 4.0);
        let mut chain = format!("[{}:a:0]atrim=duration={source_duration},asetpts=PTS-STARTPTS", media.input_index);
        for tempo in atempo_filters(speed) { chain.push_str(&format!(",{tempo}")); }
        chain.push_str(&format!(",volume={}", clip.volume.clamp(0.0, 4.0)));
        if clip.fade_in > 0.0 {
            chain.push_str(&format!(",afade=t=in:st=0:d={}", clip.fade_in.min(timeline_duration)));
        }
        if clip.fade_out > 0.0 {
            let fade = clip.fade_out.min(timeline_duration);
            chain.push_str(&format!(",afade=t=out:st={}:d={fade}", (timeline_duration - fade).max(0.0)));
        }
        let delay_ms = (clip.start.max(0.0) * 1000.0).round() as u64;
        if delay_ms > 0 { chain.push_str(&format!(",adelay=delays={delay_ms}:all=1")); }
        let label = format!("aclip{index}");
        chain.push_str(&format!("[{}]", label));
        filters.push(chain);
        audio_labels.push(label);
    }
    if audio_labels.is_empty() {
        filters.push(format!("anullsrc=r=48000:cl=stereo,atrim=duration={duration}[aout]"));
    } else if audio_labels.len() == 1 {
        filters.push(format!("[{}]apad=whole_dur={duration},atrim=duration={duration},aresample=48000[aout]", audio_labels[0]));
    } else {
        let inputs = audio_labels.iter().map(|label| format!("[{label}]")).collect::<String>();
        filters.push(format!("{inputs}amix=inputs={}:duration=longest:dropout_transition=0:normalize=0,apad=whole_dur={duration},atrim=duration={duration},aresample=48000[aout]", audio_labels.len()));
    }

    arguments.extend(["-filter_complex".into(), filters.join(";")]);
    arguments.extend(["-map".into(), "[vout]".into(), "-map".into(), "[aout]".into()]);
    let codec = match settings.codec.as_str() {
        "h265" => "libx265",
        "vp9" => "libvpx-vp9",
        "av1" => "libaom-av1",
        _ => "libx264",
    };
    let container = match settings.container.as_str() { "mov" | "webm" | "mkv" => settings.container.as_str(), _ => "mp4" };
    let video_bitrate = sanitize_bitrate(&settings.video_bitrate, "12M");
    let audio_bitrate = sanitize_bitrate(&settings.audio_bitrate, "192k");
    let audio_codec = if container == "webm" { "libopus" } else { "aac" };
    arguments.extend(["-c:v".into(), codec.into(), "-b:v".into(), video_bitrate, "-pix_fmt".into(), "yuv420p".into(), "-r".into(), format_decimal(fps)]);
    match codec {
        "libx264" => arguments.extend(["-preset".into(), "veryfast".into()]),
        "libx265" => arguments.extend(["-preset".into(), "ultrafast".into()]),
        "libvpx-vp9" => arguments.extend(["-deadline".into(), "good".into(), "-cpu-used".into(), "5".into()]),
        "libaom-av1" => arguments.extend(["-cpu-used".into(), "6".into(), "-row-mt".into(), "1".into()]),
        _ => {}
    }
    arguments.extend(["-c:a".into(), audio_codec.into(), "-b:a".into(), audio_bitrate, "-t".into(), format_decimal(duration), "-threads".into(), "0".into()]);
    if matches!(container, "mp4" | "mov") { arguments.extend(["-movflags".into(), "+faststart".into()]); }
    arguments.push(output_path.to_string());
    Ok((arguments, duration))
}

fn clip_duration(clip: &Clip) -> f64 {
    let source_duration = (clip.source_out - clip.source_in).max(0.0);
    if clip.kind == "text" { source_duration } else { source_duration / clip.speed.clamp(0.25, 4.0) }
}

fn format_decimal(value: f64) -> String {
    let formatted = format!("{:.6}", value.max(0.0));
    formatted.trim_end_matches('0').trim_end_matches('.').to_string()
}

fn atempo_filters(speed: f64) -> Vec<String> {
    let mut remaining = speed.clamp(0.25, 4.0);
    let mut filters = Vec::new();
    while remaining > 2.0 {
        filters.push("atempo=2.0".to_string());
        remaining /= 2.0;
    }
    while remaining < 0.5 {
        filters.push("atempo=0.5".to_string());
        remaining /= 0.5;
    }
    if (remaining - 1.0).abs() > 0.0001 { filters.push(format!("atempo={remaining:.4}")); }
    filters
}

fn escape_drawtext(text: &str) -> String {
    let mut escaped = String::new();
    for character in text.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '\'' => escaped.push_str("\\\\'"),
            ':' => escaped.push_str("\\:"),
            ',' => escaped.push_str("\\,"),
            '[' => escaped.push_str("\\["),
            ']' => escaped.push_str("\\]"),
            ';' => escaped.push_str("\\;"),
            '%' => escaped.push_str("\\%"),
            '\n' => escaped.push_str("\\n"),
            '\r' => {},
            _ => escaped.push(character),
        }
    }
    escaped
}

fn sanitize_color(value: &str) -> String {
    let hex = value.trim().trim_start_matches('#');
    if hex.len() == 6 && hex.chars().all(|character| character.is_ascii_hexdigit()) {
        format!("0x{}", hex.to_ascii_uppercase())
    } else {
        "white".to_string()
    }
}

fn sanitize_bitrate(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if !trimmed.is_empty() && trimmed.len() <= 12 && trimmed.chars().all(|character| character.is_ascii_alphanumeric() || character == '.') {
        trimmed.to_string()
    } else {
        fallback.to_string()
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ExportManager::default())
        .invoke_handler(tauri::generate_handler![
            check_ffmpeg,
            allow_media_paths,
            probe_media,
            generate_thumbnails,
            generate_waveform,
            read_project_file,
            write_project_file,
            start_export,
            cancel_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CapNux");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_rate_parser_handles_fractional_rates() {
        assert!((parse_frame_rate("30000/1001") - 29.97002997).abs() < 0.001);
        assert_eq!(parse_frame_rate("25/1"), 25.0);
        assert_eq!(parse_frame_rate("0/0"), 30.0);
    }

    #[test]
    fn speed_audio_filters_cover_supported_range() {
        assert_eq!(atempo_filters(1.0), Vec::<String>::new());
        assert_eq!(atempo_filters(4.0), vec!["atempo=2.0", "atempo=2.0"]);
        assert_eq!(atempo_filters(0.25), vec!["atempo=0.5", "atempo=0.5"]);
        assert_eq!(atempo_filters(1.5), vec!["atempo=1.5000"]);
    }

    #[test]
    fn drawtext_escapes_filter_delimiters() {
        assert_eq!(escape_drawtext("hi, it's: 50%"), "hi\\, it\\\\'s\\: 50\\%");
        assert_eq!(sanitize_color("#12abEF"), "0x12ABEF");
        assert_eq!(sanitize_bitrate("bad;filter", "12M"), "12M");
    }

    #[test]
    fn timeline_clip_duration_respects_speed() {
        let clip = Clip {
            id: "clip".to_string(), asset_id: Some("asset".to_string()), track_id: "track".to_string(), kind: "video".to_string(), name: "clip".to_string(),
            start: 3.0, source_in: 1.0, source_out: 9.0, speed: 2.0, volume: 1.0, opacity: 1.0, scale: 1.0, rotation: 0.0,
            position_x: 0.0, position_y: 0.0, brightness: 0.0, contrast: 1.0, saturation: 1.0, fade_in: 0.0, fade_out: 0.0,
            text: String::new(), font_size: 72.0, font_family: String::new(), color: "#ffffff".to_string(), align: "center".to_string(),
        };
        assert_eq!(clip_duration(&clip), 4.0);
    }
}
