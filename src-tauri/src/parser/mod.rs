mod frontmatter;
mod markdown;
mod patterns;

use std::path::Path;

pub use markdown::{parse, EdgeFactKind, NoteFacts};

/// Panic-guarded [`parse`]. The watcher and indexer feed arbitrary on-disk
/// files through the parser with no other isolation, so a panic here must be
/// contained — the release profile keeps unwinding enabled for this.
pub fn try_parse(path: &Path, source: &str) -> Option<NoteFacts> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| parse(path, source))) {
        Ok(facts) => Some(facts),
        Err(_) => {
            eprintln!("parser panicked on {}; skipping", path.display());
            None
        }
    }
}
