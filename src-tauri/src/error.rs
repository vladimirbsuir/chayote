use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Something went wrong while reading or writing your notes.")]
    Db(#[from] rusqlite::Error),

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

    #[error("The update server is not answering properly. Try again later.")]
    UpdateServer(String),

    #[error("A new version is out, but not yet for this device. Try again later.")]
    UpdateNotForDevice(String),

    #[error("The update failed its signature check, so Chayote did not install it.")]
    UpdateRejected(String),

    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    #[error("Android has not been allowed to install updates for Chayote yet.")]
    UpdatePermissionRequired,

    #[error("Something went wrong. Try again, and restart Chayote if it keeps happening.")]
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
            Self::UpdateServer(_) => "UPDATE_SERVER",
            Self::UpdateNotForDevice(_) => "UPDATE_NOT_FOR_DEVICE",
            Self::UpdateRejected(_) => "UPDATE_REJECTED",
            Self::UpdatePermissionRequired => "UPDATE_PERMISSION_REQUIRED",
            Self::Internal(_) => "INTERNAL",
        }
    }

    pub fn internal(detail: impl std::fmt::Display) -> Self {
        Self::Internal(detail.to_string())
    }

    #[cfg(target_os = "android")]
    pub fn from_detail(detail: impl std::fmt::Display) -> Self {
        Self::Internal(detail.to_string())
    }

    pub fn details(&self) -> Option<String> {
        match self {
            Self::Db(source) => Some(source.to_string()),
            Self::DbOpen(detail)
            | Self::Validation(detail)
            | Self::Internal(detail)
            | Self::Network(detail)
            | Self::UpdateServer(detail)
            | Self::UpdateNotForDevice(detail)
            | Self::UpdateRejected(detail) => Some(detail.clone()),
            _ => None,
        }
    }

    pub fn log_line(&self) -> String {
        match self.details() {
            Some(detail) => format!("{}: {detail}", self.code()),
            None => self.code().to_owned(),
        }
    }
}

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
