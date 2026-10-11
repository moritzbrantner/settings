//! Native tests for the browser session's committed/staged state, provenance and availability.

use serde_json::{Value, json};
use settings_wasm::SessionCore;

fn session() -> SessionCore {
    let definitions = json!([
        {
            "id": "audio.volume",
            "kind": { "type": "integer", "min": 0, "max": 100 },
            "default": { "type": "integer", "value": 80 },
            "scope": "user",
            "apply_mode": "immediate"
        },
        {
            "id": "video.mode",
            "kind": { "type": "choice", "options": ["windowed", "fullscreen"] },
            "default": { "type": "choice", "value": "windowed" },
            "scope": "device",
            "apply_mode": "apply"
        },
        {
            "id": "video.hdr",
            "kind": { "type": "bool" },
            "default": { "type": "bool", "value": false },
            "scope": "device",
            "apply_mode": "restart",
            "availability": {
                "condition": { "op": "capability", "id": "renderer.hdr", "expected": true },
                "when_unavailable": "disable"
            }
        }
    ]);
    SessionCore::new(&definitions.to_string()).expect("definitions register")
}

fn values(session: &SessionCore) -> Value {
    serde_json::from_str(&session.effective_values_json().unwrap()).unwrap()
}

fn state(session: &SessionCore, id: &str) -> Value {
    let states: Vec<Value> = serde_json::from_str(&session.setting_states_json().unwrap()).unwrap();
    states
        .into_iter()
        .find(|state| state["id"] == id)
        .unwrap_or_else(|| panic!("no state for {id}"))
}

fn changes(json: String) -> Vec<Value> {
    serde_json::from_str(&json).unwrap()
}

const FULLSCREEN: &str = r#"{"type":"choice","value":"fullscreen"}"#;

#[test]
fn direct_writes_commit_and_mirror_into_the_staged_state() {
    let mut session = session();
    session
        .set_json("audio.volume", r#"{"type":"integer","value":40}"#)
        .unwrap();

    assert_eq!(values(&session)["audio.volume"]["value"], 40);
    assert!(!session.has_staged_changes());
    let volume = state(&session, "audio.volume");
    assert_eq!(volume["value"]["value"], 40);
    assert_eq!(volume["provenance"]["type"], "user_override");
    assert_eq!(volume["overridden"], true);
    assert_eq!(volume["staged"], false);
}

#[test]
fn staged_writes_wait_for_apply_and_cancel_restores_the_committed_state() {
    let mut session = session();
    session.stage_set_json("video.mode", FULLSCREEN).unwrap();

    assert!(session.has_staged_changes());
    assert_eq!(values(&session)["video.mode"]["value"], "windowed");
    let mode = state(&session, "video.mode");
    assert_eq!(mode["value"]["value"], "fullscreen");
    assert_eq!(mode["committed_value"]["value"], "windowed");
    assert_eq!(mode["staged"], true);
    let pending = changes(session.staged_changes_json().unwrap());
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0]["apply_mode"], "apply");

    let reverted = changes(session.cancel_staged_json().unwrap());
    assert_eq!(reverted[0]["after"]["value"], "windowed");
    assert!(!session.has_staged_changes());
    assert_eq!(
        state(&session, "video.mode")["provenance"]["type"],
        "default"
    );

    session.stage_set_json("video.mode", FULLSCREEN).unwrap();
    let applied = changes(session.apply_staged_json().unwrap());
    assert_eq!(applied.len(), 1);
    assert_eq!(applied[0]["before_provenance"]["type"], "default");
    assert_eq!(applied[0]["after_provenance"]["type"], "user_override");
    assert_eq!(values(&session)["video.mode"]["value"], "fullscreen");
    assert!(!session.has_staged_changes());
}

