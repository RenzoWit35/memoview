use std::path::{Path, PathBuf};
use std::time::Instant;

use dashmap::DashMap;

/// State shared between the IPC layer (which performs writes and must announce
/// them) and the watcher's classify task (which must ignore those announced
/// writes and skip events whose disk hash hasn't actually changed).
#[derive(Default)]
pub struct WatcherState {
    /// Paths that the app just wrote. Entries are TTL-pruned by a background
    /// task so a missed or late notify event doesn't leak them forever.
    pub self_writes: DashMap<PathBuf, Instant>,
    /// Last-known blake3 hash per path. Lets the classify task drop spurious
    /// Modified events (atomic-save patterns produce multiple events for the
    /// same byte state).
    pub hashes: DashMap<PathBuf, String>,
}

impl WatcherState {
    /// Mark `p` as just-written so the next watcher event for it is dropped.
    pub fn suppress(&self, p: &Path) {
        self.self_writes.insert(p.to_path_buf(), Instant::now());
    }

    /// Consume any self-write marker for `p`. Returns `true` if one was present.
    pub fn take_self_write(&self, p: &Path) -> bool {
        self.self_writes.remove(p).is_some()
    }

    /// Update the cached hash for `p` and return whether it actually changed.
    pub fn update_hash(&self, p: &Path, new_hash: String) -> bool {
        match self.hashes.get(p) {
            Some(existing) if existing.as_str() == new_hash.as_str() => false,
            _ => {
                self.hashes.insert(p.to_path_buf(), new_hash);
                true
            }
        }
    }

    /// Wipe all derived state. Called when the user picks a different vault.
    pub fn clear(&self) {
        self.self_writes.clear();
        self.hashes.clear();
    }
}
