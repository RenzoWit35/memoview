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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn parse_plain_note_extracts_links_and_tags() {
        let p = PathBuf::from("/v/test.md");
        let facts = parse(&p, "Hello [[Other Note]] and [md](sub/other.md) #tag\n");
        assert_eq!(facts.title, "test");
        assert_eq!(facts.edges.len(), 2);
        assert_eq!(facts.edges[0].kind, EdgeFactKind::WikiLink);
        assert_eq!(facts.edges[0].target, "Other Note");
        assert_eq!(facts.edges[1].kind, EdgeFactKind::MdLink);
        assert_eq!(facts.edges[1].target, "sub/other.md");
        assert!(facts.tags.iter().any(|t| t == "tag"));
    }

    #[test]
    fn parse_yaml_frontmatter() {
        let p = PathBuf::from("/v/test.md");
        let src = "---\ntitle: Custom\ntags: [a, b]\n---\nBody [[Link]]\n";
        let facts = parse(&p, src);
        assert_eq!(facts.title, "Custom");
        assert!(facts.tags.iter().any(|t| t == "a"));
        assert_eq!(facts.edges.len(), 1);
    }

    #[test]
    fn parse_toml_frontmatter() {
        let p = PathBuf::from("/v/test.md");
        let src = "+++\ntitle = \"Toml Title\"\n+++\nBody\n";
        let facts = parse(&p, src);
        assert_eq!(facts.title, "Toml Title");
    }

    #[test]
    fn try_parse_never_panics_on_odd_input() {
        let p = PathBuf::from("/v/test.md");
        for src in ["", "---\n---\n", "# h\n\n```\n[[x]]\n```", "\u{0}\u{1}", "- [ ] task"] {
            let _ = try_parse(&p, src);
        }
    }
}
