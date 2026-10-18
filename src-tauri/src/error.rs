use serde::Serialize;

/// The error contract. `10-conventions.md` §6.
///
/// Every command returns `Result<T, AppError>`. `code` is stable API: adding
/// one is safe, changing or removing one is a breaking change (R7).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Something went wrong while reading or writing your notes.")]
    Db(#[from] rusqlite::Error),

    /// `DbOpen` has no constructor yet: it is here because the frontend
    /// will branch on its code the day a command can produce it, and the
    /// constructor arrives with that milestone. `NETWORK` is constructed by
    /// the sync engine. Dropped variants are not kept for history: `CONFLICT`
    /// never fired (conflicts resolve through the conflicts table and the
    /// Sync tab, not through an error), and `UNAUTHENTICATED` died with the
    /// no-accounts decision — see `07-sync-plan.md` §7.
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

    #[error("Could not reach the sync server.")]
    Network(String),

    /// Android's `REQUEST_INSTALL_PACKAGES` is not granted yet (ADR-025).
    ///
    /// Its own code rather than a `VALIDATION` one, because the frontend reads
    /// it to say a sentence about this and nothing else, and to keep offering
    /// the button rather than treating the update as failed. Adding a code is
    /// safe (`10-conventions.md` §6); this one is new in ADR-025.
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    #[error("Android has not been allowed to install updates for Chayote yet.")]
    UpdatePermissionRequired,

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
            Self::Network(_) => "NETWORK",
            Self::UpdatePermissionRequired => "UPDATE_PERMISSION_REQUIRED",
            Self::Internal(_) => "INTERNAL",
        }
    }

    pub fn internal(detail: impl std::fmt::Display) -> Self {
        Self::Internal(detail.to_string())
    }

    /// The same constructor under the name the Android call sites read best,
    /// where `internal` would look like a claim that something is broken rather
    /// than a mapping of a foreign error into the contract.
    #[cfg(target_os = "android")]
    pub fn from_detail(detail: impl std::fmt::Display) -> Self {
        Self::Internal(detail.to_string())
    }

    /// Technical detail, if any. `Display` stays user-facing by contract
    /// (R7); this is what logs and the sync status store.
    pub fn details(&self) -> Option<String> {
        match self {
            Self::Db(source) => Some(source.to_string()),
            Self::DbOpen(detail)
            | Self::Validation(detail)
            | Self::Internal(detail)
            | Self::Network(detail) => Some(detail.clone()),
            _ => None,
        }
    }

    /// One line for logs and the sync `last_error`: code plus detail, so a
    /// failure is diagnosable without reproducing it.
    pub fn log_line(&self) -> String {
        match self.details() {
            Some(detail) => format!("{}: {detail}", self.code()),
            None => self.code().to_owned(),
        }
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
        WireError {
            code: self.code(),
            message: self.to_string(),
            details: self.details(),
        }
        .serialize(serializer)
    }
}
