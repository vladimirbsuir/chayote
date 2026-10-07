//! Names and paths that must exist in exactly one place.
//!
//! `06-platform.md` §2: the database filename is a constant, there is no
//! user-configurable data directory in v1.

#![allow(dead_code)]

pub const PRODUCT_NAME: &str = "Chayote";
pub const BUNDLE_IDENTIFIER: &str = "com.chayote.app";
pub const DB_FILENAME: &str = "chayote.db";
pub const SETTINGS_FILENAME: &str = "settings.json";
