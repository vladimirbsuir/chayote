use serde_json::Value;

use crate::error::AppError;

/// `04-editor.md` §1.3. Enforced at load, not only at save.
pub const MAX_NODES: usize = 50_000;
pub const MAX_DEPTH: usize = 12;
pub const MAX_SERIALISED_BYTES: usize = 5 * 1024 * 1024;

const NODE_TYPES: &[&str] = &[
    "doc",
    "paragraph",
    "heading",
    "blockquote",
    "codeBlock",
    "bulletList",
    "orderedList",
    "listItem",
    "taskList",
    "taskItem",
    "horizontalRule",
    "hardBreak",
    "text",
];

const MARK_TYPES: &[&str] = &["bold", "italic", "strike", "code"];

/// Rejects a document that violates an invariant, keeping the stored version
/// untouched. The user is offered the stored one and a read-only render of
/// theirs (`04-editor.md` §8.4).
pub fn validate(doc: &Value) -> Result<(), AppError> {
    check_size(doc)?;
    let Some(obj) = doc.as_object() else {
        return Err(AppError::DocInvalid);
    };
    if obj.get("type").and_then(Value::as_str) != Some("doc") {
        return Err(AppError::DocInvalid);
    }
    let content = obj.get("content").and_then(Value::as_array);
    let Some(children) = content else {
        return Err(AppError::DocInvalid);
    };
    // Invariant 1: `doc` has at least one child.
    if children.is_empty() {
        return Err(AppError::DocInvalid);
    }

    let mut counter = Counter { nodes: 0 };
    for child in children {
        visit(child, 1, &mut counter)?;
    }
    Ok(())
}

/// Rejects a document too large to store (`04-editor.md` §8.1), keeping the
/// buffer so the user can export it as plain text.
pub fn check_size(doc: &Value) -> Result<(), AppError> {
    let bytes = serde_json::to_vec(doc).map_err(AppError::internal)?;
    if bytes.len() > MAX_SERIALISED_BYTES {
        return Err(AppError::DocTooLarge);
    }
    Ok(())
}

struct Counter {
    nodes: usize,
}

/// Unknown types are dropped rather than preserved: a document mentioning a
/// node this schema does not define is not a document this app can render.
fn visit(node: &Value, depth: usize, counter: &mut Counter) -> Result<(), AppError> {
    // Invariant 3: nesting depth ≤ 12.
    if depth > MAX_DEPTH {
        return Err(AppError::DocInvalid);
    }
    counter.nodes += 1;
    // Invariant 2: total node count ≤ 50 000.
    if counter.nodes > MAX_NODES {
        return Err(AppError::DocInvalid);
    }

    let Some(obj) = node.as_object() else {
        return Err(AppError::DocInvalid);
    };
    let Some(node_type) = obj.get("type").and_then(Value::as_str) else {
        return Err(AppError::DocInvalid);
    };
    if !NODE_TYPES.contains(&node_type) {
        return Err(AppError::DocInvalid);
    }

    if node_type == "text" {
        // Invariant 6: text nodes are non-empty.
        match obj.get("text").and_then(Value::as_str) {
            Some(text) if !text.is_empty() => {}
            _ => return Err(AppError::DocInvalid),
        }
    }

    if let Some(marks) = obj.get("marks").and_then(Value::as_array) {
        for mark in marks {
            let mark_type = mark
                .as_object()
                .and_then(|m| m.get("type"))
                .and_then(Value::as_str)
                .ok_or(AppError::DocInvalid)?;
            if !MARK_TYPES.contains(&mark_type) {
                return Err(AppError::DocInvalid);
            }
        }
    }

    if node_type == "heading" {
        match obj
            .get("attrs")
            .and_then(|a| a.get("level"))
            .and_then(Value::as_i64)
        {
            Some(1..=3) => {}
            _ => return Err(AppError::DocInvalid),
        }
    }
    if node_type == "taskItem" {
        match obj.get("attrs").and_then(|a| a.get("checked")) {
            Some(Value::Bool(_)) => {}
            _ => return Err(AppError::DocInvalid),
        }
    }

    // `04-editor.md` §1.2: `paragraph`, `heading` and `blockquote` carry an
    // `indent` level of 0–7. Absent means zero; anything else is rejected.
    if node_type == "paragraph" || node_type == "heading" || node_type == "blockquote" {
        if let Some(indent) = obj.get("attrs").and_then(|a| a.get("indent")) {
            match indent.as_i64() {
                Some(0..=7) => {}
                _ => return Err(AppError::DocInvalid),
            }
        }
    }

    if let Some(children) = obj.get("content").and_then(Value::as_array) {
        for child in children {
            visit(child, depth + 1, counter)?;
        }
    }
    Ok(())
}

/// An empty document normalises to a single empty paragraph before storage
/// (invariant 1). Callers that build a document from scratch use this.
pub fn empty_doc() -> Value {
    serde_json::json!({ "type": "doc", "content": [{ "type": "paragraph" }] })
}
