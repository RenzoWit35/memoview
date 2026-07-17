use once_cell::sync::Lazy;
use regex::Regex;

/// `[[Target]]`, `[[Target|Display]]`, `[[Target#heading]]`, `[[Target#^block]]`.
/// Capture 1 = inner content (target + optional pipe + optional anchor).
pub static WIKILINK: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\[\[([^\[\]\n]+?)\]\]").expect("wikilink regex")
});

/// `![[Target]]` — must be matched BEFORE `WIKILINK` (a wikilink would also match).
pub static EMBED: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"!\[\[([^\[\]\n]+?)\]\]").expect("embed regex")
});

/// Hashtag `#tag` or `#nested/tag` — alphanumeric, `_`, `-`, `/` allowed.
/// Must be preceded by start-of-line or whitespace to avoid matching `#` inside
/// inline code or URL fragments.
pub static HASHTAG: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?:^|\s)(#[A-Za-z][A-Za-z0-9_\-/]*)").expect("hashtag regex")
});

/// `[text](url)` — standard markdown link. Capture 1 = display text, 2 = url.
pub static MD_LINK: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\[([^\]\n]*)\]\(([^)\n]+)\)").expect("md link regex")
});

/// Frontmatter fence at byte 0 — YAML uses `---`, TOML uses `+++`. Two
/// separate patterns because the `regex` crate has no backreferences (a
/// single pattern with `\1` fails to compile — and that panic used to take
/// down every parse).
/// Capture 1 = body, 2 = remainder after the closing fence.
pub static FRONTMATTER_YAML: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)^---\r?\n(.*?)\r?\n---\r?\n?(.*)$").expect("yaml frontmatter regex")
});

pub static FRONTMATTER_TOML: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)^\+\+\+\r?\n(.*?)\r?\n\+\+\+\r?\n?(.*)$").expect("toml frontmatter regex")
});
