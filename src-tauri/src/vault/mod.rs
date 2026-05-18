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
/// files (and folders containing them) are included.
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
                let children = walk(&path)?;
                // Skip empty subtrees so the tree view stays tidy.
                if children.is_empty() {
                    continue;
                }
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
