use std::path::{Path, PathBuf};

use super::index::{fact_kind_to_edge, topology_diff, GraphIndex, UnresolvedRef};
use super::model::*;
use crate::parser::{self, NoteFacts};
use crate::watcher::VaultEvent;

/// Parse one file and integrate its facts into the graph. Returns the delta
/// for the renderer. If the file cannot be read (e.g. removed between event
/// and parse), returns an empty delta.
pub fn integrate_file(graph: &GraphIndex, path: &Path) -> GraphDelta {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return GraphDelta::default(),
    };
    let Ok(source) = String::from_utf8(bytes) else {
        return GraphDelta::default();
    };
    let Some(facts) = parser::try_parse(path, &source) else {
        return GraphDelta::default();
    };
    integrate(graph, path, &facts)
}

/// Variant for the bootstrap pass, where the caller has already parsed every
/// file in parallel.
pub fn bulk_load(graph: &GraphIndex, items: Vec<(PathBuf, NoteFacts)>) {
    // Phase 1: register all notes so resolve() sees them.
    let mut ids = Vec::with_capacity(items.len());
    for (path, facts) in &items {
        let (id, _) = graph.upsert_note(path, facts);
        ids.push(id);
    }
    // Phase 2: resolve and install edges.
    for ((path, facts), &id) in items.iter().zip(ids.iter()) {
        install_edges(graph, id, path, facts);
    }
}

/// Apply a watcher event to the graph, returning the delta to emit. The graph
/// may end up in an unchanged state (delta.is_empty()).
pub fn apply_event(graph: &GraphIndex, event: &VaultEvent) -> GraphDelta {
    match event {
        VaultEvent::Created { path } | VaultEvent::Modified { path, .. } => {
            integrate_file(graph, path)
        }
        VaultEvent::Deleted { path } => remove_path(graph, path),
        VaultEvent::Renamed { from, to } => {
            // Treat rename as remove+integrate. Cheap and correct.
            let mut d = remove_path(graph, from);
            let added = integrate_file(graph, to);
            merge_delta(&mut d, added);
            d
        }
    }
}

fn integrate(graph: &GraphIndex, path: &Path, facts: &NoteFacts) -> GraphDelta {
    let (id, was_new) = graph.upsert_note(path, facts);

    let old_edges: Vec<Edge> = graph
        .out_edges
        .get(&id)
        .map(|r| r.clone())
        .unwrap_or_default();

    install_edges(graph, id, path, facts);

    let new_edges: Vec<Edge> = graph
        .out_edges
        .get(&id)
        .map(|r| r.clone())
        .unwrap_or_default();

    // Promote any unresolved refs that now resolve to this note.
    let promoted = promote_unresolved(graph, id);

    let (mut edges_added, edges_removed) = topology_diff(&old_edges, &new_edges);
    edges_added.extend(promoted);

    // The note can vanish between upsert and here (concurrent delete event);
    // emit just the edge changes rather than panicking.
    let Some(view) = graph.notes.get(&id).map(|n| NoteView::from(n.value())) else {
        return GraphDelta {
            notes_added: vec![],
            notes_removed: vec![],
            notes_updated: vec![],
            edges_added,
            edges_removed,
        };
    };

    GraphDelta {
        notes_added: if was_new { vec![view.clone()] } else { vec![] },
        notes_removed: vec![],
        notes_updated: if was_new { vec![] } else { vec![view] },
        edges_added,
        edges_removed,
    }
}

fn install_edges(graph: &GraphIndex, source: NoteId, _path: &Path, facts: &NoteFacts) {
    // Drop and re-build the source's out_edges, mirroring in_edges accordingly.
    let prev = graph.out_edges.insert(source, Vec::new()).unwrap_or_default();
    for e in &prev {
        if let Some(mut v) = graph.in_edges.get_mut(&e.to) {
            v.retain(|x| !(x.from == source && x.byte_start == e.byte_start));
        }
    }
    // Also drop any unresolved refs that originated from this source.
    graph
        .unresolved
        .iter_mut()
        .for_each(|mut r| r.retain(|u| u.from != source));
    graph.unresolved.retain(|_, v| !v.is_empty());

    let mut out: Vec<Edge> = Vec::with_capacity(facts.edges.len());
    for fact in &facts.edges {
        let kind = fact_kind_to_edge(fact.kind);
        let resolved = match fact.kind {
            crate::parser::EdgeFactKind::WikiLink | crate::parser::EdgeFactKind::Embed => {
                graph.resolve_name(source, &fact.target)
            }
            crate::parser::EdgeFactKind::MdLink => graph.resolve_md_link(source, &fact.target),
        };

        match resolved {
            Some(to) => {
                let edge = Edge {
                    from: source,
                    to,
                    kind,
                    byte_start: fact.byte_start,
                    byte_end: fact.byte_end,
                    raw: fact.raw.clone(),
                };
                graph.in_edges.entry(to).or_default().push(edge.clone());
                out.push(edge);
            }
            None => {
                let key = fact.target.to_lowercase();
                graph.unresolved.entry(key).or_default().push(UnresolvedRef {
                    from: source,
                    kind,
                    byte_start: fact.byte_start,
                    byte_end: fact.byte_end,
                    raw: fact.raw.clone(),
                    target: fact.target.clone(),
                });
            }
        }
    }
    graph.out_edges.insert(source, out);
}

