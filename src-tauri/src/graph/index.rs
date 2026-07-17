use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use dashmap::DashMap;
use smallvec::SmallVec;

use super::model::*;
use crate::parser::{EdgeFactKind, NoteFacts};

/// In-memory graph of the active vault. Cheap to clone via `Arc`; all mutating
/// operations take `&self` and use lock-free maps internally.
pub struct GraphIndex {
    pub(super) notes: DashMap<NoteId, Note>,
    pub(super) by_path: DashMap<PathBuf, NoteId>,
    /// Lowercased title or alias → NoteIds that respond to that name.
    pub(super) by_name: DashMap<String, SmallVec<[NoteId; 2]>>,
    pub(super) out_edges: DashMap<NoteId, Vec<Edge>>,
    pub(super) in_edges: DashMap<NoteId, Vec<Edge>>,
    /// Lowercased target string → pending refs from notes whose wikilink/embed
    /// target doesn't currently resolve. When a matching note appears later we
    /// drain these and promote them to real edges.
    pub(super) unresolved: DashMap<String, Vec<UnresolvedRef>>,
    next_id: AtomicU32,
    vault_root: Mutex<Option<PathBuf>>,
}

#[derive(Clone, Debug)]
pub(super) struct UnresolvedRef {
    pub from: NoteId,
    pub kind: EdgeKind,
    pub byte_start: u32,
    pub byte_end: u32,
    pub raw: String,
    /// The exact target string (case preserved). Kept so M6's rename refactor
    /// can rewrite mentions even when they've been provisionally unresolved.
    #[allow(dead_code)]
    pub target: String,
}

