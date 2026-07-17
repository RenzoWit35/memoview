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
use crate::refactor::{self, RenameReport};
use crate::search::{SearchHit, SearchIndex};
use crate::vault::{self, ReadResult, TFile, WriteResult};
use crate::watcher::{VaultWatcher, WatcherHandle, WatcherState};

const SKIP_DIRS: &[&str] = &[".git", ".obsidian", "node_modules", ".trash"];

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
    // The dialog can return either FilePath::Path or FilePath::Url (e.g.
    // `file:///C:/...` on Windows). into_path() converts both to a real PathBuf.
    let path = file_path
        .into_path()
        .map_err(|e| AppError::InvalidPath(format!("dialog returned bad path: {e}")))?;

    let tree = vault::list(&path)?;
    config::set_last_vault(&app, &path)?;
    bootstrap_vault(&app, path.clone())?;

    Ok(Some(PickResult { root: path, tree }))
}

fn bootstrap_vault<R: Runtime>(app: &AppHandle<R>, root: PathBuf) -> AppResult<()> {
    let watcher_state = app.state::<Arc<WatcherState>>().inner().clone();
    let graph = app.state::<Arc<GraphIndex>>().inner().clone();
    let search = app.state::<Arc<SearchIndex>>().inner().clone();
    let handle = app.state::<WatcherHandle>();

    watcher_state.clear();
    graph.clear();
    graph.set_vault_root(root.clone());
    search.clear();

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

    let parsed: Vec<(PathBuf, String, parser::NoteFacts)> = md_paths
        .par_iter()
        .filter_map(|p| {
            let bytes = std::fs::read(p).ok()?;
            let source = String::from_utf8(bytes).ok()?;
            // Defensive: a malformed file shouldn't crash the indexing pass.
            let facts = parser::try_parse(p, &source)?;
            watcher_state
                .hashes
                .insert(p.clone(), facts.content_hash.clone());
            Some((p.clone(), source, facts))
        })
        .collect();

    // Feed the search index alongside the graph.
    for (path, body, facts) in &parsed {
        search.upsert(path, &facts.title, body);
    }

    let items: Vec<(PathBuf, parser::NoteFacts)> =
        parsed.into_iter().map(|(p, _b, f)| (p, f)).collect();
    graph::bulk_load(&graph, items);

    let snapshot = graph.snapshot();
    let _ = app.emit("graph:snapshot", &snapshot);

    let watcher = VaultWatcher::spawn(root, app.clone(), watcher_state, graph, search)?;
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
    state.suppress(&path);
    let result = vault::write_atomic(&path, &content, precondition.as_deref()).await?;
    state.hashes.insert(path, result.hash.clone());
    Ok(result)
}

#[tauri::command]
pub async fn vault_rename(
    graph: State<'_, Arc<GraphIndex>>,
    watcher_state: State<'_, Arc<WatcherState>>,
    from: PathBuf,
    to: PathBuf,
) -> AppResult<RenameReport> {
    refactor::rename_note(
        graph.inner().clone(),
        watcher_state.inner().clone(),
        &from,
        &to,
    )
    .await
}

#[tauri::command]
pub async fn vault_create_note(parent: PathBuf, name: String) -> AppResult<TFile> {
    vault::create_note(&parent, &name).await
}

#[tauri::command]
pub async fn vault_create_folder(parent: PathBuf, name: String) -> AppResult<TFile> {
    vault::create_folder(&parent, &name).await
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
pub fn graph_backlinks(graph: State<'_, Arc<GraphIndex>>, path: PathBuf) -> Vec<BacklinkRef> {
    graph.backlinks_for_path(&path)
}

#[tauri::command]
pub fn graph_resolve_wikilink(
    graph: State<'_, Arc<GraphIndex>>,
    source: Option<PathBuf>,
    target: String,
) -> Option<PathBuf> {
    graph.resolve_wikilink(source.as_deref(), &target)
}

#[tauri::command]
pub fn search(
    index: State<'_, Arc<SearchIndex>>,
    query: String,
    limit: Option<usize>,
) -> Vec<SearchHit> {
    index.search(&query, limit.unwrap_or(50))
}
