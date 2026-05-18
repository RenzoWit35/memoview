use std::sync::Mutex;

use super::VaultWatcher;

/// Holds the currently-active watcher. Replacing it drops the previous
/// debouncer, which stops the OS-level watch and lets the classify task drain.
#[derive(Default)]
pub struct WatcherHandle(Mutex<Option<VaultWatcher>>);

impl WatcherHandle {
    pub fn swap(&self, w: VaultWatcher) {
        let mut guard = self.0.lock().expect("WatcherHandle poisoned");
        *guard = Some(w);
    }
}
