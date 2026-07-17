use serde::Deserialize;
use smallvec::SmallVec;

use super::patterns::{FRONTMATTER_TOML, FRONTMATTER_YAML};

/// Detected and parsed YAML/TOML frontmatter at the start of a note. Anything
/// we can't parse is left as `None` — the body is still returned and edge
/// extraction proceeds. Errors here are *never* fatal.
#[derive(Debug, Default, Clone)]
pub struct Frontmatter {
    pub title: Option<String>,
    pub aliases: SmallVec<[String; 2]>,
    pub tags: SmallVec<[String; 4]>,
    pub raw: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct FrontmatterFields {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    aliases: Option<Aliases>,
    #[serde(default)]
    tags: Option<Tags>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Aliases {
    One(String),
    Many(Vec<String>),
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Tags {
    One(String),
    Many(Vec<String>),
}

/// Returns `(frontmatter, body)`. If no fence is present, body == input and
/// frontmatter is `Frontmatter::default()`.
pub fn split(input: &str) -> (Frontmatter, &str) {
    let (captures, is_yaml) = match FRONTMATTER_YAML.captures(input) {
        Some(c) => (c, true),
        None => match FRONTMATTER_TOML.captures(input) {
            Some(c) => (c, false),
            None => return (Frontmatter::default(), input),
        },
    };
    let body_text = captures.get(1).map(|m| m.as_str()).unwrap_or("");
    let remainder_match = captures.get(2);

    // Compute the slice of `input` corresponding to the body that follows.
    // Using a regex group's end offset is robust against newline variants.
    let body_start = remainder_match.map(|m| m.start()).unwrap_or(input.len());
    let body = &input[body_start..];

    let fm = if is_yaml {
        parse_yaml(body_text)
    } else {
        parse_toml(body_text)
    };
    (fm, body)
}

fn parse_yaml(text: &str) -> Frontmatter {
    let raw: Option<serde_json::Value> = serde_yaml::from_str(text).ok();
    let fields: FrontmatterFields = serde_yaml::from_str(text).unwrap_or(FrontmatterFields {
        title: None,
        aliases: None,
        tags: None,
    });
    build(fields, raw)
}

fn parse_toml(text: &str) -> Frontmatter {
    let raw: Option<serde_json::Value> = toml::from_str(text).ok();
    let fields: FrontmatterFields = toml::from_str(text).unwrap_or(FrontmatterFields {
        title: None,
        aliases: None,
        tags: None,
    });
    build(fields, raw)
}

fn build(fields: FrontmatterFields, raw: Option<serde_json::Value>) -> Frontmatter {
    let mut aliases = SmallVec::new();
    if let Some(a) = fields.aliases {
        match a {
            Aliases::One(s) => aliases.push(s),
            Aliases::Many(v) => aliases.extend(v),
        }
    }
    let mut tags = SmallVec::new();
    if let Some(t) = fields.tags {
        match t {
            Tags::One(s) => push_tag(&mut tags, s),
            Tags::Many(v) => v.into_iter().for_each(|s| push_tag(&mut tags, s)),
        }
    }
    Frontmatter {
        title: fields.title,
        aliases,
        tags,
        raw,
    }
}

fn push_tag(tags: &mut SmallVec<[String; 4]>, raw: String) {
    let trimmed = raw.trim().trim_start_matches('#').to_string();
    if !trimmed.is_empty() {
        tags.push(trimmed);
    }
}