fn promote_unresolved(graph: &GraphIndex, id: NoteId) -> Vec<EdgeView> {
    let names: Vec<String> = {
        let Some(note) = graph.notes.get(&id) else {
            return vec![];
        };
        let mut s: Vec<String> = vec![note.title.to_lowercase()];
        if let Some(stem) = note.path.file_stem().and_then(|x| x.to_str()) {
            s.push(stem.to_lowercase());
        }
        for a in &note.aliases {
            s.push(a.to_lowercase());
        }
        s
    };

    let mut promoted = Vec::new();
    for name in names {
        let Some((_, refs)) = graph.unresolved.remove(&name) else {
            continue;
        };
        for r in refs {
            let edge = Edge {
                from: r.from,
                to: id,
                kind: r.kind,
                byte_start: r.byte_start,
                byte_end: r.byte_end,
                raw: r.raw.clone(),
            };
            graph
                .in_edges
                .entry(id)
                .or_default()
                .push(edge.clone());
            graph.out_edges.entry(r.from).or_default().push(edge.clone());
            promoted.push(EdgeView::from(&edge));
        }
    }
    promoted
}

fn remove_path(graph: &GraphIndex, path: &Path) -> GraphDelta {
    let Some((_, id)) = graph.by_path.remove(path) else {
        return GraphDelta::default();
    };

    // De-index names.
    let names: Vec<String> = graph
        .notes
        .get(&id)
        .map(|n| {
            let mut s: Vec<String> = vec![n.title.to_lowercase()];
            if let Some(stem) = n.path.file_stem().and_then(|x| x.to_str()) {
                s.push(stem.to_lowercase());
            }
            for a in &n.aliases {
                s.push(a.to_lowercase());
            }
            s
        })
        .unwrap_or_default();
    for name in &names {
        if let Some(mut v) = graph.by_name.get_mut(name) {
            v.retain(|x| *x != id);
        }
    }

    // Yank outgoing edges.
    let outs = graph.out_edges.remove(&id).map(|(_, v)| v).unwrap_or_default();
    let mut edges_removed: Vec<EdgeView> = outs.iter().map(EdgeView::from).collect();
    for e in &outs {
        if let Some(mut v) = graph.in_edges.get_mut(&e.to) {
            v.retain(|x| !(x.from == id && x.byte_start == e.byte_start));
        }
    }

    // Incoming edges become unresolved (target name lost).
    let ins = graph.in_edges.remove(&id).map(|(_, v)| v).unwrap_or_default();
    for e in &ins {
        edges_removed.push(EdgeView::from(e));
        // Best-effort: record an unresolved ref keyed by the title of the
        // removed note so a future re-creation can promote them back.
        let key = names.first().cloned().unwrap_or_default();
        if !key.is_empty() {
            graph
                .unresolved
                .entry(key.clone())
                .or_default()
                .push(UnresolvedRef {
                    from: e.from,
                    kind: e.kind,
                    byte_start: e.byte_start,
                    byte_end: e.byte_end,
                    raw: e.raw.clone(),
                    target: e.raw.trim_start_matches('!').trim_start_matches("[[").trim_end_matches("]]").to_string(),
                });
        }
    }

    // Topology dedup for the snapshot.
    let mut seen = std::collections::HashSet::new();
    edges_removed.retain(|e| seen.insert((e.from, e.to, e.kind)));

    graph.notes.remove(&id);

    GraphDelta {
        notes_added: vec![],
        notes_removed: vec![id],
        notes_updated: vec![],
        edges_added: vec![],
        edges_removed,
    }
}

fn merge_delta(into: &mut GraphDelta, mut other: GraphDelta) {
    into.notes_added.append(&mut other.notes_added);
    into.notes_removed.append(&mut other.notes_removed);
    into.notes_updated.append(&mut other.notes_updated);
    into.edges_added.append(&mut other.edges_added);
    into.edges_removed.append(&mut other.edges_removed);
}
