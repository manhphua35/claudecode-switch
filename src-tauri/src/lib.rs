use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{Manager, State};

// ── Constants ─────────────────────────────────────────
const ENV_FIELDS: &[&str] = &[
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
];

const MODEL_KEYS: &[&str] = &[
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
];

// ── Types ─────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "authToken")]
    pub auth_token: String,
    #[serde(default)]
    pub models: std::collections::BTreeMap<String, String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProviderStore {
    #[serde(default)]
    pub providers: Vec<Provider>,
    #[serde(rename = "activeId", default)]
    pub active_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ProviderInput {
    pub name: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "authToken", default)]
    pub auth_token: String,
    #[serde(default)]
    pub models: Option<std::collections::BTreeMap<String, String>>,
}

#[derive(Debug, Serialize)]
pub struct ModelEntry {
    pub id: String,
}

#[derive(Debug, Serialize)]
pub struct FetchModelsResponse {
    pub models: Vec<ModelEntry>,
}

#[derive(Debug, Serialize)]
pub struct ApplyResponse {
    pub success: bool,
    #[serde(rename = "activeId")]
    pub active_id: String,
    #[serde(rename = "settingsPath")]
    pub settings_path: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteResponse {
    pub success: bool,
}

#[derive(Debug, Serialize)]
pub struct SettingsResponse {
    pub env: std::collections::BTreeMap<String, String>,
}

// ── Paths state ───────────────────────────────────────
pub struct Paths {
    pub claude_dir: PathBuf,
    pub settings_path: PathBuf,
    pub providers_path: PathBuf,
}

pub struct AppState {
    pub paths: Paths,
    pub store_lock: Mutex<()>,
}

fn claude_dir() -> PathBuf {
    let home = dirs::home_dir().expect("cannot determine home directory");
    home.join(".claude")
}

fn build_paths(app: &tauri::AppHandle) -> Paths {
    let claude = claude_dir();
    let settings_path = claude.join("settings.json");

    let user_data = app
        .path()
        .app_data_dir()
        .expect("cannot resolve app_data_dir");
    let providers_path = user_data.join("providers.json");

    Paths {
        claude_dir: claude,
        settings_path,
        providers_path,
    }
}

// ── Settings helpers ──────────────────────────────────
fn read_settings(path: &Path) -> Map<String, Value> {
    match fs::read_to_string(path) {
        Ok(txt) => match serde_json::from_str::<Value>(&txt) {
            Ok(Value::Object(m)) => m,
            _ => Map::new(),
        },
        Err(_) => Map::new(),
    }
}

fn write_settings(claude_dir: &Path, path: &Path, settings: &Map<String, Value>) -> Result<(), String> {
    if !claude_dir.exists() {
        fs::create_dir_all(claude_dir).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    let s = serde_json::to_string_pretty(&Value::Object(settings.clone()))
        .map_err(|e| format!("serialize failed: {e}"))?;
    fs::write(path, s).map_err(|e| format!("write failed: {e}"))?;
    Ok(())
}

// ── Providers store ───────────────────────────────────
fn read_providers(path: &Path) -> ProviderStore {
    match fs::read_to_string(path) {
        Ok(txt) => serde_json::from_str::<ProviderStore>(&txt).unwrap_or_default(),
        Err(_) => ProviderStore::default(),
    }
}

fn write_providers(path: &Path, store: &ProviderStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
        }
    }
    let s = serde_json::to_string_pretty(store).map_err(|e| format!("serialize failed: {e}"))?;
    fs::write(path, s).map_err(|e| format!("write failed: {e}"))?;
    Ok(())
}

fn normalize_trim(s: &str) -> String {
    s.trim().to_string()
}

fn strip_trailing_slashes(s: &str) -> String {
    s.trim_end_matches('/').to_string()
}

struct NormalizedInput {
    name: String,
    base_url: String,
    auth_token: String,
    models: std::collections::BTreeMap<String, String>,
}

fn normalize_provider_input(body: &ProviderInput) -> Option<NormalizedInput> {
    let name = normalize_trim(&body.name);
    let base_url = strip_trailing_slashes(&normalize_trim(&body.base_url));
    let auth_token = normalize_trim(&body.auth_token);
    if name.is_empty() || base_url.is_empty() {
        return None;
    }

    let mut models = std::collections::BTreeMap::new();
    if let Some(raw) = &body.models {
        for key in MODEL_KEYS {
            if let Some(val) = raw.get(*key) {
                let trimmed = val.trim();
                if !trimmed.is_empty() {
                    models.insert(key.to_string(), trimmed.to_string());
                }
            }
        }
    }
    Some(NormalizedInput {
        name,
        base_url,
        auth_token,
        models,
    })
}