#[test]
fn staged_section_and_global_resets_remove_overrides_instead_of_copying_defaults() {
    let mut session = session();
    session
        .set_json("audio.volume", r#"{"type":"integer","value":10}"#)
        .unwrap();
    session.set_json("video.mode", FULLSCREEN).unwrap();

    session.stage_reset_many_json(r#"["video.mode"]"#).unwrap();
    session.apply_staged_json().unwrap();
    assert_eq!(state(&session, "video.mode")["overridden"], false);
    assert_eq!(state(&session, "audio.volume")["overridden"], true);
    let device: Value =
        serde_json::from_str(&session.export_scope_json("device").unwrap()).unwrap();
    assert!(
        device["overrides"]
            .as_object()
            .is_none_or(|values| values.is_empty())
    );

    session.set_json("video.mode", FULLSCREEN).unwrap();
    session.stage_reset_all();
    assert_eq!(values(&session)["audio.volume"]["value"], 10);
    session.apply_staged_json().unwrap();
    assert_eq!(values(&session)["audio.volume"]["value"], 80);
    assert_eq!(
        state(&session, "audio.volume")["provenance"]["type"],
        "default"
    );
    assert_eq!(state(&session, "video.mode")["overridden"], false);
}

#[test]
fn list_resets_are_atomic_when_an_id_is_unknown() {
    let mut session = session();
    session.set_json("video.mode", FULLSCREEN).unwrap();

    assert!(
        session
            .stage_reset_many_json(r#"["video.mode","missing"]"#)
            .is_err()
    );
    assert!(
        session
            .reset_many_json(r#"["video.mode","missing"]"#)
            .is_err()
    );
    assert_eq!(state(&session, "video.mode")["overridden"], true);
    assert!(!session.has_staged_changes());

    session
        .reset_many_json(r#"["video.mode","audio.volume"]"#)
        .unwrap();
    assert_eq!(state(&session, "video.mode")["overridden"], false);
}

#[test]
fn invalid_values_never_reach_either_layer() {
    let mut session = session();
    for value in [
        r#"{"type":"integer","value":101}"#,
        r#"{"type":"integer","value":1.5}"#,
        r#"{"type":"number","value":1}"#,
        r#"{"type":"integer","value":null}"#,
    ] {
        assert!(session.set_json("audio.volume", value).is_err(), "{value}");
        assert!(
            session.stage_set_json("audio.volume", value).is_err(),
            "{value}"
        );
    }
    assert_eq!(state(&session, "audio.volume")["overridden"], false);
    assert!(!session.has_staged_changes());
}

#[test]
fn availability_uses_caller_capability_facts() {
    let mut session = session();
    let hdr = state(&session, "video.hdr");
    assert_eq!(hdr["availability"]["status"], "disabled");
    assert_eq!(
        hdr["availability"]["reasons"][0]["type"],
        "missing_capability"
    );

    session
        .set_capabilities_json(r#"{"renderer.hdr":false}"#)
        .unwrap();
    let hdr = state(&session, "video.hdr");
    assert_eq!(
        hdr["availability"]["reasons"][0]["type"],
        "capability_mismatch"
    );

    session
        .set_capabilities_json(r#"{"renderer.hdr":true}"#)
        .unwrap();
    assert_eq!(
        state(&session, "video.hdr")["availability"]["status"],
        "available"
    );
    assert_eq!(
        state(&session, "audio.volume")["availability"]["status"],
        "available"
    );
}

#[test]
fn import_replaces_the_committed_scope_and_discards_its_staged_changes() {
    let mut session = session();
    session.stage_set_json("video.mode", FULLSCREEN).unwrap();
    let snapshot = json!({
        "schema_version": 2,
        "scope": "device",
        "overrides": {}
    });
    session
        .import_scope_json("device", &snapshot.to_string())
        .unwrap();
    assert!(!session.has_staged_changes());
    assert_eq!(state(&session, "video.mode")["value"]["value"], "windowed");
}

#[test]
fn setting_states_follow_registry_order_not_registration_order() {
    let session = session();
    let states: Vec<Value> = serde_json::from_str(&session.setting_states_json().unwrap()).unwrap();
    let ids: Vec<_> = states
        .iter()
        .map(|state| state["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["audio.volume", "video.hdr", "video.mode"]);
}

const BOOL_TRUE: &str = r#"{"type":"bool","value":true}"#;

fn cross_scope_session() -> SessionCore {
    let definitions = json!([
        {
            "id": "profile.advanced",
            "kind": { "type": "bool" },
            "default": { "type": "bool", "value": false },
            "scope": "user",
            "apply_mode": "apply"
        },
        {
            "id": "video.advanced",
            "kind": { "type": "bool" },
            "default": { "type": "bool", "value": false },
            "scope": "device",
            "apply_mode": "apply",
            "availability": {
                "condition": {
                    "op": "setting_equals",
                    "id": "profile.advanced",
                    "value": { "type": "bool", "value": true }
                },
                "when_unavailable": "disable"
            }
        },
        {
            "id": "video.exclusive",
            "kind": { "type": "bool" },
            "default": { "type": "bool", "value": false },
            "scope": "device",
            "apply_mode": "apply"
        },
        {
            "id": "profile.exclusive",
            "kind": { "type": "bool" },
            "default": { "type": "bool", "value": false },
            "scope": "user",
            "apply_mode": "apply",
            "availability": {
                "condition": {
                    "op": "setting_equals",
                    "id": "video.exclusive",
                    "value": { "type": "bool", "value": true }
                },
                "when_unavailable": "disable"
            }
        }
    ]);
    SessionCore::new(&definitions.to_string()).expect("cross-scope definitions register")
}

fn assert_requires_true(session: &SessionCore, target: &str, dependency: &str) {
    let availability = &state(session, target)["availability"];
    assert_eq!(availability["status"], "disabled");
    assert_eq!(availability["reasons"][0]["type"], "setting_value_mismatch");
    assert_eq!(availability["reasons"][0]["id"], dependency);
    assert_eq!(availability["reasons"][0]["expected"]["value"], true);
    assert_eq!(availability["reasons"][0]["actual"]["value"], false);
}

#[test]
fn availability_uses_staged_dependencies_across_scopes_in_both_directions() {
    let mut session = cross_scope_session();
    assert_requires_true(&session, "video.advanced", "profile.advanced");
    assert_requires_true(&session, "profile.exclusive", "video.exclusive");

    session
        .stage_set_json("profile.advanced", BOOL_TRUE)
        .unwrap();
    // The user preference is not committed, but the device control is already available.
    assert_eq!(values(&session)["profile.advanced"]["value"], false);
    assert_eq!(state(&session, "profile.advanced")["staged"], true);
    assert_eq!(
        state(&session, "video.advanced")["availability"]["status"],
        "available"
    );
    assert_eq!(
        state(&session, "video.advanced")["provenance"]["type"],
        "default"
    );

    session
        .stage_set_json("video.exclusive", BOOL_TRUE)
        .unwrap();
    assert_eq!(values(&session)["video.exclusive"]["value"], false);
    assert_eq!(
        state(&session, "profile.exclusive")["availability"]["status"],
        "available"
    );

    session.cancel_staged_json().unwrap();
    assert!(!session.has_staged_changes());
    assert_requires_true(&session, "video.advanced", "profile.advanced");
    assert_requires_true(&session, "profile.exclusive", "video.exclusive");
}

#[test]
fn cross_scope_availability_tracks_apply_scoped_reset_and_global_reset() {
    let mut session = cross_scope_session();
    session
        .stage_set_json("profile.advanced", BOOL_TRUE)
        .unwrap();
    session
        .stage_set_json("video.exclusive", BOOL_TRUE)
        .unwrap();
    session.apply_staged_json().unwrap();

    assert_eq!(
        state(&session, "video.advanced")["availability"]["status"],
        "available"
    );
    assert_eq!(
        state(&session, "profile.exclusive")["availability"]["status"],
        "available"
    );
    assert_eq!(
        state(&session, "profile.advanced")["provenance"]["type"],
        "user_override"
    );
    assert_eq!(
        state(&session, "video.exclusive")["provenance"]["type"],
        "user_override"
    );

    // Scoped exports must not mix in a dependency from another scope.
    let user: Value = serde_json::from_str(&session.export_scope_json("user").unwrap()).unwrap();
    let device: Value =
        serde_json::from_str(&session.export_scope_json("device").unwrap()).unwrap();
    assert!(user["overrides"].get("profile.advanced").is_some());
    assert!(user["overrides"].get("video.exclusive").is_none());
    assert!(device["overrides"].get("video.exclusive").is_some());
    assert!(device["overrides"].get("profile.advanced").is_none());

    session
        .stage_reset_many_json(r#"["profile.advanced"]"#)
        .unwrap();
    assert_eq!(values(&session)["profile.advanced"]["value"], true);
    assert_requires_true(&session, "video.advanced", "profile.advanced");
    assert_eq!(
        state(&session, "profile.exclusive")["availability"]["status"],
        "available"
    );
    session.cancel_staged_json().unwrap();
    assert_eq!(
        state(&session, "video.advanced")["availability"]["status"],
        "available"
    );

    session.stage_reset_all();
    assert_eq!(values(&session)["video.exclusive"]["value"], true);
    assert_requires_true(&session, "video.advanced", "profile.advanced");
    assert_requires_true(&session, "profile.exclusive", "video.exclusive");
    session.apply_staged_json().unwrap();
    assert!(!session.has_staged_changes());
    assert_eq!(
        state(&session, "profile.advanced")["provenance"]["type"],
        "default"
    );
    assert_eq!(state(&session, "video.exclusive")["overridden"], false);
    for scope in ["user", "device"] {
        let exported: Value =
            serde_json::from_str(&session.export_scope_json(scope).unwrap()).unwrap();
        assert!(exported["overrides"].as_object().unwrap().is_empty());
    }

    // The immediate reset API also updates the aggregate staged availability.
    session.set_json("profile.advanced", BOOL_TRUE).unwrap();
    assert_eq!(
        state(&session, "video.advanced")["availability"]["status"],
        "available"
    );
    session.reset("profile.advanced").unwrap();
    assert_requires_true(&session, "video.advanced", "profile.advanced");
}
