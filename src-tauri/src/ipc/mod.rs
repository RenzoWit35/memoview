use std::path::PathBuf;
use std::sync::Arc;

use rayon::prelude::*;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

use crate::config;
use crate::error::{AppError, AppResult};
use crate::graph::{self, BacklinkRef, GraphIndex, GraphSnapshot};
use crate::parser;
use crate::vault::{self, ReadResult, TFile, WriteResult};
use crate::watcher::{VaultWatcher, WatcherHandle, WatcherState};

const SKIP_DIRS: &[&str] = &[".git", ".obsidian", "node_modules", ".trash"];

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
    bootstrap_vault(&app, path.clone())?;

    Ok(Some(PickResult { root: path, tree }))
}

/// (Re)build the graph from disk and arm the watcher on a vault root.
fn bootstrap_vault<R: Runtime>(app: &AppHandle<R>, root: PathBuf) -> AppResult<()> {
    let watcher_state = app.state::<Arc<WatcherState>>().inner().clone();
    let graph = app.state::<Arc<GraphIndex>>().inner().clone();
    let handle = app.state::<WatcherHandle>();

    watcher_state.clear();
    graph.clear();
    graph.set_vault_root(root.clone());

    // Parallel parse + bulk-load. Errors per-file are silently skipped.
    let md_paths: Vec<PathBuf> = WalkDir::new(&root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !SKIP_DIRS.contains(&name.as_ref())
        })
        .filter_map(|r| r.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("md"))
        .map(|e| e.path().to_path_buf())
        .collect();

    let items: Vec<(PathBuf, parser::NoteFacts)> = md_paths
        .par_iter()
        .filter_map(|p| {
            let bytes = std::fs::read(p).ok()?;
            let source = String::from_utf8(bytes).ok()?;
            let facts = parser::parse(p, &source);
            // Seed the watcher hash cache so first-touch Modify events filter cleanly.
            watcher_state
                .hashes
                .insert(p.clone(), facts.content_hash.clone());
            Some((p.clone(), facts))
        })
        .collect();

    graph::bulk_load(&graph, items);

    // Emit the initial snapshot so the renderer has the whole graph.
    let snapshot = graph.snapshot();
    let _ = app.emit("graph:snapshot", &snapshot);

    let watcher = VaultWatcher::spawn(root, app.clone(), watcher_state, graph)?;
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
    bootstrap_vault(&app, path)?;
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
    state.hashes.insert(path, result.hash.clone());
    Ok(result)
}

#[tauri::command]
pub async fn last_vault<R: Runtime>(app: AppHandle<R>) -> AppResult<Option<PathBuf>> {
    config::get_last_vault(&app)
}

#[tauri::command]
pub fn graph_snapshot(graph: State<'_, Arc<GraphIndex>>) -> GraphSnapshot {
    graph.snapshot()
}

#[tauri::command]
pub fn graph_backlinks(
    graph: State<'_, Arc<GraphIndex>>,
    path: PathBuf,
) -> Vec<BacklinkRef> {
    graph.backlinks_for_path(&path)
}
