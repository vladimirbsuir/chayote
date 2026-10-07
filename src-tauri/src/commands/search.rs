use tauri::State;

use crate::error::AppError;
use crate::repo::{SearchInput, SearchPage};

use super::Services;

#[tauri::command]
pub fn search_query(
    services: State<'_, Services>,
    input: SearchInput,
) -> Result<SearchPage, AppError> {
    services.search.query(&input)
}
