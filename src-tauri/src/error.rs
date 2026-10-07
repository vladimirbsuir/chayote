use serde::Serialize;

/// The error contract. `10-conventions.md` §6.
///
/// Every command returns `Result<T, AppError>`. `code` is stable API: adding
/// one is safe, changing or removing one is a breaking change (R7).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Something went wrong while reading or writing your notes.")]
    Db(#[from] rusqlite::Error),

    /// Contract variants with no constructor in v1. Each is here because the
    /// frontend branches on its code, and the constructor arrives with the
    /// milestone that can produce it. `CONFLICT`, `UNAUTHENTICATED` and
    /// `NETWORK` belong to the sync phase (`07-sync-plan.md`).
    #[allow(dead_code)]
    #[error("Your notes could not be read. Try again.")]
    DbOpen(String),

    #[error("That item no longer exists.")]
    NotFound,

    #[error("{0}")]
    Validation(String),

    #[error("This note could not be opened.")]
    DocInvalid,

    #[error("This note is too large to save.")]
    DocTooLarge,

    #[error("A folder cannot be moved inside itself.")]
    CycleDetected,

    #[allow(dead_code)]
    #[error("This note changed on another device.")]
    Conflict,

    #[allow(dead_code)]
    #[error("You are not signed in.")]
    Unauthenticated,

    #[allow(dead_code)]
    #[error("The network request failed.")]
    Network,

    #[error("{0}")]
    Internal(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Db(_) => "DB_ERROR",
            Self::DbOpen(_) => "DB_ERROR",
            Self::NotFound => "NOT_FOUND",
            Self::Validation(_) => "VALIDATION",
            Self::DocInvalid => "DOC_INVALID",
            Self::DocTooLarge => "DOC_TOO_LARGE",
            Self::CycleDetected => "CYCLE_DETECTED",
            Self::Conflict => "CONFLICT",
            Self::Unauthenticated => "UNAUTHENTICATED",
            Self::Network => "NETWORK",
            Self::Internal(_) => "INTERNAL",
        }
    }

    pub fn internal(detail: impl std::fmt::Display) -> Self {
        Self::Internal(detail.to_string())
    }
}

/// The wire shape: `{ code, message, details? }`.
/// `message` is user-facing and plain; technical detail goes in `details`
/// and the log, never in what the user reads.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireError {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let details = match self {
            Self::Db(source) => Some(source.to_string()),
            Self::DbOpen(detail) | Self::Validation(detail) | Self::Internal(detail) => {
                Some(detail.clone())
            }
            _ => None,
        };
        WireError {
            code: self.code(),
            message: self.to_string(),
            details,
        }
        .serialize(serializer)
    }
}
