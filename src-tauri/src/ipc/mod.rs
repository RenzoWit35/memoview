use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

use crate::config;
use crate::error::{AppError, AppResult};
use crate::vault::{self, ReadResult, TFile, WriteResult};
use crate::watcher::{VaultWatcher, WatcherHandle, WatcherState};

/// Prompts the user to pick a vault directory. Persists the choice, arms the
/// filesystem watcher on the new root, and returns the listed tree. Returns
/// `None` if the user cancelled the picker.
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
    arm_watcher(&app, path.clone())?;

    Ok(Some(PickResult { root: path, tree }))
}

fn arm_watcher<R: Runtime>(app: &AppHandle<R>, root: PathBuf) -> AppResult<()> {
    let state = app.state::<Arc<WatcherState>>().inner().clone();
    let handle = app.state::<WatcherHandle>();
    state.clear();
    let watcher = VaultWatcher::spawn(root, app.clone(), state)?;
    handle.swap(watcher);
    Ok(())
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

/// Re-list a vault and (re)arm the filesystem watcher on its root. Used on app
/// boot to hydrate the most recently opened vault.
#[tauri::command]
pub async fn vault_open<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> AppResult<Vec<TFile>> {
    let tree = vault::list(&path)?;
    arm_watcher(&app, path)?;
    Ok(tree)
}

#[tauri::command]
pub async fn vault_read(path: PathBuf) -> AppResult<ReadResult> {
    vault::read(&path).await
}

#[tauri::command]
pub async fn vault_write(
    state: State<'_, Arc<WatcherState>>,
    path: PathBuf,
    content: String,
    precondition: Option<String>,
) -> AppResult<WriteResult> {
    // Mark ourselves before writing so the watcher's classify task ignores the echo.
    state.suppress(&path);
    let result = vault::write_atomic(&path, &content, precondition.as_deref()).await?;
    // Update the cached hash so any race-condition modify event also short-circuits.
    state.hashes.insert(path, result.hash.clone());
    Ok(result)
}

#[tauri::command]
pub async fn last_vault<R: Runtime>(app: AppHandle<R>) -> AppResult<Option<PathBuf>> {
    config::get_last_vault(&app)
}
