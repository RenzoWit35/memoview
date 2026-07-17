use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::error::{AppError, AppResult};

/// A single file or directory node inside the vault. The `children` field is `Some` for
/// directories (including empty ones) and `None` for files.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TFile {
    pub path: PathBuf,
    pub name: String,
    pub is_dir: bool,
    pub children: Option<Vec<TFile>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub content: String,
    /// blake3 hex (lowercase, 64 chars).
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub hash: String,
}

/// Names we never descend into. Keep this list short and well-justified — users may have
/// dotfiles they want to see (e.g. `.github`), but a few are universal noise.
const SKIP_DIRS: &[&str] = &[".git", ".obsidian", "node_modules", ".trash"];

/// Recursively list a directory, returning a nested tree of files and folders. Only `.md`
/// files are included; folders are always listed (even empty ones) so newly
/// created folders appear in the tree.
pub fn list(root: &Path) -> AppResult<Vec<TFile>> {
    if !root.exists() {
        return Err(AppError::NotFound(root.display().to_string()));
    }
    if !root.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "{} is not a directory",
            root.display()
        )));
    }

    fn walk(dir: &Path) -> AppResult<Vec<TFile>> {
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();

            if entry.file_type()?.is_dir() {
                if SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                // Empty folders are kept: freshly created folders must show up
                // in the tree so the user can put notes in them.
                let children = walk(&path)?;
                entries.push(TFile {
                    path,
                    name,
                    is_dir: true,
                    children: Some(children),
                });
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                entries.push(TFile {
                    path,
                    name,
                    is_dir: false,
                    children: None,
                });
            }
        }
        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        Ok(entries)
    }

    walk(root)
}

pub async fn read(path: &Path) -> AppResult<ReadResult> {
    let bytes = tokio::fs::read(path).await?;
    let hash = blake3::hash(&bytes).to_hex().to_string();
    let content = String::from_utf8(bytes)
        .map_err(|_| AppError::InvalidPath(format!("{} is not valid utf-8", path.display())))?;
    Ok(ReadResult { content, hash })
}

/// Write a file atomically using temp-file + rename. If `precondition` is `Some`, the
/// current on-disk content's hash must match it; otherwise [`AppError::Conflict`] is
/// returned and the file is left untouched.
pub async fn write_atomic(
    path: &Path,
    content: &str,
    precondition: Option<&str>,
) -> AppResult<WriteResult> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidPath(format!("{} has no parent", path.display())))?;

    if let Some(expected) = precondition {
        match tokio::fs::read(path).await {
            Ok(current) => {
                let actual = blake3::hash(&current).to_hex().to_string();
                if actual != expected {
                    return Err(AppError::Conflict);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // precondition assumes existing file; treat absent as conflict
                return Err(AppError::Conflict);
            }
            Err(e) => return Err(e.into()),
        }
    }

    // Build a sibling temp path so the atomic rename stays on the same filesystem.
    let mut tmp_name = std::ffi::OsString::new();
    if let Some(stem) = path.file_name() {
        tmp_name.push(stem);
    }
    tmp_name.push(format!(".tmp.{}", rand::random::<u32>()));
    let tmp_path = parent.join(tmp_name);

    let bytes = content.as_bytes();
    tokio::fs::write(&tmp_path, bytes).await?;

    // fsync the temp file before rename for durability.
    if let Ok(f) = tokio::fs::OpenOptions::new()
        .write(true)
        .open(&tmp_path)
        .await
    {
        let _ = f.sync_all().await;
    }

    if let Err(e) = tokio::fs::rename(&tmp_path, path).await {
        // best-effort cleanup; ignore errors
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(e.into());
    }

    let hash = blake3::hash(bytes).to_hex().to_string();
    Ok(WriteResult { hash })
}

/// Reject names that would escape the parent directory or are empty.
fn validate_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidPath("name is empty".to_string()));
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains('/') || trimmed.contains('\\') {
        return Err(AppError::InvalidPath(format!("invalid name: {trimmed}")));
    }
    Ok(trimmed.to_string())
}

