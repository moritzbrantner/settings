#![no_main]

use libfuzzer_sys::fuzz_target;
use settings_core::{SettingScope, import_scope_json};

fuzz_target!(|data: &[u8]| {
    let Ok(json) = std::str::from_utf8(data) else {
        return;
    };
    let registry = settings_fuzz::registry();

    for scope in [SettingScope::User, SettingScope::Device, SettingScope::Save] {
        let _ = import_scope_json(&registry, scope, json);
    }
});
