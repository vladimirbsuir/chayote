use serde_json::Value;

pub const MAX_PLAIN_TEXT: usize = 200_000;

const MAX_TITLE: usize = 120;
const MAX_EXCERPT: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Derived {
    pub plain_text: String,
    pub excerpt: String,
    pub word_count: i64,
}

fn block_text(node: &Value) -> String {
    match node {
        Value::String(text) => text.clone(),
        Value::Object(obj) => match obj.get("text").and_then(Value::as_str) {
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

pub fn truncate_title(text: &str) -> String {
    truncate_on_word(text, MAX_TITLE)
}

pub fn leading_heading_text(doc: &Value) -> Option<String> {
    let first = doc.get("content")?.as_array()?.first()?;
    if first.get("type").and_then(Value::as_str) != Some("heading") {
        return None;
    }
    Some(block_text(first).trim().to_owned())
}

pub fn excerpt(plain: &str) -> String {
    let collapsed = plain.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= MAX_EXCERPT {
        return collapsed;
    }
    let clipped = truncate_on_word(&collapsed, MAX_EXCERPT);
    format!("{clipped}…")
}

pub fn word_count(plain: &str) -> i64 {
    plain.split_whitespace().count() as i64
}

pub fn derive(doc: &Value) -> Derived {
    let plain_text = plain_text(doc);
    Derived {
        excerpt: excerpt(&plain_text),
        word_count: word_count(&plain_text),
        plain_text,
    }
}
