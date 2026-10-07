use serde_json::Value;

/// Derived values, `03-data-model.md` §4. Everything here is recomputed from
/// the document on every write and never accepted from the frontend (R9).
///
/// Derivation is deterministic, so a second device fed the same document
/// reaches the same values. That is the property that makes the derived
/// columns safe to cache.
/// `03-data-model.md` §4.2. Truncated at 200 000 characters, which bounds
/// both the FTS index and the cost of derivation.
pub const MAX_PLAIN_TEXT: usize = 200_000;

const MAX_TITLE: usize = 120;
const MAX_EXCERPT: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Derived {
    pub title: String,
    pub plain_text: String,
    pub excerpt: String,
    pub word_count: i64,
}

/// The text of one block, with inline marks transparent.
fn block_text(node: &Value) -> String {
    match node {
        Value::String(text) => text.clone(),
        Value::Object(obj) => match obj.get("text").and_then(Value::as_str) {
            // Invariant 6 guarantees non-empty text nodes, so an absent or
            // empty `text` here can only be a non-text node.
            Some(text) => text.to_owned(),
            None => node
                .get("content")
                .and_then(Value::as_array)
                .map(|children| children.iter().map(block_text).collect::<Vec<_>>().join(""))
                .unwrap_or_default(),
        },
        _ => String::new(),
    }
}

fn is_block(node_type: &str) -> bool {
    !matches!(node_type, "text" | "hardBreak")
}

/// `03-data-model.md` §4.2: a recursive walk of the tree. Text contributes
/// its text, marks are transparent, hard breaks contribute `\n`, and block
/// nodes terminate with `\n`.
pub fn plain_text(doc: &Value) -> String {
    let mut out = String::new();
    walk(doc, &mut out);
    if out.len() > MAX_PLAIN_TEXT {
        let mut truncated: String = out.chars().take(MAX_PLAIN_TEXT).collect();
        truncated.shrink_to_fit();
        return truncated;
    }
    out
}

fn walk(node: &Value, out: &mut String) {
    let Some(obj) = node.as_object() else {
        return;
    };
    let node_type = obj.get("type").and_then(Value::as_str).unwrap_or_default();

    if node_type == "text" {
        if let Some(text) = obj.get("text").and_then(Value::as_str) {
            out.push_str(text);
        }
        return;
    }
    if node_type == "hardBreak" {
        out.push('\n');
        return;
    }

    if let Some(children) = obj.get("content").and_then(Value::as_array) {
        for child in children {
            walk(child, out);
        }
    }
    if node_type != "doc" && is_block(node_type) {
        out.push('\n');
    }
}

/// `03-data-model.md` §4.1.
///
/// There is no title input in v1 (`04-editor.md` §7): the title is the first
/// heading, else the first non-empty block, truncated on a word boundary.
/// `title_source = 'manual'` exists for sync, where a remote device may carry
/// a typed title, and keeps whatever it is given.
pub fn title(doc: &Value, title_source: &str) -> String {
    if title_source == "manual" {
        return String::new();
    }
    let blocks = doc
        .get("content")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();

    let first_heading = blocks.iter().find(|block| {
        block.get("type").and_then(Value::as_str) == Some("heading")
            && block
                .get("attrs")
                .and_then(|attrs| attrs.get("level"))
                .and_then(Value::as_i64)
                .is_some_and(|level| (1..=3).contains(&level))
    });

    let raw = match first_heading {
        Some(heading) => block_text(heading).trim().to_owned(),
        None => blocks
            .iter()
            .map(block_text)
            .map(|text| text.trim().to_owned())
            .find(|text| !text.is_empty())
            .unwrap_or_default(),
    };

    if raw.is_empty() {
        return "Untitled".to_owned();
    }
    truncate_on_word(&raw, MAX_TITLE)
}

fn truncate_on_word(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let clipped: String = text.chars().take(max).collect();
    match clipped.rfind(' ') {
        Some(index) if index > 0 => clipped[..index].to_owned(),
        _ => clipped,
    }
}

/// `03-data-model.md` §4.3: collapsed to single spaces, truncated at 200
/// characters on a word boundary. Feeds the note list without loading whole
/// documents.
pub fn excerpt(plain: &str) -> String {
    let collapsed = plain.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= MAX_EXCERPT {
        return collapsed;
    }
    let clipped = truncate_on_word(&collapsed, MAX_EXCERPT);
    format!("{clipped}…")
}

/// `03-data-model.md` §4.3: cheap status-bar value, avoids parsing the
/// document on open.
pub fn word_count(plain: &str) -> i64 {
    plain.split_whitespace().count() as i64
}

pub fn derive(doc: &Value, title_source: &str) -> Derived {
    let plain_text = plain_text(doc);
    Derived {
        title: title(doc, title_source),
        excerpt: excerpt(&plain_text),
        word_count: word_count(&plain_text),
        plain_text,
    }
}