fn apply_provider_to_settings(
    paths: &Paths,
    provider: &Provider,
) -> Result<(), String> {
    let mut settings = read_settings(&paths.settings_path);

    // Ensure env object exists
    let env_value = settings
        .entry("env".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !env_value.is_object() {
        *env_value = Value::Object(Map::new());
    }
    let env_obj = env_value.as_object_mut().unwrap();

    let mut payload: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();
    payload.insert("ANTHROPIC_AUTH_TOKEN".to_string(), provider.auth_token.clone());
    payload.insert("ANTHROPIC_BASE_URL".to_string(), provider.base_url.clone());
    for (k, v) in &provider.models {
        payload.insert(k.clone(), v.clone());
    }

    for key in ENV_FIELDS {
        match payload.get(*key) {
            Some(val) if !val.is_empty() => {
                env_obj.insert((*key).to_string(), Value::String(val.clone()));
            }
            _ => {
                env_obj.remove(*key);
            }
        }
    }

    write_settings(&paths.claude_dir, &paths.settings_path, &settings)
}

// ── Tauri commands ────────────────────────────────────
#[tauri::command]
fn list_providers(state: State<'_, AppState>) -> Result<ProviderStore, String> {
    let _guard = state.store_lock.lock().unwrap();
    Ok(read_providers(&state.paths.providers_path))
}

#[tauri::command]
fn create_provider(
    state: State<'_, AppState>,
    body: ProviderInput,
) -> Result<Provider, String> {
    let input = normalize_provider_input(&body).ok_or_else(|| "Thiếu name hoặc baseUrl".to_string())?;
    let _guard = state.store_lock.lock().unwrap();
    let mut store = read_providers(&state.paths.providers_path);
    let provider = Provider {
        id: uuid::Uuid::new_v4().to_string(),
        name: input.name,
        base_url: input.base_url,
        auth_token: input.auth_token,
        models: input.models,
        created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    };
    store.providers.push(provider.clone());
    write_providers(&state.paths.providers_path, &store)?;
    Ok(provider)
}

#[tauri::command]
fn update_provider(
    state: State<'_, AppState>,
    id: String,
    data: ProviderInput,
) -> Result<Provider, String> {
    let input = normalize_provider_input(&data).ok_or_else(|| "Thiếu name hoặc baseUrl".to_string())?;
    let _guard = state.store_lock.lock().unwrap();
    let mut store = read_providers(&state.paths.providers_path);
    let idx = store
        .providers
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| "Provider không tồn tại".to_string())?;
    let existing = &store.providers[idx];
    let updated = Provider {
        id: existing.id.clone(),
        created_at: existing.created_at.clone(),
        name: input.name,
        base_url: input.base_url,
        auth_token: input.auth_token,
        models: input.models,
    };
    store.providers[idx] = updated.clone();
    write_providers(&state.paths.providers_path, &store)?;
    Ok(updated)
}

#[tauri::command]
fn delete_provider(
    state: State<'_, AppState>,
    id: String,
) -> Result<DeleteResponse, String> {
    let _guard = state.store_lock.lock().unwrap();
    let mut store = read_providers(&state.paths.providers_path);
    let idx = store
        .providers
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| "Provider không tồn tại".to_string())?;
    store.providers.remove(idx);
    if store.active_id.as_deref() == Some(id.as_str()) {
        store.active_id = None;
    }
    write_providers(&state.paths.providers_path, &store)?;
    Ok(DeleteResponse { success: true })
}

#[tauri::command]
fn apply_provider(
    state: State<'_, AppState>,
    id: String,
) -> Result<ApplyResponse, String> {
    let _guard = state.store_lock.lock().unwrap();
    let mut store = read_providers(&state.paths.providers_path);
    let provider = store
        .providers
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or_else(|| "Provider không tồn tại".to_string())?;
    apply_provider_to_settings(&state.paths, &provider)?;
    store.active_id = Some(id.clone());
    write_providers(&state.paths.providers_path, &store)?;
    Ok(ApplyResponse {
        success: true,
        active_id: id,
        settings_path: state.paths.settings_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<SettingsResponse, String> {
    let settings = read_settings(&state.paths.settings_path);
    let mut env = std::collections::BTreeMap::new();
    if let Some(Value::Object(env_obj)) = settings.get("env") {
        for (k, v) in env_obj {
            if let Some(s) = v.as_str() {
                env.insert(k.clone(), s.to_string());
            }
        }
    }
    Ok(SettingsResponse { env })
}

#[tauri::command]
async fn fetch_models(
    base_url: String,
    auth_token: String,
) -> Result<FetchModelsResponse, String> {
    if base_url.trim().is_empty() {
        return Err("Base URL is required".to_string());
    }
    let normalized = strip_trailing_slashes(base_url.trim());
    let url = format!("{normalized}/v1/models");

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("client init failed: {e}"))?;

    let mut req = client.get(&url).header("Accept", "application/json");
    let token = auth_token.trim();
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {token}"));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("kết nối thất bại: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let snippet: String = text.chars().take(200).collect();
        return Err(format!("Provider trả về {}: {}", status.as_u16(), snippet));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("parse JSON thất bại: {e}"))?;

    let raw_models: Vec<Value> = if let Some(arr) = body.as_array() {
        arr.clone()
    } else if let Some(arr) = body.get("data").and_then(|d| d.as_array()) {
        arr.clone()
    } else {
        Vec::new()
    };

    let mut models: Vec<ModelEntry> = raw_models
        .into_iter()
        .filter_map(|m| {
            m.get("id")
                .and_then(|v| v.as_str())
                .map(|s| ModelEntry { id: s.to_string() })
        })
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));

    Ok(FetchModelsResponse { models })
}

// ── Run ───────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let paths = build_paths(app.handle());

            println!("Provider Switcher started");
            println!("  Settings:  {}", paths.settings_path.display());
            println!("  Providers: {}", paths.providers_path.display());

            app.manage(AppState {
                paths,
                store_lock: Mutex::new(()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_providers,
            create_provider,
            update_provider,
            delete_provider,
            apply_provider,
            get_settings,
            fetch_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
