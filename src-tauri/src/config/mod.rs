use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::StoreExt;

use crate::error::{AppError, AppResult};

const STORE_FILE: &str = "app.json";
const KEY_LAST_VAULT: &str = "last_vault";

/// Fetch the most recently opened vault path, if any.
pub fn get_last_vault<R: Runtime>(app: &AppHandle<R>) -> AppResult<Option<PathBuf>> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Other(format!("store open: {e}")))?;
    match store.get(KEY_LAST_VAULT) {
        Some(v) => {
            if let Some(s) = v.as_str() {
                Ok(Some(PathBuf::from(s)))
            } else {
                Ok(None)
            }
        }
        None => Ok(None),
    }
}

/// Remember the currently opened vault path.
pub fn set_last_vault<R: Runtime>(app: &AppHandle<R>, path: &Path) -> AppResult<()> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Other(format!("store open: {e}")))?;
    store.set(
        KEY_LAST_VAULT,
        serde_json::Value::String(path.to_string_lossy().into_owned()),
    );
    store
        .save()
        .map_err(|e| AppError::Other(format!("store save: {e}")))?;
    Ok(())
}

/// Ensure the app config dir exists; useful on first launch.
pub fn ensure_config_dir<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Other(format!("app_config_dir: {e}")))?;
    std::fs::create_dir_all(&dir)?;
    Ok(())
}