/// Create an empty `name.md` under `parent`, auto-suffixing (`Name 1.md`,
/// `Name 2.md`, …) when the name is taken. `create_new` makes the
/// exists-check-and-create atomic, so concurrent creates can't clobber.
pub async fn create_note(parent: &Path, name: &str) -> AppResult<TFile> {
    if !parent.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "{} is not a directory",
            parent.display()
        )));
    }
    let cleaned = validate_name(name)?;
    let stem = cleaned.strip_suffix(".md").unwrap_or(&cleaned).trim_end();
    if stem.is_empty() {
        return Err(AppError::InvalidPath("name is empty".to_string()));
    }

    for i in 0..1000u32 {
        let file_name = if i == 0 {
            format!("{stem}.md")
        } else {
            format!("{stem} {i}.md")
        };
        let candidate = parent.join(&file_name);
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
            .await
        {
            Ok(_) => {
                return Ok(TFile {
                    path: candidate,
                    name: file_name,
                    is_dir: false,
                    children: None,
                })
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::InvalidPath(format!(
        "could not find a free name for {stem}.md"
    )))
}

/// Create a folder under `parent`, auto-suffixing when the name is taken.
pub async fn create_folder(parent: &Path, name: &str) -> AppResult<TFile> {
    if !parent.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "{} is not a directory",
            parent.display()
        )));
    }
    let cleaned = validate_name(name)?;

    for i in 0..1000u32 {
        let dir_name = if i == 0 {
            cleaned.clone()
        } else {
            format!("{cleaned} {i}")
        };
        let candidate = parent.join(&dir_name);
        match tokio::fs::create_dir(&candidate).await {
            Ok(()) => {
                return Ok(TFile {
                    path: candidate,
                    name: dir_name,
                    is_dir: true,
                    children: Some(Vec::new()),
                })
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::InvalidPath(format!(
        "could not find a free name for {cleaned}"
    )))
}

/// Atomically rename a file. Used by the rename-refactor flow. The watcher
/// echo for both `from` and `to` should already have been suppressed by the
/// caller.
pub async fn rename_atomic(from: &Path, to: &Path) -> AppResult<()> {
    tokio::fs::rename(from, to).await?;
    Ok(())
}

/// Returns a one-line preview by walking the vault root and counting .md files.
/// Useful for the smoke test. Not currently exposed via IPC.
#[allow(dead_code)]
pub fn count_markdown_files(root: &Path) -> usize {
    WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("md"))
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("memoview-test-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn create_note_appends_md_and_auto_suffixes() {
        let root = temp_vault();
        let a = create_note(&root, "Test").await.unwrap();
        assert_eq!(a.name, "Test.md");
        assert!(a.path.exists());

        let b = create_note(&root, "Test.md").await.unwrap();
        assert_eq!(b.name, "Test 1.md");
        assert!(b.path.exists());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn create_note_rejects_bad_names() {
        let root = temp_vault();
        assert!(create_note(&root, "").await.is_err());
        assert!(create_note(&root, "..").await.is_err());
        assert!(create_note(&root, "a/b").await.is_err());
        assert!(create_note(&root, "a\\b").await.is_err());
        assert!(create_note(&root, ".md").await.is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn create_folder_auto_suffixes_and_lists_empty() {
        let root = temp_vault();
        let a = create_folder(&root, "Notes").await.unwrap();
        assert_eq!(a.name, "Notes");
        let b = create_folder(&root, "Notes").await.unwrap();
        assert_eq!(b.name, "Notes 1");

        // Empty folders must appear in the tree listing.
        let tree = list(&root).unwrap();
        let names: Vec<&str> = tree.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"Notes"));
        assert!(names.contains(&"Notes 1"));

        std::fs::remove_dir_all(&root).unwrap();
    }
}
