use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("conflict: on-disk content differs from precondition")]
    Conflict,

    #[error("invalid path: {0}")]
    InvalidPath(String),

    #[error("cancelled")]
    Cancelled,

    #[error("{0}")]
    Other(String),
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
enum ErrorKind {
    Io,
    NotFound,
    Conflict,
    InvalidPath,
    Cancelled,
    Other,
}

#[derive(Serialize)]
pub struct AppErrorPayload {
    kind: ErrorKind,
    message: String,
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let kind = match self {
            AppError::Io(_) => ErrorKind::Io,
            AppError::NotFound(_) => ErrorKind::NotFound,
            AppError::Conflict => ErrorKind::Conflict,
            AppError::InvalidPath(_) => ErrorKind::InvalidPath,
            AppError::Cancelled => ErrorKind::Cancelled,
            AppError::Other(_) => ErrorKind::Other,
        };
        let payload = AppErrorPayload {
            kind,
            message: self.to_string(),
        };
        payload.serialize(s)
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Other(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
