use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

/// Lightweight in-memory search index. Substring-matches title + body with
/// case-insensitive comparison. Title hits weight more heavily than body hits.
/// Sufficient for vaults up to a few thousand notes; tantivy lands later.
pub struct SearchIndex {
    docs: Mutex<Vec<Doc>>,
}

struct Doc {
    path: PathBuf,
    title: String,
    title_lower: String,
    body_lower: String,
    /// Original body slice — used for building snippets around matches.
    body: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: PathBuf,
    pub title: String,
    pub snippet: String,
    pub score: u32,
}

impl Default for SearchIndex {
    fn default() -> Self {
        Self {
            docs: Mutex::new(Vec::new()),
        }
    }
}

impl SearchIndex {
    pub fn clear(&self) {
        self.docs.lock().unwrap().clear();
    }

    pub fn upsert(&self, path: &Path, title: &str, body: &str) {
        let mut docs = self.docs.lock().unwrap();
        let new_doc = Doc {
            path: path.to_path_buf(),
            title: title.to_string(),
            title_lower: title.to_lowercase(),
            body_lower: body.to_lowercase(),
            body: body.to_string(),
        };
        match docs.iter().position(|d| d.path == path) {
            Some(idx) => docs[idx] = new_doc,
            None => docs.push(new_doc),
        }
    }

    pub fn remove(&self, path: &Path) {
        let mut docs = self.docs.lock().unwrap();
        docs.retain(|d| d.path != path);
    }

    pub fn rename(&self, from: &Path, to: &Path) {
        let mut docs = self.docs.lock().unwrap();
        if let Some(doc) = docs.iter_mut().find(|d| d.path == from) {
            doc.path = to.to_path_buf();
        }
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return Vec::new();
        }
        let docs = self.docs.lock().unwrap();
        let mut hits: Vec<SearchHit> = docs
            .iter()
            .filter_map(|d| score_doc(d, &q))
            .collect();
        hits.sort_by(|a, b| b.score.cmp(&a.score));
        hits.truncate(limit);
        hits
    }
}

fn score_doc(d: &Doc, q: &str) -> Option<SearchHit> {
    let title_hits = d.title_lower.matches(q).count() as u32;
    let body_hits = d.body_lower.matches(q).count() as u32;
    let score = title_hits * 10 + body_hits;
    if score == 0 {
        return None;
    }
    let snippet = build_snippet(&d.body, &d.body_lower, q);
    Some(SearchHit {
        path: d.path.clone(),
        title: d.title.clone(),
        snippet,
        score,
    })
}

fn build_snippet(body: &str, body_lower: &str, q: &str) -> String {
    const RADIUS: usize = 60;
    let Some(idx) = body_lower.find(q) else {
        return body.chars().take(120).collect();
    };
    let start = idx.saturating_sub(RADIUS);
    let end = (idx + q.len() + RADIUS).min(body.len());
    // Snap to char boundaries to avoid panicking on multibyte.
    let start = nearest_char_boundary(body, start);
    let end = nearest_char_boundary(body, end);
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if end < body.len() { "…" } else { "" };
    let mid = body[start..end].replace('\n', " ");
    format!("{prefix}{mid}{suffix}")
}

fn nearest_char_boundary(s: &str, mut i: usize) -> usize {
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}
