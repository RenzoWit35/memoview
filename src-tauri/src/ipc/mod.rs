use std::path::PathBuf;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::config;
use crate::error::{AppError, AppResult};
use crate::vault::{self, ReadResult, TFile, WriteResult};

/// Prompts the user to pick a vault directory. Persists the choice and returns the listed
/// tree. Returns `None` if the user cancelled the picker.
#[tauri::command]
pub async fn vault_pick<R: Runtime>(app: AppHandle<R>) -> AppResult<Option<PickResult>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });
    let chosen = rx.await.map_err(|_| AppError::Cancelled)?;

    let Some(file_path) = chosen else {
        return Ok(None);
    };
    let path = PathBuf::from(file_path.to_string());

    let tree = vault::list(&path)?;
    config::set_last_vault(&app, &path)?;
    Ok(Some(PickResult { root: path, tree }))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickResult {
    pub root: PathBuf,
    pub tree: Vec<TFile>,
}

#[tauri::command]
pub async fn vault_list(path: PathBuf) -> AppResult<Vec<TFile>> {
    vault::list(&path)
}

#[tauri::command]
pub async fn vault_read(path: PathBuf) -> AppResult<ReadResult> {
    vault::read(&path).await
}

#[tauri::command]
pub async fn vault_write(
    path: PathBuf,
    content: String,
    precondition: Option<String>,
) -> AppResult<WriteResult> {
    vault::write_atomic(&path, &content, precondition.as_deref()).await
}

#[tauri::command]
pub async fn last_vault<R: Runtime>(app: AppHandle<R>) -> AppResult<Option<PathBuf>> {
    config::get_last_vault(&app)
}
