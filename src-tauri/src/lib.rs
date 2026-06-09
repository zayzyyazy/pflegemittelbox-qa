use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use base64::Engine;
use tauri::{Manager, Runtime};

fn clean_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn audio_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?
        .join("audio");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create audio dir: {e}"))?;
    Ok(dir)
}

#[tauri::command]
fn save_audio_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    call_id: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let dir = audio_dir(&app)?;
    let safe_call = clean_filename(&call_id);
    let safe_name = clean_filename(&file_name);
    let ext = Path::new(&safe_name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_else(|| ".wav".to_string());
    let mut target = dir.join(format!("{safe_call}{ext}"));
    if target.exists() {
        let incoming = bytes.len() as u64;
        if fs::metadata(&target).map(|m| m.len()).unwrap_or(0) == incoming {
            return Ok(target.to_string_lossy().to_string());
        }
        let mut index = 2;
        while target.exists() {
            target = dir.join(format!("{safe_call}-{index}{ext}"));
            index += 1;
        }
    }
    fs::write(&target, bytes).map_err(|e| format!("Could not save audio file: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn open_audio_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| format!("Could not open recording: {e}"))
}

#[tauri::command]
fn reveal_audio_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .status()
            .map_err(|e| format!("Could not reveal recording: {e}"))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    tauri_plugin_opener::open_path(
        Path::new(&path)
            .parent()
            .unwrap_or_else(|| Path::new(&path))
            .to_string_lossy()
            .to_string(),
        None::<&str>,
    )
    .map_err(|e| format!("Could not reveal recording: {e}"))
}

fn audio_mime(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "webm" => "audio/webm",
        _ => "audio/wav",
    }
}

#[tauri::command]
fn get_audio_storage_dir<R: Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    audio_dir(&app).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn audio_file_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).is_file())
}

#[tauri::command]
fn read_audio_playback_url(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Could not read audio file: {e}"))?;
    let mime = audio_mime(Path::new(&path));
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[tauri::command]
fn delete_audio_file(path: String) -> Result<bool, String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Ok(false);
    }
    fs::remove_file(p).map_err(|e| format!("Could not delete audio file: {e}"))?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_audio_file,
            open_audio_path,
            reveal_audio_path,
            read_audio_playback_url,
            get_audio_storage_dir,
            audio_file_exists,
            delete_audio_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
