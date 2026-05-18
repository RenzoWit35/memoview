mod config;
mod error;
mod ipc;
mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            // Best-effort: ensure the config dir exists. If this fails we still let the
            // app start; the user will see a clearer error later when picking a vault.
            let _ = config::ensure_config_dir(&app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::vault_pick,
            ipc::vault_list,
            ipc::vault_read,
            ipc::vault_write,
            ipc::last_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running memoview");
}
