#![no_main]

use libfuzzer_sys::fuzz_target;
use serde_json::{Map, Value};
use settings_core::{SettingScope, import_scope_json};

fuzz_target!(|data: &[u8]| {
    let Ok(mut document) = serde_json::from_slice::<Value>(data) else {
        return;
    };
    let Value::Object(object) = &mut document else {
        return;
    };

    object.insert("schema_version".into(), Value::from(1));
    object.remove("scope");
    object
        .entry("overrides")
        .or_insert_with(|| Value::Object(Map::new()));

    let json = document.to_string();
    let registry = settings_fuzz::registry();
    for scope in [SettingScope::User, SettingScope::Device, SettingScope::Save] {
        let _ = import_scope_json(&registry, scope, &json);
    }
});