impl GraphIndex {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            notes: DashMap::new(),
            by_path: DashMap::new(),
            by_name: DashMap::new(),
            out_edges: DashMap::new(),
            in_edges: DashMap::new(),
            unresolved: DashMap::new(),
            next_id: AtomicU32::new(1),
            vault_root: Mutex::new(None),
        })
    }

    pub fn set_vault_root(&self, root: PathBuf) {
        *self.vault_root.lock().unwrap() = Some(root);
    }

    #[allow(dead_code)]
    pub fn vault_root(&self) -> Option<PathBuf> {
        self.vault_root.lock().unwrap().clone()
    }

    pub fn clear(&self) {
        self.notes.clear();
        self.by_path.clear();
        self.by_name.clear();
        self.out_edges.clear();
        self.in_edges.clear();
        self.unresolved.clear();
        self.next_id.store(1, Ordering::Relaxed);
    }

    pub fn id_for_path(&self, path: &Path) -> Option<NoteId> {
        self.by_path.get(path).map(|r| *r)
    }

    pub fn note_view(&self, id: NoteId) -> Option<NoteView> {
        self.notes.get(&id).map(|r| NoteView::from(r.value()))
    }

    pub fn path_for(&self, id: NoteId) -> Option<PathBuf> {
        self.notes.get(&id).map(|r| r.path.clone())
    }

    pub fn in_edges_for(&self, id: NoteId) -> Vec<Edge> {
        self.in_edges.get(&id).map(|r| r.clone()).unwrap_or_default()
    }

    /// Resolve a wikilink target to a path, applying the same preference rules
    /// as the internal resolver. The optional source path biases the search
    /// toward same-folder matches.
    pub fn resolve_wikilink(&self, source: Option<&Path>, target: &str) -> Option<PathBuf> {
        let key = target.to_lowercase();
        let candidates: Vec<NoteId> = self
            .by_name
            .get(&key)
            .map(|r| r.iter().copied().collect::<Vec<_>>())
            .unwrap_or_default();
        if candidates.is_empty() {
            return None;
        }
        if candidates.len() == 1 {
            return self.path_for(candidates[0]);
        }
        if let Some(src) = source {
            let src_dir = src.parent();
            for id in &candidates {
                if let Some(p) = self.path_for(*id) {
                    if p.parent() == src_dir {
                        return Some(p);
                    }
                }
            }
        }
        self.path_for(candidates[0])
    }

    /// Resolve a standard markdown link target (a vault-relative path such as
    /// `../Research/Note.md`, possibly percent-encoded and possibly carrying a
    /// `#anchor`) from a source note to a real path.
    pub fn resolve_md_link_from(&self, source: &Path, target: &str) -> Option<PathBuf> {
        let id = self.id_for_path(source)?;
        let decoded = percent_decode(target);
        let stripped = decoded.split('#').next().unwrap_or("");
        if stripped.is_empty() {
            return None;
        }
        self.resolve_md_link(id, stripped)
            .or_else(|| self.resolve_md_link(id, target))
            .and_then(|to| self.path_for(to))
    }

    pub fn record_hash(&self, path: &Path, hash: String) {
        if let Some(id) = self.id_for_path(path) {
            if let Some(mut n) = self.notes.get_mut(&id) {
                n.content_hash = hash;
            }
        }
    }

    pub fn next_id(&self) -> NoteId {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Register a note in the path/name indices. Returns the id and a flag for
    /// whether it was newly created (true) or already existed (false).
    pub(super) fn upsert_note(&self, path: &Path, facts: &NoteFacts) -> (NoteId, bool) {
        if let Some(existing) = self.by_path.get(path).map(|r| *r) {
            // Existing note — refresh metadata; re-index by_name if names changed.
            let old_names = self
                .notes
                .get(&existing)
                .map(|n| collected_names(&n))
                .unwrap_or_default();
            let new_names = collected_names_from_facts(path, facts);

            for name in old_names.difference(&new_names) {
                if let Some(mut v) = self.by_name.get_mut(name) {
                    v.retain(|id| *id != existing);
                }
            }
            for name in new_names.difference(&old_names) {
                self.by_name.entry(name.clone()).or_default().push(existing);
            }

            self.notes.insert(
                existing,
                Note {
                    id: existing,
                    path: path.to_path_buf(),
                    title: facts.title.clone(),
                    aliases: facts.aliases.clone(),
                    tags: facts.tags.clone(),
                    frontmatter: facts.frontmatter.clone(),
                    content_hash: facts.content_hash.clone(),
                },
            );
            (existing, false)
        } else {
            let id = self.next_id();
            self.by_path.insert(path.to_path_buf(), id);
            for name in collected_names_from_facts(path, facts) {
                self.by_name.entry(name).or_default().push(id);
            }
            self.notes.insert(
                id,
                Note {
                    id,
                    path: path.to_path_buf(),
                    title: facts.title.clone(),
                    aliases: facts.aliases.clone(),
                    tags: facts.tags.clone(),
                    frontmatter: facts.frontmatter.clone(),
                    content_hash: facts.content_hash.clone(),
                },
            );
            (id, true)
        }
    }

    /// Resolve a wikilink/embed target string to a NoteId, applying the
    /// deterministic preference order specified in ARCHITECTURE.md §6.3:
    ///   1. Same-folder as the source.
    ///   2. Most-recently-modified by mtime (skipped here — uses path lex as
    ///      a stand-in until we wire mtime in M8).
    pub(super) fn resolve_name(&self, source: NoteId, target: &str) -> Option<NoteId> {
        let key = target.to_lowercase();
        let candidates = self.by_name.get(&key)?;
        if candidates.is_empty() {
            return None;
        }
        if candidates.len() == 1 {
            return Some(candidates[0]);
        }
        let source_dir = self
            .notes
            .get(&source)
            .and_then(|n| n.path.parent().map(|p| p.to_path_buf()));
        // Prefer same-folder.
        if let Some(dir) = source_dir.as_deref() {
            for id in candidates.iter() {
                if let Some(n) = self.notes.get(id) {
                    if n.path.parent() == Some(dir) {
                        return Some(*id);
                    }
                }
            }
        }
        // Fall back to first.
        Some(candidates[0])
    }

    pub(super) fn resolve_md_link(&self, source: NoteId, target: &str) -> Option<NoteId> {
        // Resolve relative to the source note's directory.
        let source_dir = self.notes.get(&source)?.path.parent()?.to_path_buf();
        let mut candidate = source_dir.join(target);
        // If the target lacks an .md extension and doesn't match a file, try adding it.
        if !self.by_path.contains_key(&candidate) {
            let with_md = candidate.with_extension("md");
            if self.by_path.contains_key(&with_md) {
                candidate = with_md;
            }
        }
        // Normalize `..` segments by canonicalizing the path against the vault root if possible.
        let normalized = normalize_path(&candidate);
        self.by_path.get(&normalized).map(|r| *r)
    }

    /// Build an unfiltered snapshot suitable for IPC.
    pub fn snapshot(&self) -> GraphSnapshot {
        let notes: Vec<NoteView> = self.notes.iter().map(|r| NoteView::from(r.value())).collect();

        let mut seen = HashSet::new();
        let mut edges: Vec<EdgeView> = Vec::new();
        for r in self.out_edges.iter() {
            for e in r.value() {
                let key = (e.from, e.to, e.kind);
                if seen.insert(key) {
                    edges.push(EdgeView::from(e));
                }
            }
        }
        GraphSnapshot { notes, edges }
    }

    pub fn backlinks_for_path(&self, path: &Path) -> Vec<BacklinkRef> {
        let Some(id) = self.id_for_path(path) else {
            return Vec::new();
        };
        let Some(edges) = self.in_edges.get(&id) else {
            return Vec::new();
        };
        edges
            .iter()
            .filter_map(|e| {
                let src = self.notes.get(&e.from)?;
                Some(BacklinkRef {
                    from: e.from,
                    from_path: src.path.clone(),
                    from_title: src.title.clone(),
                    kind: e.kind,
                    byte_start: e.byte_start,
                    byte_end: e.byte_end,
                })
            })
            .collect()
    }
}

