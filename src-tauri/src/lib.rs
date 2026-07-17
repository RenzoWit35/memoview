mod config;
mod error;
mod graph;
mod ipc;
mod parser;
mod refactor;
mod search;
mod vault;
mod watcher;

use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use crate::graph::GraphIndex;
use crate::search::SearchIndex;
use crate::watcher::{WatcherHandle, WatcherState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Best-effort: ensure the config dir exists. If this fails we still let the
            // app start; the user will see a clearer error later when picking a vault.
            let _ = config::ensure_config_dir(&app.handle().clone());

            let state = Arc::new(WatcherState::default());
            app.manage(state.clone());
            app.manage(WatcherHandle::default());
            app.manage(GraphIndex::new());
            app.manage(Arc::new(SearchIndex::default()));

            // TTL pruner for stale self-write markers.
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    state
                        .self_writes
                        .retain(|_, t| t.elapsed() < Duration::from_secs(5));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::vault_pick,
            ipc::vault_list,
            ipc::vault_open,
            ipc::vault_read,
            ipc::vault_write,
            ipc::vault_rename,
            ipc::vault_create_note,
            ipc::vault_create_folder,
            ipc::last_vault,
            ipc::graph_snapshot,
            ipc::graph_backlinks,
            ipc::graph_resolve_wikilink,
            ipc::graph_resolve_md_link,
            ipc::search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running memoview");
}
