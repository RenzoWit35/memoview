use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::graph::{Edge, GraphIndex, NoteId};
use crate::vault;
use crate::watcher::WatcherState;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameReport {
    pub files_rewritten: u32,
    pub occurrences: u32,
}

/// Atomically rename a note and rewrite every `[[OldTitle...]]` / `![[OldTitle...]]`
/// reference in linker files. The implementation relies on each linker's edges
/// having been recorded with byte spans during M4 parsing.
pub async fn rename_note(
    graph: Arc<GraphIndex>,
    watcher_state: Arc<WatcherState>,
    from: &Path,
    to: &Path,
) -> AppResult<RenameReport> {
    if !from.exists() {
        return Err(AppError::NotFound(from.display().to_string()));
    }
    if to.exists() {
        return Err(AppError::InvalidPath(format!(
            "{} already exists",
            to.display()
        )));
    }

    let id = graph
        .id_for_path(from)
        .ok_or_else(|| AppError::NotFound(format!("{} not in graph", from.display())))?;

    let old_title = graph
        .note_view(id)
        .map(|n| n.title)
        .unwrap_or_else(|| path_stem(from));
    let new_title = path_stem(to);

    // Suppress watcher echoes for every path we're about to touch.
    watcher_state.suppress(from);
    watcher_state.suppress(to);

    // Group inbound edges by source so each linker file is read once.
    let mut by_source: HashMap<NoteId, Vec<Edge>> = HashMap::new();
    for e in graph.in_edges_for(id) {
        by_source.entry(e.from).or_default().push(e);
    }

    let mut report = RenameReport::default();

    // Phase 1: rewrite every linker file in memory.
    let mut pending: Vec<(PathBuf, String, u32)> = Vec::new();
    for (source_id, edges) in by_source {
        let Some(src_path) = graph.path_for(source_id) else {
            continue;
        };
        let Ok(original) = vault::read(&src_path).await else {
            continue;
        };
        let rewritten = rewrite_wikilinks(&original.content, &edges, &old_title, &new_title);
        if rewritten != original.content {
            pending.push((src_path, rewritten, edges.len() as u32));
        }
    }

    // Phase 2: rename the file on disk.
    vault::rename_atomic(from, to).await?;

    // Phase 3: commit linker rewrites. If any fail, log but don't roll back —
    // the rename is already on disk and partial-update is preferable to a
    // half-renamed vault.
    for (path, content, occ) in pending {
        watcher_state.suppress(&path);
        match vault::write_atomic(&path, &content, None).await {
            Ok(res) => {
                watcher_state.hashes.insert(path.clone(), res.hash.clone());
                graph.record_hash(&path, res.hash);
                report.files_rewritten += 1;
                report.occurrences += occ;
            }
            Err(e) => {
                eprintln!(
                    "rename refactor: failed to rewrite {}: {}",
                    path.display(),
                    e
                );
            }
        }
    }

    Ok(report)
}

fn path_stem(p: &Path) -> String {
    p.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

/// Replace `[[OldTitle...]]` / `![[OldTitle...]]` with `[[NewTitle...]]` /
/// `![[NewTitle...]]`, preserving the optional `|display` and `#anchor` parts.
/// Uses the edges' stored byte spans, sorted descending so earlier edits don't
/// shift later offsets.
pub fn rewrite_wikilinks(
    source: &str,
    edges: &[Edge],
    old_title: &str,
    new_title: &str,
) -> String {
    let mut spans: Vec<(usize, usize, String)> = edges
        .iter()
        .filter_map(|e| {
            let start = e.byte_start as usize;
            let end = e.byte_end as usize;
            if start > source.len() || end > source.len() || end <= start {
                return None;
            }
            let raw = &source[start..end];
            let replaced = replace_in_link(raw, old_title, new_title)?;
            if replaced == raw {
                return None;
            }
            Some((start, end, replaced))
        })
        .collect();
    spans.sort_by(|a, b| b.0.cmp(&a.0));

    let mut out = source.to_string();
    for (s, e, replacement) in spans {
        out.replace_range(s..e, &replacement);
    }
    out
}

fn replace_in_link(raw: &str, old_title: &str, new_title: &str) -> Option<String> {
    let (prefix, inner, suffix) = if let Some(rest) = raw.strip_prefix("![[") {
        let inner = rest.strip_suffix("]]")?;
        ("![[", inner, "]]")
    } else if let Some(rest) = raw.strip_prefix("[[") {
        let inner = rest.strip_suffix("]]")?;
        ("[[", inner, "]]")
    } else {
        return None;
    };

    let (target_with_anchor, display) = match inner.split_once('|') {
        Some((t, d)) => (t, Some(d)),
        None => (inner, None),
    };
    let (target, anchor) = match target_with_anchor.split_once('#') {
        Some((t, a)) => (t, Some(a)),
        None => (target_with_anchor, None),
    };

    if !target.trim().eq_ignore_ascii_case(old_title) {
        return None;
    }

    let mut new_inner = String::new();
    new_inner.push_str(new_title);
    if let Some(a) = anchor {
        new_inner.push('#');
        new_inner.push_str(a);
    }
    if let Some(d) = display {
        new_inner.push('|');
        new_inner.push_str(d);
    }
    Some(format!("{prefix}{new_inner}{suffix}"))
}
