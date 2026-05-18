mod handle;
mod state;

pub use handle::WatcherHandle;
pub use state::WatcherState;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::event::{EventKind, ModifyKind, RenameMode};
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, DebouncedEvent, Debouncer, RecommendedCache,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::error::AppResult;
use crate::graph::{self, GraphIndex};
use crate::search::SearchIndex;

/// Folders the watcher never reports on. Mirrors `vault::list`.
const SKIP_DIRS: &[&str] = &[".git", ".obsidian", "node_modules", ".trash"];

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum VaultEvent {
    Created { path: PathBuf },
    Modified { path: PathBuf, hash: String },
    Deleted { path: PathBuf },
    Renamed { from: PathBuf, to: PathBuf },
}

/// Holds a live OS-level watcher. Drop to stop watching.
pub struct VaultWatcher {
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

impl VaultWatcher {
    pub fn spawn<R: Runtime>(
        root: PathBuf,
        app: AppHandle<R>,
        state: Arc<WatcherState>,
        graph: Arc<GraphIndex>,
        search: Arc<SearchIndex>,
    ) -> AppResult<Self> {
        let (tx, mut rx) = tokio::sync::mpsc::channel::<DebouncedEvent>(1024);

        let mut debouncer = new_debouncer(
            Duration::from_millis(400),
            None,
            move |res: DebounceEventResult| match res {
                Ok(events) => {
                    for e in events {
                        if tx.blocking_send(e).is_err() {
                            // Receiver dropped — watcher is being replaced.
                            return;
                        }
                    }
                }
                Err(errors) => {
                    for err in errors {
                        eprintln!("watcher error: {err}");
                    }
                }
            },
        )
        .map_err(|e| crate::error::AppError::Other(format!("notify init: {e}")))?;

        debouncer
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| crate::error::AppError::Other(format!("notify watch: {e}")))?;

        // Classify + emit loop. Lives until the channel closes (debouncer drop).
        tokio::spawn(async move {
            while let Some(ev) = rx.recv().await {
                let out = classify(&ev, &state).await;
                for v in out {
                    if let Err(e) = app.emit("vault:event", &v) {
                        eprintln!("emit vault:event failed: {e}");
                    }
                    update_search(&v, &search).await;
                    let delta = graph::apply_event(&graph, &v);
                    if !delta.is_empty() {
                        if let Err(e) = app.emit("graph:delta", &delta) {
                            eprintln!("emit graph:delta failed: {e}");
                        }
                    }
                }
            }
        });

        Ok(Self {
            _debouncer: debouncer,
        })
    }
}

async fn update_search(ev: &VaultEvent, search: &SearchIndex) {
    match ev {
        VaultEvent::Created { path } | VaultEvent::Modified { path, .. } => {
            if let Ok(bytes) = tokio::fs::read(path).await {
                if let Ok(source) = String::from_utf8(bytes) {
                    let facts = crate::parser::parse(path, &source);
                    search.upsert(path, &facts.title, &source);
                }
            }
        }
        VaultEvent::Deleted { path } => search.remove(path),
        VaultEvent::Renamed { from, to } => {
            search.rename(from, to);
            if let Ok(bytes) = tokio::fs::read(to).await {
                if let Ok(source) = String::from_utf8(bytes) {
                    let facts = crate::parser::parse(to, &source);
                    search.upsert(to, &facts.title, &source);
                }
            }
        }
    }
}

fn is_relevant(p: &Path) -> bool {
    if p.extension().and_then(|e| e.to_str()) != Some("md") {
        return false;
    }
    for a in p.ancestors() {
        if let Some(name) = a.file_name().and_then(|n| n.to_str()) {
            if SKIP_DIRS.contains(&name) {
                return false;
            }
        }
    }
    true
}

async fn classify(ev: &DebouncedEvent, state: &WatcherState) -> Vec<VaultEvent> {
    let inner = &ev.event;
    let mut out = Vec::new();

    match inner.kind {
        EventKind::Create(_) => {
            for p in &inner.paths {
                if !is_relevant(p) {
                    continue;
                }
                if state.take_self_write(p) {
                    continue;
                }
                if let Ok(bytes) = tokio::fs::read(p).await {
                    let h = blake3::hash(&bytes).to_hex().to_string();
                    state.hashes.insert(p.clone(), h);
                }
                out.push(VaultEvent::Created { path: p.clone() });
            }
        }
        EventKind::Remove(_) => {
            for p in &inner.paths {
                if !is_relevant(p) {
                    continue;
                }
                if state.take_self_write(p) {
                    continue;
                }
                state.hashes.remove(p);
                out.push(VaultEvent::Deleted { path: p.clone() });
            }
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if inner.paths.len() >= 2 => {
            let from = &inner.paths[0];
            let to = &inner.paths[1];
            let from_md = is_relevant(from);
            let to_md = is_relevant(to);
            let self_write = state.take_self_write(from) | state.take_self_write(to);
            if self_write {
                // ignore
            } else if from_md && to_md {
                if let Some((_, h)) = state.hashes.remove(from) {
                    state.hashes.insert(to.clone(), h);
                }
                out.push(VaultEvent::Renamed {
                    from: from.clone(),
                    to: to.clone(),
                });
            } else if from_md {
                state.hashes.remove(from);
                out.push(VaultEvent::Deleted { path: from.clone() });
            } else if to_md {
                if let Ok(bytes) = tokio::fs::read(to).await {
                    let h = blake3::hash(&bytes).to_hex().to_string();
                    state.hashes.insert(to.clone(), h);
                }
                out.push(VaultEvent::Created { path: to.clone() });
            }
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
            for p in &inner.paths {
                if !is_relevant(p) {
                    continue;
                }
                if state.take_self_write(p) {
                    continue;
                }
                state.hashes.remove(p);
                out.push(VaultEvent::Deleted { path: p.clone() });
            }
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            for p in &inner.paths {
                if !is_relevant(p) {
                    continue;
                }
                if state.take_self_write(p) {
                    continue;
                }
                if let Ok(bytes) = tokio::fs::read(p).await {
                    let h = blake3::hash(&bytes).to_hex().to_string();
                    state.hashes.insert(p.clone(), h);
                }
                out.push(VaultEvent::Created { path: p.clone() });
            }
        }
        EventKind::Modify(_) => {
            for p in &inner.paths {
                if !is_relevant(p) {
                    continue;
                }
                if state.take_self_write(p) {
                    continue;
                }
                match tokio::fs::read(p).await {
                    Ok(bytes) => {
                        let h = blake3::hash(&bytes).to_hex().to_string();
                        if state.update_hash(p, h.clone()) {
                            out.push(VaultEvent::Modified {
                                path: p.clone(),
                                hash: h,
                            });
                        }
                    }
                    Err(_) => {
                        // file vanished between event and read — treat as delete
                        state.hashes.remove(p);
                        out.push(VaultEvent::Deleted { path: p.clone() });
                    }
                }
            }
        }
        _ => {}
    }

    out
}