fn collected_names(n: &Note) -> HashSet<String> {
    let mut s = HashSet::new();
    s.insert(n.title.to_lowercase());
    if let Some(stem) = n.path.file_stem().and_then(|x| x.to_str()) {
        s.insert(stem.to_lowercase());
    }
    for a in &n.aliases {
        s.insert(a.to_lowercase());
    }
    s
}

fn collected_names_from_facts(path: &Path, facts: &NoteFacts) -> HashSet<String> {
    let mut s = HashSet::new();
    s.insert(facts.title.to_lowercase());
    if let Some(stem) = path.file_stem().and_then(|x| x.to_str()) {
        s.insert(stem.to_lowercase());
    }
    for a in &facts.aliases {
        s.insert(a.to_lowercase());
    }
    s
}

/// Byte-level %XX decoding (`my%20note.md` → `my note.md`). Works on raw bytes
/// so a stray `%` inside a multi-byte character can't cause a panic; invalid
/// UTF-8 after decoding falls back to the original string.
fn percent_decode(s: &str) -> String {
    fn hex_val(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(hi * 16 + lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

fn normalize_path(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        use std::path::Component;
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Compute the diff between two edge sets in terms of topology — (from, to, kind)
/// triples. Used to produce minimal GraphDelta payloads.
pub(super) fn topology_diff(
    old: &[Edge],
    new: &[Edge],
) -> (Vec<EdgeView>, Vec<EdgeView>) {
    let mut old_set: HashMap<(NoteId, NoteId, EdgeKind), &Edge> = HashMap::new();
    for e in old {
        old_set.entry((e.from, e.to, e.kind)).or_insert(e);
    }
    let mut new_set: HashMap<(NoteId, NoteId, EdgeKind), &Edge> = HashMap::new();
    for e in new {
        new_set.entry((e.from, e.to, e.kind)).or_insert(e);
    }
    let added: Vec<EdgeView> = new_set
        .iter()
        .filter(|(k, _)| !old_set.contains_key(k))
        .map(|(_, e)| EdgeView::from(*e))
        .collect();
    let removed: Vec<EdgeView> = old_set
        .iter()
        .filter(|(k, _)| !new_set.contains_key(k))
        .map(|(_, e)| EdgeView::from(*e))
        .collect();
    (added, removed)
}

pub(super) fn fact_kind_to_edge(k: EdgeFactKind) -> EdgeKind {
    match k {
        EdgeFactKind::WikiLink => EdgeKind::WikiLink,
        EdgeFactKind::Embed => EdgeKind::Embed,
        EdgeFactKind::MdLink => EdgeKind::MdLink,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser;

    #[test]
    fn md_link_resolution_decodes_and_strips_anchors() {
        let g = GraphIndex::new();
        let a = PathBuf::from("/v/Projects/My Note.md");
        let b = PathBuf::from("/v/Projects/Other.md");
        let fa = parser::parse(&a, "hello");
        let fb = parser::parse(&b, "see [link](My%20Note.md)");
        g.upsert_note(&a, &fa);
        g.upsert_note(&b, &fb);

        assert_eq!(g.resolve_md_link_from(&b, "My%20Note.md"), Some(a.clone()));
        assert_eq!(g.resolve_md_link_from(&b, "My Note.md#section"), Some(a.clone()));
        assert_eq!(g.resolve_md_link_from(&b, "My Note"), Some(a.clone()));
        assert_eq!(g.resolve_md_link_from(&b, "./My Note.md"), Some(a));
        assert_eq!(g.resolve_md_link_from(&b, "missing.md"), None);
        assert_eq!(g.resolve_md_link_from(&b, "#just-an-anchor"), None);
    }
}
