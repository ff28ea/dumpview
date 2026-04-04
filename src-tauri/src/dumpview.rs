use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const CLASSES_FILE: &str = "ClassesInfo.json";
const STRUCTS_FILE: &str = "StructsInfo.json";
const FUNCTIONS_FILE: &str = "FunctionsInfo.json";
const ENUMS_FILE: &str = "EnumsInfo.json";
const OFFSETS_FILE: &str = "OffsetsInfo.json";
const NODE_WORKSPACES_DIR: &str = "node-workspaces";
const NODE_WORKSPACE_EXTENSION: &str = "json";

#[derive(Default)]
pub struct AppState {
    inner: Mutex<ViewerState>,
}

#[derive(Default)]
struct ViewerState {
    summary: Option<LoadSummary>,
    symbols: HashMap<String, SymbolDetail>,
    search_docs: HashMap<String, String>,
    sorted_names: Vec<String>,
    db: Option<Connection>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpImportPayload {
    pub source_label: String,
    pub classes_json: String,
    pub structs_json: String,
    pub functions_json: String,
    pub enums_json: String,
    pub offsets_json: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum SymbolKind {
    Class,
    Struct,
    Enum,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OffsetEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSummary {
    pub source_label: String,
    pub symbol_count: usize,
    pub class_count: usize,
    pub struct_count: usize,
    pub enum_count: usize,
    pub function_owner_count: usize,
    pub method_count: usize,
    pub relation_count: usize,
    pub offsets: Vec<OffsetEntry>,
    pub landing_symbol: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub name: String,
    pub kind: SymbolKind,
    pub parent: Option<String>,
    pub size: Option<u64>,
    pub field_count: usize,
    pub method_count: usize,
    pub relation_count: usize,
    pub child_count: usize,
    pub subtitle: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolLink {
    pub name: String,
    pub kind: SymbolKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldInfo {
    pub name: String,
    pub type_display: String,
    pub offset: Option<u64>,
    pub size: Option<u64>,
    pub array_dim: Option<u64>,
    pub links: Vec<SymbolLink>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParameterInfo {
    pub name: String,
    pub type_display: String,
    pub links: Vec<SymbolLink>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MethodInfo {
    pub name: String,
    pub return_type: String,
    pub return_links: Vec<SymbolLink>,
    pub parameters: Vec<ParameterInfo>,
    pub address: Option<u64>,
    pub flags: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumValueInfo {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationInfo {
    pub name: String,
    pub kind: SymbolKind,
    pub relation: String,
    pub via: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolDetail {
    pub name: String,
    pub kind: SymbolKind,
    pub size: Option<u64>,
    pub parent: Option<String>,
    pub parents: Vec<SymbolLink>,
    pub direct_children: Vec<SymbolLink>,
    pub fields: Vec<FieldInfo>,
    pub methods: Vec<MethodInfo>,
    pub enum_values: Vec<EnumValueInfo>,
    pub underlying_type: Option<String>,
    pub related: Vec<RelationInfo>,
    pub incoming_refs: Vec<RelationInfo>,
    pub field_count: usize,
    pub method_count: usize,
    pub relation_count: usize,
    pub child_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeWorkspaceDocument {
    pub id: String,
    pub title: String,
    pub source_label: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub nodes: Vec<NodeWorkspaceNode>,
    pub edges: Vec<NodeWorkspaceEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeWorkspaceNode {
    pub id: String,
    pub symbol_name: String,
    pub x: f64,
    pub y: f64,
    pub selected_field_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeWorkspaceEdge {
    pub id: String,
    pub source_node_id: String,
    pub source_handle_id: Option<String>,
    pub target_node_id: String,
    pub label: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeWorkspaceSummary {
    pub id: String,
    pub title: String,
    pub source_label: String,
    pub updated_at_ms: u64,
    pub node_count: usize,
    pub edge_count: usize,
    pub path: String,
}

struct LoadedDataset {
    summary: LoadSummary,
    symbols: HashMap<String, SymbolDetail>,
    search_docs: HashMap<String, String>,
    sorted_names: Vec<String>,
    db: Connection,
}

#[derive(Debug, Clone)]
struct RawCompositeSymbol {
    name: String,
    kind: SymbolKind,
    parents: Vec<String>,
    size: Option<u64>,
    fields: Vec<RawField>,
}

#[derive(Debug, Clone)]
struct RawEnumSymbol {
    name: String,
    underlying_type: Option<String>,
    values: Vec<EnumValueInfo>,
}

#[derive(Debug, Clone)]
struct RawField {
    name: String,
    type_spec: TypeSpec,
    offset: Option<u64>,
    size: Option<u64>,
    array_dim: Option<u64>,
}

#[derive(Debug, Clone)]
struct RawMethod {
    name: String,
    return_type: TypeSpec,
    parameters: Vec<RawParameter>,
    address: Option<u64>,
    flags: String,
}

#[derive(Debug, Clone)]
struct RawParameter {
    name: String,
    type_spec: TypeSpec,
}

#[derive(Debug, Clone)]
struct TypeSpec {
    name: String,
    _category: String,
    modifier: String,
    generics: Vec<TypeSpec>,
}

#[tauri::command]
pub fn load_dump_payload(
    state: tauri::State<AppState>,
    payload: DumpImportPayload,
) -> Result<LoadSummary, String> {
    let dataset = build_dataset(payload)?;
    let summary = dataset.summary.clone();

    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "state lock poisoned while loading dataset".to_string())?;
    guard.summary = Some(dataset.summary);
    guard.symbols = dataset.symbols;
    guard.search_docs = dataset.search_docs;
    guard.sorted_names = dataset.sorted_names;
    guard.db = Some(dataset.db);

    Ok(summary)
}

#[tauri::command]
pub fn load_sample_dump(state: tauri::State<AppState>) -> Result<LoadSummary, String> {
    let dump_dir = resolve_sample_dump_dir()
        .ok_or_else(|| "unable to locate dump/Dumpspace in the current workspace".to_string())?;

    let payload = DumpImportPayload {
        source_label: dump_dir.to_string_lossy().to_string(),
        classes_json: read_dump_file(&dump_dir, CLASSES_FILE)?,
        structs_json: read_dump_file(&dump_dir, STRUCTS_FILE)?,
        functions_json: read_dump_file(&dump_dir, FUNCTIONS_FILE)?,
        enums_json: read_dump_file(&dump_dir, ENUMS_FILE)?,
        offsets_json: read_optional_dump_file(&dump_dir, OFFSETS_FILE)?,
    };

    load_dump_payload(state, payload)
}

#[tauri::command]
pub fn search_symbols(
    state: tauri::State<AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    let guard = state
        .inner
        .lock()
        .map_err(|_| "state lock poisoned while searching".to_string())?;

    if guard.symbols.is_empty() {
        return Err("no dump dataset is loaded".to_string());
    }

    let capped_limit = limit.unwrap_or(80).clamp(1, 200);
    let query = query.trim();
    let mut ordered_names = Vec::new();
    let mut seen = HashSet::new();

    if query.is_empty() {
        for name in guard.sorted_names.iter().take(capped_limit) {
            if seen.insert(name.clone()) {
                ordered_names.push(name.clone());
            }
        }
    } else {
        append_priority_name_matches(&guard.sorted_names, query, capped_limit, &mut seen, &mut ordered_names);

        if ordered_names.len() < capped_limit {
            if let (Some(db), Some(fts_query)) = (guard.db.as_ref(), build_fts_query(query)) {
                let mut stmt = db
                    .prepare(
                        "SELECT name FROM symbol_fts WHERE symbol_fts MATCH ?1 \
           ORDER BY bm25(symbol_fts), length(name) LIMIT ?2",
                    )
                    .map_err(|err| format!("failed to prepare FTS search: {err}"))?;

                let rows = stmt
                    .query_map(params![fts_query, capped_limit as i64], |row| {
                        row.get::<_, String>(0)
                    })
                    .map_err(|err| format!("failed to execute FTS search: {err}"))?;

                for row in rows {
                    let name = row.map_err(|err| format!("failed to read FTS row: {err}"))?;
                    if seen.insert(name.clone()) {
                        ordered_names.push(name);
                    }
                }
            }
        }

        if ordered_names.len() < capped_limit {
            append_contains_matches(
                &guard.sorted_names,
                &guard.search_docs,
                query,
                capped_limit,
                &mut seen,
                &mut ordered_names,
            );
        }
    }

    Ok(ordered_names
        .into_iter()
        .filter_map(|name| guard.symbols.get(&name).map(build_search_result))
        .collect())
}

#[tauri::command]
pub fn get_symbol_detail(
    state: tauri::State<AppState>,
    name: String,
) -> Result<SymbolDetail, String> {
    let guard = state
        .inner
        .lock()
        .map_err(|_| "state lock poisoned while reading symbol detail".to_string())?;

    guard
        .symbols
        .get(&name)
        .cloned()
        .ok_or_else(|| format!("symbol not found: {name}"))
}

#[tauri::command]
pub fn list_node_workspaces(
    app_handle: tauri::AppHandle,
    source_label: String,
) -> Result<Vec<NodeWorkspaceSummary>, String> {
    let workspace_dir = ensure_node_workspace_dir(&app_handle, &source_label)?;

    let mut workspaces = Vec::new();
    let entries = fs::read_dir(&workspace_dir).map_err(|err| {
        format!(
            "failed to read workspace directory {}: {err}",
            workspace_dir.to_string_lossy()
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|err| format!("failed to read workspace entry: {err}"))?;
        let path = entry.path();

        if !path.is_file()
            || path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension != NODE_WORKSPACE_EXTENSION)
                .unwrap_or(true)
        {
            continue;
        }

        let Ok(document) = read_node_workspace_document(&path) else {
            continue;
        };

        workspaces.push(build_node_workspace_summary(document, &path));
    }

    workspaces.sort_by(|left, right| {
        right
            .updated_at_ms
            .cmp(&left.updated_at_ms)
            .then(left.title.cmp(&right.title))
    });

    Ok(workspaces)
}

#[tauri::command]
pub fn create_node_workspace(
    app_handle: tauri::AppHandle,
    source_label: String,
    title: Option<String>,
) -> Result<NodeWorkspaceDocument, String> {
    let workspace_dir = ensure_node_workspace_dir(&app_handle, &source_label)?;
    let now_ms = current_timestamp_ms()?;
    let normalized_title = normalize_workspace_title(title.as_deref(), now_ms);
    let workspace_id =
        create_unique_workspace_id(&workspace_dir, &normalized_title, now_ms, None);
    let workspace_path = build_node_workspace_path(&workspace_dir, &workspace_id);

    let document = NodeWorkspaceDocument {
        id: workspace_id,
        title: normalized_title,
        source_label,
        created_at_ms: now_ms,
        updated_at_ms: now_ms,
        nodes: Vec::new(),
        edges: Vec::new(),
    };

    write_node_workspace_document(&workspace_path, &document)?;

    Ok(document)
}

#[tauri::command]
pub fn load_node_workspace(
    app_handle: tauri::AppHandle,
    source_label: String,
    workspace_id: String,
) -> Result<NodeWorkspaceDocument, String> {
    let workspace_dir = ensure_node_workspace_dir(&app_handle, &source_label)?;
    let workspace_path = build_node_workspace_path(&workspace_dir, &workspace_id);

    read_node_workspace_document(&workspace_path)
}

#[tauri::command]
pub fn save_node_workspace(
    app_handle: tauri::AppHandle,
    document: NodeWorkspaceDocument,
) -> Result<NodeWorkspaceSummary, String> {
    let source_label = document.source_label.trim();
    if source_label.is_empty() {
        return Err("workspace source label is required".to_string());
    }

    let workspace_id = sanitize_workspace_identifier(&document.id);
    if workspace_id.is_empty() {
        return Err("workspace id is required".to_string());
    }

    let workspace_dir = ensure_node_workspace_dir(&app_handle, source_label)?;
    let workspace_path = build_node_workspace_path(&workspace_dir, &workspace_id);
    let now_ms = current_timestamp_ms()?;

    let updated_document = NodeWorkspaceDocument {
        id: workspace_id,
        title: normalize_workspace_title(Some(&document.title), now_ms),
        source_label: source_label.to_string(),
        created_at_ms: if document.created_at_ms == 0 {
            now_ms
        } else {
            document.created_at_ms
        },
        updated_at_ms: now_ms,
        nodes: document.nodes,
        edges: document.edges,
    };

    write_node_workspace_document(&workspace_path, &updated_document)?;

    Ok(build_node_workspace_summary(updated_document, &workspace_path))
}

#[tauri::command]
pub fn rename_node_workspace(
    app_handle: tauri::AppHandle,
    source_label: String,
    workspace_id: String,
    title: String,
) -> Result<NodeWorkspaceDocument, String> {
    let source_label = source_label.trim();
    if source_label.is_empty() {
        return Err("workspace source label is required".to_string());
    }

    let workspace_id = sanitize_workspace_identifier(&workspace_id);
    if workspace_id.is_empty() {
        return Err("workspace id is required".to_string());
    }

    let workspace_dir = ensure_node_workspace_dir(&app_handle, source_label)?;
    let current_path = build_node_workspace_path(&workspace_dir, &workspace_id);
    let current_document = read_node_workspace_document(&current_path)?;
    let now_ms = current_timestamp_ms()?;
    let normalized_title = normalize_workspace_title(Some(&title), now_ms);
    let workspace_seed = if current_document.created_at_ms == 0 {
        now_ms
    } else {
        current_document.created_at_ms
    };
    let next_workspace_id = create_unique_workspace_id(
        &workspace_dir,
        &normalized_title,
        workspace_seed,
        Some(&workspace_id),
    );
    let next_path = build_node_workspace_path(&workspace_dir, &next_workspace_id);
    let next_document = NodeWorkspaceDocument {
        id: next_workspace_id.clone(),
        title: normalized_title,
        source_label: source_label.to_string(),
        created_at_ms: workspace_seed,
        updated_at_ms: now_ms,
        nodes: current_document.nodes,
        edges: current_document.edges,
    };

    write_node_workspace_document(&next_path, &next_document)?;

    if next_path != current_path {
        fs::remove_file(&current_path).map_err(|err| {
            format!(
                "failed to remove workspace {}: {err}",
                current_path.to_string_lossy()
            )
        })?;
    }

    Ok(next_document)
}

#[tauri::command]
pub fn delete_node_workspace(
    app_handle: tauri::AppHandle,
    source_label: String,
    workspace_id: String,
) -> Result<(), String> {
    let source_label = source_label.trim();
    if source_label.is_empty() {
        return Err("workspace source label is required".to_string());
    }

    let workspace_id = sanitize_workspace_identifier(&workspace_id);
    if workspace_id.is_empty() {
        return Err("workspace id is required".to_string());
    }

    let workspace_dir = ensure_node_workspace_dir(&app_handle, source_label)?;
    let workspace_path = build_node_workspace_path(&workspace_dir, &workspace_id);

    if !workspace_path.exists() {
        return Err(format!(
            "workspace {} does not exist",
            workspace_path.to_string_lossy()
        ));
    }

    fs::remove_file(&workspace_path).map_err(|err| {
        format!(
            "failed to delete workspace {}: {err}",
            workspace_path.to_string_lossy()
        )
    })
}

fn build_dataset(payload: DumpImportPayload) -> Result<LoadedDataset, String> {
    let raw_classes =
        parse_composite_symbols(&payload.classes_json, SymbolKind::Class, CLASSES_FILE)?;
    let raw_structs =
        parse_composite_symbols(&payload.structs_json, SymbolKind::Struct, STRUCTS_FILE)?;
    let raw_enums = parse_enum_symbols(&payload.enums_json)?;
    let raw_functions = parse_function_map(&payload.functions_json)?;
    let offsets = match payload.offsets_json.as_deref() {
        Some(offsets_json) => parse_offsets(offsets_json)?,
        None => Vec::new(),
    };

    let class_count = raw_classes.len();
    let struct_count = raw_structs.len();
    let enum_count = raw_enums.len();
    let function_owner_count = raw_functions.len();
    let method_count: usize = raw_functions.iter().map(|(_, methods)| methods.len()).sum();

    let mut known_kinds = HashMap::new();
    for symbol in raw_classes.iter().chain(raw_structs.iter()) {
        known_kinds.insert(symbol.name.clone(), symbol.kind);
    }
    for symbol in &raw_enums {
        known_kinds.insert(symbol.name.clone(), SymbolKind::Enum);
    }

    let mut symbols = HashMap::new();
    for symbol in raw_classes.into_iter().chain(raw_structs.into_iter()) {
        let fields = symbol
            .fields
            .into_iter()
            .map(|field| build_field(field, &known_kinds))
            .collect::<Vec<_>>();

        let parent = symbol.parents.first().cloned();
        let parents = symbol
            .parents
            .into_iter()
            .map(|name| build_symbol_link(&name, &known_kinds))
            .collect::<Vec<_>>();

        symbols.insert(
            symbol.name.clone(),
            SymbolDetail {
                name: symbol.name,
                kind: symbol.kind,
                size: symbol.size,
                parent,
                parents,
                direct_children: Vec::new(),
                fields,
                methods: Vec::new(),
                enum_values: Vec::new(),
                underlying_type: None,
                related: Vec::new(),
                incoming_refs: Vec::new(),
                field_count: 0,
                method_count: 0,
                relation_count: 0,
                child_count: 0,
            },
        );
    }

    for symbol in raw_enums {
        symbols.insert(
            symbol.name.clone(),
            SymbolDetail {
                name: symbol.name,
                kind: SymbolKind::Enum,
                size: None,
                parent: None,
                parents: Vec::new(),
                direct_children: Vec::new(),
                fields: Vec::new(),
                methods: Vec::new(),
                enum_values: symbol.values,
                underlying_type: symbol.underlying_type,
                related: Vec::new(),
                incoming_refs: Vec::new(),
                field_count: 0,
                method_count: 0,
                relation_count: 0,
                child_count: 0,
            },
        );
    }

    for (owner_name, methods) in raw_functions {
        if !symbols.contains_key(&owner_name) {
            let guessed_kind = guess_kind_from_name(&owner_name);
            known_kinds.insert(owner_name.clone(), guessed_kind);
            symbols.insert(
                owner_name.clone(),
                SymbolDetail {
                    name: owner_name.clone(),
                    kind: guessed_kind,
                    size: None,
                    parent: None,
                    parents: Vec::new(),
                    direct_children: Vec::new(),
                    fields: Vec::new(),
                    methods: Vec::new(),
                    enum_values: Vec::new(),
                    underlying_type: None,
                    related: Vec::new(),
                    incoming_refs: Vec::new(),
                    field_count: 0,
                    method_count: 0,
                    relation_count: 0,
                    child_count: 0,
                },
            );
        }

        let built_methods = methods
            .into_iter()
            .map(|method| build_method(method, &known_kinds))
            .collect::<Vec<_>>();

        if let Some(symbol) = symbols.get_mut(&owner_name) {
            symbol.methods = built_methods;
        }
    }

    attach_children(&mut symbols, &known_kinds);
    attach_relations(&mut symbols);
    finalize_counts(&mut symbols);

    let mut search_docs = HashMap::new();
    for symbol in symbols.values() {
        search_docs.insert(symbol.name.clone(), build_search_doc(symbol));
    }

    let db = build_search_db(&search_docs)?;
    let mut sorted_names = symbols.keys().cloned().collect::<Vec<_>>();
    sorted_names.sort_unstable();

    let landing_symbol = if symbols.contains_key("UObject") {
        Some("UObject".to_string())
    } else {
        sorted_names.first().cloned()
    };

    let relation_count: usize = symbols.values().map(|symbol| symbol.related.len()).sum();
    let summary = LoadSummary {
        source_label: payload.source_label,
        symbol_count: symbols.len(),
        class_count,
        struct_count,
        enum_count,
        function_owner_count,
        method_count,
        relation_count,
        offsets,
        landing_symbol,
    };

    Ok(LoadedDataset {
        summary,
        symbols,
        search_docs,
        sorted_names,
        db,
    })
}

fn parse_composite_symbols(
    json: &str,
    kind: SymbolKind,
    file_name: &str,
) -> Result<Vec<RawCompositeSymbol>, String> {
    let entries = parse_data_entries(json, file_name)?;
    let mut symbols = Vec::new();

    for entry in entries {
        let (symbol_name, payload) = object_pair(&entry, file_name)?;
        let items = payload
            .as_array()
            .ok_or_else(|| format!("{file_name}: {symbol_name} must be an array"))?;

        let mut parents = Vec::new();
        let mut size = None;
        let mut fields = Vec::new();

        for item in items {
            let (member_name, member_value) = value_object_pair(item, file_name)?;
            match member_name {
                "__InheritInfo" => {
                    parents = parse_string_array(member_value, file_name, symbol_name)?;
                }
                "__MDKClassSize" => {
                    size = member_value.as_u64();
                }
                _ => {
                    fields.push(parse_field(
                        member_name,
                        member_value,
                        file_name,
                        symbol_name,
                    )?);
                }
            }
        }

        symbols.push(RawCompositeSymbol {
            name: symbol_name.to_string(),
            kind,
            parents,
            size,
            fields,
        });
    }

    Ok(symbols)
}

fn parse_enum_symbols(json: &str) -> Result<Vec<RawEnumSymbol>, String> {
    let entries = parse_data_entries(json, ENUMS_FILE)?;
    let mut symbols = Vec::new();

    for entry in entries {
        let (symbol_name, payload) = object_pair(&entry, ENUMS_FILE)?;
        let values = payload
            .as_array()
            .ok_or_else(|| format!("{ENUMS_FILE}: {symbol_name} must be an array"))?;

        let raw_values = values.first().and_then(Value::as_array).ok_or_else(|| {
            format!("{ENUMS_FILE}: {symbol_name} must contain an array of enum values")
        })?;

        let underlying_type = values
            .get(1)
            .and_then(Value::as_str)
            .map(|value| value.to_string());

        let enum_values = raw_values
            .iter()
            .map(|value| {
                let (name, raw_value) = value_object_pair(value, ENUMS_FILE)?;
                Ok(EnumValueInfo {
                    name: name.to_string(),
                    value: match raw_value {
                        Value::String(text) => text.clone(),
                        _ => raw_value.to_string(),
                    },
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        symbols.push(RawEnumSymbol {
            name: symbol_name.to_string(),
            underlying_type,
            values: enum_values,
        });
    }

    Ok(symbols)
}

fn parse_function_map(json: &str) -> Result<Vec<(String, Vec<RawMethod>)>, String> {
    let entries = parse_data_entries(json, FUNCTIONS_FILE)?;
    let mut functions = Vec::new();

    for entry in entries {
        let (owner_name, payload) = object_pair(&entry, FUNCTIONS_FILE)?;
        let methods = payload
            .as_array()
            .ok_or_else(|| format!("{FUNCTIONS_FILE}: {owner_name} must be an array"))?;

        let built_methods = methods
            .iter()
            .map(|method_entry| {
                let (method_name, raw_method) = value_object_pair(method_entry, FUNCTIONS_FILE)?;
                let items = raw_method.as_array().ok_or_else(|| {
                    format!("{FUNCTIONS_FILE}: {owner_name}.{method_name} must be an array")
                })?;

                let empty_params = Vec::new();
                let parameters = items
                    .get(1)
                    .and_then(Value::as_array)
                    .unwrap_or(&empty_params)
                    .iter()
                    .enumerate()
                    .map(|(index, param)| parse_parameter(param, owner_name, method_name, index))
                    .collect::<Result<Vec<_>, String>>()?;

                Ok(RawMethod {
                    name: method_name.to_string(),
                    return_type: parse_type_spec(items.first().unwrap_or(&Value::Null)),
                    parameters,
                    address: items.get(2).and_then(Value::as_u64),
                    flags: items
                        .get(3)
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        functions.push((owner_name.to_string(), built_methods));
    }

    Ok(functions)
}

fn parse_offsets(json: &str) -> Result<Vec<OffsetEntry>, String> {
    let root: Value = serde_json::from_str(json)
        .map_err(|err| format!("{OFFSETS_FILE}: failed to parse JSON: {err}"))?;
    let data = root
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{OFFSETS_FILE}: missing data array"))?;

    let mut offsets = Vec::new();
    for item in data {
        let parts = item
            .as_array()
            .ok_or_else(|| format!("{OFFSETS_FILE}: offset entry must be an array"))?;
        let key = parts
            .first()
            .and_then(Value::as_str)
            .ok_or_else(|| format!("{OFFSETS_FILE}: offset key must be a string"))?;
        let value = parts
            .get(1)
            .map(value_to_readable_string)
            .unwrap_or_else(|| "".to_string());

        offsets.push(OffsetEntry {
            key: key.to_string(),
            value,
        });
    }

    Ok(offsets)
}

fn parse_field(
    field_name: &str,
    raw_field: &Value,
    file_name: &str,
    symbol_name: &str,
) -> Result<RawField, String> {
    let items = raw_field.as_array().ok_or_else(|| {
        format!("{file_name}: {symbol_name}.{field_name} field entry must be an array")
    })?;

    Ok(RawField {
        name: field_name.to_string(),
        type_spec: parse_type_spec(items.first().unwrap_or(&Value::Null)),
        offset: items.get(1).and_then(Value::as_u64),
        size: items.get(2).and_then(Value::as_u64),
        array_dim: items.get(3).and_then(Value::as_u64),
    })
}

fn parse_parameter(
    value: &Value,
    owner_name: &str,
    method_name: &str,
    index: usize,
) -> Result<RawParameter, String> {
    let items = value.as_array().ok_or_else(|| {
        format!("{FUNCTIONS_FILE}: {owner_name}.{method_name} parameter entry must be an array")
    })?;

    let parameter_name = items
        .get(2)
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .unwrap_or_else(|| format!("arg{index}"));

    Ok(RawParameter {
        name: parameter_name,
        type_spec: parse_type_spec(items.first().unwrap_or(&Value::Null)),
    })
}

fn parse_type_spec(value: &Value) -> TypeSpec {
    let Some(items) = value.as_array() else {
        return TypeSpec {
            name: value_to_readable_string(value),
            _category: String::new(),
            modifier: String::new(),
            generics: Vec::new(),
        };
    };

    let generics = items
        .get(3)
        .and_then(Value::as_array)
        .map(|items| items.iter().map(parse_type_spec).collect::<Vec<_>>())
        .unwrap_or_default();

    TypeSpec {
        name: items
            .first()
            .and_then(Value::as_str)
            .unwrap_or("Unknown")
            .to_string(),
        _category: items
            .get(1)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        modifier: items
            .get(2)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        generics,
    }
}

fn build_field(field: RawField, known_kinds: &HashMap<String, SymbolKind>) -> FieldInfo {
    let links = collect_type_links(&field.type_spec, known_kinds);
    FieldInfo {
        name: field.name,
        type_display: field.type_spec.display(),
        offset: field.offset,
        size: field.size,
        array_dim: field.array_dim,
        links,
    }
}

fn build_method(method: RawMethod, known_kinds: &HashMap<String, SymbolKind>) -> MethodInfo {
    let return_links = collect_type_links(&method.return_type, known_kinds);
    let parameters = method
        .parameters
        .into_iter()
        .map(|parameter| ParameterInfo {
            name: parameter.name,
            type_display: parameter.type_spec.display(),
            links: collect_type_links(&parameter.type_spec, known_kinds),
        })
        .collect::<Vec<_>>();

    MethodInfo {
        name: method.name,
        return_type: method.return_type.display(),
        return_links,
        parameters,
        address: method.address,
        flags: method.flags,
    }
}

fn collect_type_links(
    type_spec: &TypeSpec,
    known_kinds: &HashMap<String, SymbolKind>,
) -> Vec<SymbolLink> {
    let mut links = Vec::new();
    let mut seen = HashSet::new();
    collect_type_links_inner(type_spec, known_kinds, &mut seen, &mut links);
    links.sort_by(|left, right| left.name.cmp(&right.name));
    links
}

fn collect_type_links_inner(
    type_spec: &TypeSpec,
    known_kinds: &HashMap<String, SymbolKind>,
    seen: &mut HashSet<String>,
    out: &mut Vec<SymbolLink>,
) {
    if let Some(kind) = known_kinds.get(&type_spec.name) {
        if seen.insert(type_spec.name.clone()) {
            out.push(SymbolLink {
                name: type_spec.name.clone(),
                kind: *kind,
            });
        }
    }

    for generic in &type_spec.generics {
        collect_type_links_inner(generic, known_kinds, seen, out);
    }
}

fn attach_children(
    symbols: &mut HashMap<String, SymbolDetail>,
    known_kinds: &HashMap<String, SymbolKind>,
) {
    let mut child_map: HashMap<String, Vec<SymbolLink>> = HashMap::new();
    let names = symbols.keys().cloned().collect::<Vec<_>>();

    for name in names {
        let Some(parent_name) = symbols
            .get(&name)
            .and_then(|symbol| symbol.parents.first())
            .map(|parent| parent.name.clone())
        else {
            continue;
        };

        child_map
            .entry(parent_name)
            .or_default()
            .push(build_symbol_link(&name, known_kinds));
    }

    for children in child_map.values_mut() {
        children.sort_by(|left, right| left.name.cmp(&right.name));
        children.dedup_by(|left, right| left.name == right.name);
    }

    for (parent, children) in child_map {
        if let Some(symbol) = symbols.get_mut(&parent) {
            symbol.direct_children = children;
        }
    }
}

fn attach_relations(symbols: &mut HashMap<String, SymbolDetail>) {
    let mut outgoing_map: HashMap<String, Vec<RelationInfo>> = HashMap::new();
    let mut incoming_map: HashMap<String, Vec<RelationInfo>> = HashMap::new();
    let symbol_names = symbols.keys().cloned().collect::<Vec<_>>();

    for symbol_name in &symbol_names {
        let Some(symbol) = symbols.get(symbol_name) else {
            continue;
        };

        let mut outgoing = Vec::new();
        let mut seen = HashSet::new();

        for field in &symbol.fields {
            for link in &field.links {
                if link.name == symbol.name {
                    continue;
                }

                let dedupe_key = format!("field:{}:{}", link.name, field.name);
                if seen.insert(dedupe_key) {
                    outgoing.push(RelationInfo {
                        name: link.name.clone(),
                        kind: link.kind,
                        relation: "field".to_string(),
                        via: field.name.clone(),
                    });
                    incoming_map
                        .entry(link.name.clone())
                        .or_default()
                        .push(RelationInfo {
                            name: symbol.name.clone(),
                            kind: symbol.kind,
                            relation: "field".to_string(),
                            via: field.name.clone(),
                        });
                }
            }
        }

        for method in &symbol.methods {
            for link in &method.return_links {
                if link.name == symbol.name {
                    continue;
                }

                let dedupe_key = format!("return:{}:{}", link.name, method.name);
                if seen.insert(dedupe_key) {
                    outgoing.push(RelationInfo {
                        name: link.name.clone(),
                        kind: link.kind,
                        relation: "return".to_string(),
                        via: method.name.clone(),
                    });
                    incoming_map
                        .entry(link.name.clone())
                        .or_default()
                        .push(RelationInfo {
                            name: symbol.name.clone(),
                            kind: symbol.kind,
                            relation: "return".to_string(),
                            via: method.name.clone(),
                        });
                }
            }

            for parameter in &method.parameters {
                for link in &parameter.links {
                    if link.name == symbol.name {
                        continue;
                    }

                    let via = format!("{}({})", method.name, parameter.name);
                    let dedupe_key = format!("parameter:{}:{via}", link.name);
                    if seen.insert(dedupe_key) {
                        outgoing.push(RelationInfo {
                            name: link.name.clone(),
                            kind: link.kind,
                            relation: "parameter".to_string(),
                            via: via.clone(),
                        });
                        incoming_map
                            .entry(link.name.clone())
                            .or_default()
                            .push(RelationInfo {
                                name: symbol.name.clone(),
                                kind: symbol.kind,
                                relation: "parameter".to_string(),
                                via,
                            });
                    }
                }
            }
        }

        sort_relations(&mut outgoing);
        outgoing_map.insert(symbol.name.clone(), outgoing);
    }

    for (symbol_name, relations) in outgoing_map {
        if let Some(symbol) = symbols.get_mut(&symbol_name) {
            symbol.related = relations;
        }
    }

    for (symbol_name, mut relations) in incoming_map {
        sort_relations(&mut relations);
        if let Some(symbol) = symbols.get_mut(&symbol_name) {
            symbol.incoming_refs = relations;
        }
    }
}

fn finalize_counts(symbols: &mut HashMap<String, SymbolDetail>) {
    for symbol in symbols.values_mut() {
        symbol.field_count = symbol.fields.len();
        symbol.method_count = symbol.methods.len();
        symbol.relation_count = symbol.related.len();
        symbol.child_count = symbol.direct_children.len();
    }
}

fn build_search_db(search_docs: &HashMap<String, String>) -> Result<Connection, String> {
    let mut db = Connection::open_in_memory()
        .map_err(|err| format!("failed to create in-memory sqlite database: {err}"))?;

    db.execute_batch(
        "CREATE VIRTUAL TABLE symbol_fts USING fts5( \
       name, \
       search_text, \
       tokenize = 'unicode61 remove_diacritics 2' \
     );",
    )
    .map_err(|err| format!("failed to enable sqlite FTS5: {err}"))?;

    let tx = db
        .transaction()
        .map_err(|err| format!("failed to open sqlite transaction: {err}"))?;
    {
        let mut stmt = tx
            .prepare("INSERT INTO symbol_fts (name, search_text) VALUES (?1, ?2)")
            .map_err(|err| format!("failed to prepare sqlite insert: {err}"))?;

        for (name, search_text) in search_docs {
            stmt.execute(params![name, search_text])
                .map_err(|err| format!("failed to index {name} in sqlite: {err}"))?;
        }
    }
    tx.commit()
        .map_err(|err| format!("failed to commit sqlite transaction: {err}"))?;

    Ok(db)
}

fn build_search_result(detail: &SymbolDetail) -> SearchResult {
    SearchResult {
        name: detail.name.clone(),
        kind: detail.kind,
        parent: detail.parent.clone(),
        size: detail.size,
        field_count: detail.field_count,
        method_count: detail.method_count,
        relation_count: detail.relation_count,
        child_count: detail.child_count,
        subtitle: build_search_subtitle(detail),
    }
}

fn build_search_subtitle(detail: &SymbolDetail) -> String {
    let mut parts = Vec::new();

    if let Some(parent) = &detail.parent {
        parts.push(format!("extends {parent}"));
    }

    if let Some(underlying_type) = &detail.underlying_type {
        parts.push(format!("underlying {underlying_type}"));
    }

    if let Some(size) = detail.size {
        parts.push(format!("{size} bytes"));
    }

    if detail.field_count > 0 {
        parts.push(format!("{} fields", detail.field_count));
    }

    if detail.method_count > 0 {
        parts.push(format!("{} methods", detail.method_count));
    }

    if !detail.enum_values.is_empty() {
        parts.push(format!("{} values", detail.enum_values.len()));
    }

    if detail.child_count > 0 {
        parts.push(format!("{} children", detail.child_count));
    }

    parts.join(" | ")
}

fn append_priority_name_matches(
    sorted_names: &[String],
    query: &str,
    limit: usize,
    seen: &mut HashSet<String>,
    ordered_names: &mut Vec<String>,
) {
    let collapsed_query = collapse_searchable(query);
    let mut exact_name = Vec::new();
    let mut exact_collapsed = Vec::new();
    let mut prefix = Vec::new();

    for name in sorted_names {
        if seen.contains(name) {
            continue;
        }

        let collapsed_name = collapse_searchable(name);

        if name == query {
            exact_name.push(name.clone());
            continue;
        }

        if !collapsed_query.is_empty() && collapsed_name == collapsed_query {
            exact_collapsed.push(name.clone());
            continue;
        }

        if !collapsed_query.is_empty() && collapsed_name.starts_with(&collapsed_query) {
            prefix.push(name.clone());
        }
    }

    for bucket in [exact_name, exact_collapsed, prefix] {
        for name in bucket {
            if seen.insert(name.clone()) {
                ordered_names.push(name);
            }
            if ordered_names.len() >= limit {
                return;
            }
        }
    }
}

fn append_contains_matches(
    sorted_names: &[String],
    search_docs: &HashMap<String, String>,
    query: &str,
    limit: usize,
    seen: &mut HashSet<String>,
    ordered_names: &mut Vec<String>,
) {
    let collapsed_query = collapse_searchable(query);
    let query_tokens = searchable_tokens(query);

    let mut name_contains = Vec::new();
    let mut doc_contains = Vec::new();

    for name in sorted_names {
        if seen.contains(name) {
            continue;
        }

        let collapsed_name = collapse_searchable(name);
        let search_doc = search_docs
            .get(name)
            .map(String::as_str)
            .unwrap_or_default();

        if !collapsed_query.is_empty() && collapsed_name.contains(&collapsed_query) {
            name_contains.push(name.clone());
            continue;
        }

        if !query_tokens.is_empty() && query_tokens.iter().all(|token| search_doc.contains(token)) {
            doc_contains.push(name.clone());
        }
    }

    for bucket in [name_contains, doc_contains] {
        for name in bucket {
            if seen.insert(name.clone()) {
                ordered_names.push(name);
            }
            if ordered_names.len() >= limit {
                return;
            }
        }
    }
}

fn build_search_doc(symbol: &SymbolDetail) -> String {
    let mut terms = BTreeSet::new();
    add_search_terms(&mut terms, &symbol.name);

    if let Some(parent) = &symbol.parent {
        add_search_terms(&mut terms, parent);
    }

    for parent in &symbol.parents {
        add_search_terms(&mut terms, &parent.name);
    }

    for child in &symbol.direct_children {
        add_search_terms(&mut terms, &child.name);
    }

    for field in &symbol.fields {
        add_search_terms(&mut terms, &field.name);
        add_search_terms(&mut terms, &field.type_display);
        for link in &field.links {
            add_search_terms(&mut terms, &link.name);
        }
    }

    for method in &symbol.methods {
        add_search_terms(&mut terms, &method.name);
        add_search_terms(&mut terms, &method.return_type);
        for link in &method.return_links {
            add_search_terms(&mut terms, &link.name);
        }

        for parameter in &method.parameters {
            add_search_terms(&mut terms, &parameter.name);
            add_search_terms(&mut terms, &parameter.type_display);
            for link in &parameter.links {
                add_search_terms(&mut terms, &link.name);
            }
        }
    }

    for relation in &symbol.related {
        add_search_terms(&mut terms, &relation.name);
        add_search_terms(&mut terms, &relation.via);
    }

    terms.into_iter().collect::<Vec<_>>().join(" ")
}

fn add_search_terms(terms: &mut BTreeSet<String>, text: &str) {
    let collapsed = collapse_searchable(text);
    if !collapsed.is_empty() {
        terms.insert(collapsed);
    }

    for token in searchable_tokens(text) {
        terms.insert(token);
    }
}

fn searchable_tokens(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let chars = text.chars().collect::<Vec<_>>();

    for (index, ch) in chars.iter().enumerate() {
        if !ch.is_ascii_alphanumeric() {
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
            continue;
        }

        let should_break = chars
            .get(index.saturating_sub(1))
            .map(|prev| {
                prev.is_ascii_alphanumeric()
                    && ((prev.is_ascii_lowercase() && ch.is_ascii_uppercase())
                        || (prev.is_ascii_alphabetic() && ch.is_ascii_digit())
                        || (prev.is_ascii_digit() && ch.is_ascii_alphabetic())
                        || (prev.is_ascii_uppercase()
                            && ch.is_ascii_uppercase()
                            && chars
                                .get(index + 1)
                                .map(|next| next.is_ascii_lowercase())
                                .unwrap_or(false)))
            })
            .unwrap_or(false);

        if should_break && !current.is_empty() {
            tokens.push(current.clone());
            current.clear();
        }

        current.push(ch.to_ascii_lowercase());
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
        .into_iter()
        .filter(|token| token.len() >= 2)
        .collect::<Vec<_>>()
}

fn collapse_searchable(text: &str) -> String {
    text.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_lowercase())
        .collect::<String>()
}

fn build_fts_query(query: &str) -> Option<String> {
    let mut terms = Vec::new();
    let collapsed = collapse_searchable(query);

    if collapsed.len() >= 2 {
        terms.push(collapsed);
    }

    for token in searchable_tokens(query) {
        if !terms.contains(&token) {
            terms.push(token);
        }
    }

    if terms.is_empty() {
        None
    } else {
        Some(
            terms
                .into_iter()
                .take(6)
                .map(|term| format!("{term}*"))
                .collect::<Vec<_>>()
                .join(" "),
        )
    }
}

fn build_symbol_link(name: &str, known_kinds: &HashMap<String, SymbolKind>) -> SymbolLink {
    SymbolLink {
        name: name.to_string(),
        kind: known_kinds
            .get(name)
            .copied()
            .unwrap_or_else(|| guess_kind_from_name(name)),
    }
}

fn sort_relations(relations: &mut Vec<RelationInfo>) {
    relations.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then(left.relation.cmp(&right.relation))
            .then(left.via.cmp(&right.via))
    });
    relations.dedup_by(|left, right| {
        left.name == right.name && left.relation == right.relation && left.via == right.via
    });
}

fn guess_kind_from_name(name: &str) -> SymbolKind {
    match name.chars().next() {
        Some('F') => SymbolKind::Struct,
        Some('E') => SymbolKind::Enum,
        _ => SymbolKind::Class,
    }
}

fn parse_data_entries(
    json: &str,
    file_name: &str,
) -> Result<Vec<serde_json::Map<String, Value>>, String> {
    let root: Value = serde_json::from_str(json)
        .map_err(|err| format!("{file_name}: failed to parse JSON: {err}"))?;
    let data = root
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{file_name}: missing data array"))?;

    data.iter()
        .map(|entry| {
            entry
                .as_object()
                .cloned()
                .ok_or_else(|| format!("{file_name}: each data entry must be an object"))
        })
        .collect()
}

fn object_pair<'a>(
    map: &'a serde_json::Map<String, Value>,
    file_name: &str,
) -> Result<(&'a str, &'a Value), String> {
    if map.len() != 1 {
        return Err(format!(
            "{file_name}: data entry must contain exactly one key"
        ));
    }

    map.iter()
        .next()
        .map(|(key, value)| (key.as_str(), value))
        .ok_or_else(|| format!("{file_name}: data entry is empty"))
}

fn value_object_pair<'a>(
    value: &'a Value,
    file_name: &str,
) -> Result<(&'a str, &'a Value), String> {
    let map = value
        .as_object()
        .ok_or_else(|| format!("{file_name}: nested entry must be an object"))?;
    object_pair(map, file_name)
}

fn parse_string_array(
    value: &Value,
    file_name: &str,
    symbol_name: &str,
) -> Result<Vec<String>, String> {
    let items = value
        .as_array()
        .ok_or_else(|| format!("{file_name}: {symbol_name} inherit info must be an array"))?;
    Ok(items
        .iter()
        .filter_map(|item| item.as_str().map(|value| value.to_string()))
        .collect())
}

fn value_to_readable_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(text) => text.clone(),
        _ => value.to_string(),
    }
}

fn current_timestamp_ms() -> Result<u64, String> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("failed to get current system time: {err}"))?;

    Ok(elapsed.as_millis() as u64)
}

fn normalize_workspace_title(title: Option<&str>, fallback_seed: u64) -> String {
    title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("Node Workspace {fallback_seed}"))
}

fn sanitize_workspace_identifier(value: &str) -> String {
    let mut sanitized = String::new();
    let mut previous_dash = false;

    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            sanitized.push(ch.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash {
            sanitized.push('-');
            previous_dash = true;
        }
    }

    sanitized.trim_matches('-').chars().take(64).collect()
}

fn sanitize_workspace_segment(value: &str, fallback: &str) -> String {
    let sanitized = sanitize_workspace_identifier(value);
    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn ensure_node_workspace_dir(
    app_handle: &tauri::AppHandle,
    source_label: &str,
) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data directory: {err}"))?;
    let source_dir = sanitize_workspace_segment(source_label, "default-source");
    let workspace_dir = app_data_dir.join(NODE_WORKSPACES_DIR).join(source_dir);

    fs::create_dir_all(&workspace_dir).map_err(|err| {
        format!(
            "failed to create workspace directory {}: {err}",
            workspace_dir.to_string_lossy()
        )
    })?;

    Ok(workspace_dir)
}

fn create_unique_workspace_id(
    workspace_dir: &Path,
    title: &str,
    timestamp_ms: u64,
    current_id: Option<&str>,
) -> String {
    let title_slug = sanitize_workspace_segment(title, "workspace");
    let base_id = format!("{title_slug}-{timestamp_ms}");

    if current_id == Some(base_id.as_str()) || !build_node_workspace_path(workspace_dir, &base_id).exists() {
        return base_id;
    }

    let mut suffix = 2;
    loop {
        let candidate = format!("{base_id}-{suffix}");
        if current_id == Some(candidate.as_str())
            || !build_node_workspace_path(workspace_dir, &candidate).exists()
        {
            return candidate;
        }
        suffix += 1;
    }
}

fn build_node_workspace_path(workspace_dir: &Path, workspace_id: &str) -> PathBuf {
    workspace_dir.join(format!("{workspace_id}.{NODE_WORKSPACE_EXTENSION}"))
}

fn read_node_workspace_document(path: &Path) -> Result<NodeWorkspaceDocument, String> {
    let raw = fs::read_to_string(path)
        .map_err(|err| format!("failed to read workspace {}: {err}", path.to_string_lossy()))?;

    serde_json::from_str(&raw).map_err(|err| {
        format!(
            "failed to parse workspace {}: {err}",
            path.to_string_lossy()
        )
    })
}

fn write_node_workspace_document(
    path: &Path,
    document: &NodeWorkspaceDocument,
) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(document)
        .map_err(|err| format!("failed to serialize workspace {}: {err}", document.id))?;

    fs::write(path, raw)
        .map_err(|err| format!("failed to write workspace {}: {err}", path.to_string_lossy()))
}

fn build_node_workspace_summary(
    document: NodeWorkspaceDocument,
    path: &Path,
) -> NodeWorkspaceSummary {
    NodeWorkspaceSummary {
        id: document.id,
        title: document.title,
        source_label: document.source_label,
        updated_at_ms: document.updated_at_ms,
        node_count: document.nodes.len(),
        edge_count: document.edges.len(),
        path: path.to_string_lossy().to_string(),
    }
}

fn resolve_sample_dump_dir() -> Option<PathBuf> {
    let current_dir = std::env::current_dir().ok();
    let current_exe = std::env::current_exe().ok();
    let exe_dir = current_exe
        .as_ref()
        .and_then(|path| path.parent())
        .map(Path::to_path_buf);

    let candidates = [
        current_dir
            .clone()
            .map(|dir| dir.join("dump").join("Dumpspace")),
        current_dir
            .as_ref()
            .map(|dir| dir.join("..").join("dump").join("Dumpspace")),
        exe_dir
            .clone()
            .map(|dir| dir.join("dump").join("Dumpspace")),
        exe_dir
            .as_ref()
            .map(|dir| dir.join("..").join("dump").join("Dumpspace")),
    ];

    candidates
        .into_iter()
        .flatten()
        .find(|path| path.exists() && path.is_dir())
}

fn read_dump_file(dir: &Path, file_name: &str) -> Result<String, String> {
    let file_path = dir.join(file_name);
    fs::read_to_string(&file_path)
        .map_err(|err| format!("failed to read {}: {err}", file_path.to_string_lossy()))
}

fn read_optional_dump_file(dir: &Path, file_name: &str) -> Result<Option<String>, String> {
    let file_path = dir.join(file_name);
    if !file_path.exists() {
        return Ok(None);
    }

    read_dump_file(dir, file_name).map(Some)
}

impl TypeSpec {
    fn display(&self) -> String {
        let mut result = self.name.clone();
        if !self.generics.is_empty() {
            let generic_text = self
                .generics
                .iter()
                .map(TypeSpec::display)
                .collect::<Vec<_>>()
                .join(", ");
            result.push('<');
            result.push_str(&generic_text);
            result.push('>');
        }
        result.push_str(&self.modifier);
        result
    }
}
