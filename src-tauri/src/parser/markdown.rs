use std::path::Path;

use comrak::nodes::{AstNode, NodeValue};
use comrak::{parse_document, Arena, ComrakOptions};
use serde::Serialize;
use smallvec::SmallVec;

use super::frontmatter;
use super::patterns::{EMBED, HASHTAG, MD_LINK, WIKILINK};

/// Everything the indexer needs about a single note. Produced by parsing the
/// raw file contents; consumed by the graph layer to upsert nodes and resolve
/// edges.
#[derive(Debug, Clone)]
pub struct NoteFacts {
    pub title: String,
    pub aliases: SmallVec<[String; 2]>,
    pub tags: SmallVec<[String; 4]>,
    pub edges: Vec<EdgeFact>,
    pub frontmatter: Option<serde_json::Value>,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EdgeFact {
    pub kind: EdgeFactKind,
    pub target: String,
    pub display: Option<String>,
    pub anchor: Option<String>,
    /// Byte offset within the original file (after frontmatter offset is added).
    pub byte_start: u32,
    pub byte_end: u32,
    pub raw: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EdgeFactKind {
    WikiLink,
    Embed,
    MdLink,
}

pub fn parse(path: &Path, source: &str) -> NoteFacts {
    let (fm, body) = frontmatter::split(source);
    // body_offset = bytes consumed by the frontmatter fence + body + closing fence.
    // Using ptr arithmetic between source and body avoids re-walking the regex.
    let body_offset = body.as_ptr() as usize - source.as_ptr() as usize;

    let mut tags: SmallVec<[String; 4]> = SmallVec::new();
    tags.extend(fm.tags.iter().cloned());

    let edges = extract_edges(body, body_offset, &mut tags);

    let title = fm.title.clone().unwrap_or_else(|| {
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string()
    });

    let content_hash = blake3::hash(source.as_bytes()).to_hex().to_string();

    NoteFacts {
        title,
        aliases: fm.aliases.clone(),
        tags,
        edges,
        frontmatter: fm.raw.clone(),
        content_hash,
    }
}

fn extract_edges(body: &str, body_offset: usize, tags: &mut SmallVec<[String; 4]>) -> Vec<EdgeFact> {
    let arena = Arena::new();
    let mut opts = ComrakOptions::default();
    opts.extension.strikethrough = true;
    opts.extension.table = true;
    opts.extension.tasklist = true;

    let root = parse_document(&arena, body, &opts);

    let line_starts = compute_line_starts(body);
    let mut skip_bytes: Vec<(usize, usize)> = Vec::new();
    collect_skip_ranges(root, &line_starts, body, &mut skip_bytes);
    skip_bytes.sort_by_key(|&(s, _)| s);

    let mut edges = Vec::new();

    // 1. Embeds — must run before WIKILINK because `![[X]]` would also match wikilink.
    for m in EMBED.find_iter(body) {
        if in_skip(m.start(), m.end(), &skip_bytes) {
            continue;
        }
        let raw = m.as_str();
        let inner = &raw[3..raw.len() - 2];
        let (target, display, anchor) = parse_link_target(inner);
        edges.push(EdgeFact {
            kind: EdgeFactKind::Embed,
            target,
            display,
            anchor,
            byte_start: (body_offset + m.start()) as u32,
            byte_end: (body_offset + m.end()) as u32,
            raw: raw.to_string(),
        });
    }

    // 2. Wikilinks — skip the ones that are actually embeds (preceded by `!`).
    for m in WIKILINK.find_iter(body) {
        if m.start() >= 1 && body.as_bytes()[m.start() - 1] == b'!' {
            continue;
        }
        if in_skip(m.start(), m.end(), &skip_bytes) {
            continue;
        }
        let raw = m.as_str();
        let inner = &raw[2..raw.len() - 2];
        let (target, display, anchor) = parse_link_target(inner);
        edges.push(EdgeFact {
            kind: EdgeFactKind::WikiLink,
            target,
            display,
            anchor,
            byte_start: (body_offset + m.start()) as u32,
            byte_end: (body_offset + m.end()) as u32,
            raw: raw.to_string(),
        });
    }

    // 3. Standard markdown links — only vault-relative ones.
    for caps in MD_LINK.captures_iter(body) {
        let m = caps.get(0).unwrap();
        if in_skip(m.start(), m.end(), &skip_bytes) {
            continue;
        }
        let url = caps.get(2).map(|x| x.as_str()).unwrap_or("").trim();
        if url.contains("://") || url.starts_with("mailto:") || url.starts_with('#') {
            continue;
        }
        edges.push(EdgeFact {
            kind: EdgeFactKind::MdLink,
            target: url.to_string(),
            display: caps.get(1).map(|x| x.as_str().to_string()),
            anchor: None,
            byte_start: (body_offset + m.start()) as u32,
            byte_end: (body_offset + m.end()) as u32,
            raw: m.as_str().to_string(),
        });
    }

    // 4. Hashtags — feed into the tags list (not edges).
    for caps in HASHTAG.captures_iter(body) {
        let tag_match = caps.get(1).unwrap();
        if in_skip(tag_match.start(), tag_match.end(), &skip_bytes) {
            continue;
        }
        let tag = tag_match.as_str().trim_start_matches('#');
        if !tags.iter().any(|t| t == tag) {
            tags.push(tag.to_string());
        }
    }

    edges
}

fn parse_link_target(inner: &str) -> (String, Option<String>, Option<String>) {
    let (left, display) = match inner.split_once('|') {
        Some((l, d)) => (l, Some(d.trim().to_string())),
        None => (inner, None),
    };
    let (target, anchor) = match left.split_once('#') {
        Some((t, a)) => (t, Some(a.trim().to_string())),
        None => (left, None),
    };
    (target.trim().to_string(), display, anchor)
}

fn collect_skip_ranges<'a>(
    node: &'a AstNode<'a>,
    line_starts: &[usize],
    body: &str,
    out: &mut Vec<(usize, usize)>,
) {
    let data = node.data.borrow();
    let sp = data.sourcepos;
    match &data.value {
        NodeValue::Code(_)
        | NodeValue::CodeBlock(_)
        | NodeValue::HtmlBlock(_)
        | NodeValue::HtmlInline(_) => {
            let start = pos_to_byte(line_starts, body, sp.start.line, sp.start.column);
            let end = pos_to_byte(line_starts, body, sp.end.line, sp.end.column.saturating_add(1));
            if end > start {
                out.push((start, end));
            }
        }
        _ => {}
    }
    drop(data);
    for child in node.children() {
        collect_skip_ranges(child, line_starts, body, out);
    }
}

fn compute_line_starts(s: &str) -> Vec<usize> {
    let mut starts = vec![0usize];
    for (i, b) in s.bytes().enumerate() {
        if b == b'\n' {
            starts.push(i + 1);
        }
    }
    starts
}

fn pos_to_byte(line_starts: &[usize], body: &str, line: usize, col: usize) -> usize {
    if line == 0 || line > line_starts.len() {
        return body.len();
    }
    let line_start = line_starts[line - 1];
    let line_end = line_starts.get(line).copied().unwrap_or(body.len());
    let line_len = line_end - line_start;
    line_start + col.saturating_sub(1).min(line_len)
}

fn in_skip(start: usize, end: usize, skip: &[(usize, usize)]) -> bool {
    skip.iter().any(|&(s, e)| start >= s && end <= e)
}
