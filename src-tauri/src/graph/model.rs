use std::path::PathBuf;

use serde::Serialize;
use smallvec::SmallVec;

pub type NoteId = u32;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EdgeKind {
    WikiLink,
    Embed,
    MdLink,
}

#[derive(Clone, Debug, Serialize)]
pub struct Note {
    pub id: NoteId,
    pub path: PathBuf,
    pub title: String,
    pub aliases: SmallVec<[String; 2]>,
    pub tags: SmallVec<[String; 4]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontmatter: Option<serde_json::Value>,
    pub content_hash: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Edge {
    pub from: NoteId,
    pub to: NoteId,
    pub kind: EdgeKind,
    /// Byte offsets within the source file (for in-place rename refactor in M6).
    pub byte_start: u32,
    pub byte_end: u32,
    /// Literal source slice, e.g. `[[Foo|bar]]`.
    pub raw: String,
}

/// Snapshot row — flat view for IPC. Avoids exposing internal Note shape.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteView {
    pub id: NoteId,
    pub path: PathBuf,
    pub title: String,
    pub aliases: Vec<String>,
    pub tags: Vec<String>,
}

impl From<&Note> for NoteView {
    fn from(n: &Note) -> Self {
        Self {
            id: n.id,
            path: n.path.clone(),
            title: n.title.clone(),
            aliases: n.aliases.iter().cloned().collect(),
            tags: n.tags.iter().cloned().collect(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeView {
    pub from: NoteId,
    pub to: NoteId,
    pub kind: EdgeKind,
}

impl From<&Edge> for EdgeView {
    fn from(e: &Edge) -> Self {
        Self {
            from: e.from,
            to: e.to,
            kind: e.kind,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSnapshot {
    pub notes: Vec<NoteView>,
    pub edges: Vec<EdgeView>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphDelta {
    pub notes_added: Vec<NoteView>,
    pub notes_removed: Vec<NoteId>,
    pub notes_updated: Vec<NoteView>,
    pub edges_added: Vec<EdgeView>,
    pub edges_removed: Vec<EdgeView>,
}

impl GraphDelta {
    pub fn is_empty(&self) -> bool {
        self.notes_added.is_empty()
            && self.notes_removed.is_empty()
            && self.notes_updated.is_empty()
            && self.edges_added.is_empty()
            && self.edges_removed.is_empty()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkRef {
    pub from: NoteId,
    pub from_path: PathBuf,
    pub from_title: String,
    pub kind: EdgeKind,
    pub byte_start: u32,
    pub byte_end: u32,
}
