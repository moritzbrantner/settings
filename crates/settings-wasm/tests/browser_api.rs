//! Native tests for the browser API v2 additions: structured load reports, presets, transient
//! overlays, the durable value beneath the effective one and apply-with-confirmation.

use serde_json::{Value, json};
use settings_wasm::SessionCore;

/// The registry the retained persistence fixtures were written against.
fn session() -> SessionCore {
    let definitions = json!([
        {
            "id": "audio.master_volume",
            "kind": { "type": "integer", "min": 0, "max": 100 },
            "default": { "type": "integer", "value": 80 },
            "scope": "user",
            "apply_mode": "immediate"
        },
        {
            "id": "video.fullscreen",
            "kind": { "type": "bool" },
            "default": { "type": "bool", "value": false },
            "scope": "device",
            "apply_mode": "apply"
        },
        {
            "id": "video.quality",
            "kind": { "type": "choice", "options": ["low", "medium", "high"] },
            "default": { "type": "choice", "value": "high" },
            "scope": "device",
            "apply_mode": "apply"
        },
        {
            "id": "video.vsync",
            "kind": { "type": "bool" },
            "default": { "type": "bool", "value": false },
            "scope": "device",
            "apply_mode": "apply"
        }
    ]);
    SessionCore::new(&definitions.to_string()).expect("definitions register")
}

fn state(session: &SessionCore, id: &str) -> Value {
    let states: Vec<Value> = serde_json::from_str(&session.setting_states_json().unwrap()).unwrap();
    states
        .into_iter()
        .find(|state| state["id"] == id)
        .unwrap_or_else(|| panic!("no state for {id}"))
}

fn json_of(raw: String) -> Value {
    serde_json::from_str(&raw).unwrap()
}

fn export(session: &SessionCore, scope: &str) -> Value {
    json_of(session.export_scope_json(scope).unwrap())
}

const VOLUME_65: &str = r#"{"type":"integer","value":65}"#;
const VOLUME_10: &str = r#"{"type":"integer","value":10}"#;
const LOW: &str = r#"{"type":"choice","value":"low"}"#;

#[test]
fn corrupt_fixture_import_reports_each_entry_with_a_reason() {
    let mut session = session();
    let report = json_of(
        session
            .import_scope_report_json(
                "device",
                include_str!("../../../fixtures/persistence/v2-corrupt-device.json"),
            )
            .unwrap(),
    );

    assert_eq!(report["scope"], "device");
    assert_eq!(report["loaded"], json!(["video.vsync"]));
    assert_eq!(
        report["preserved_unknown"],
        json!(["future.renderer.option"])
    );
    assert_eq!(report["migrations"], json!([]));
    let diagnostics = report["diagnostics"].as_array().unwrap();
    let find = |kind: &str| {
        diagnostics
            .iter()
            .find(|diagnostic| diagnostic["type"] == kind)
            .unwrap_or_else(|| panic!("missing {kind} diagnostic"))
    };
    assert_eq!(find("invalid_identifier")["raw_id"], " bad ");
    assert_eq!(find("corrupt_value")["id"], "video.fullscreen");
    assert_eq!(find("invalid_value")["id"], "video.quality");
    assert_eq!(
        find("unknown_setting_preserved")["id"],
        "future.renderer.option"
    );
    for diagnostic in diagnostics {
        if diagnostic["type"] != "unknown_setting_preserved" {
            assert!(
                diagnostic["reason"].as_str().is_some_and(|r| !r.is_empty()),
                "{diagnostic} needs a reason"
            );
        }
    }

    // Rejected entries never become active; the recovered snapshot round-trips canonically.
    assert_eq!(state(&session, "video.quality")["value"]["value"], "high");
    let exported = session.export_scope_json("device").unwrap();
    let mut reloaded = self::session();
    reloaded
        .import_scope_report_json("device", &exported)
        .unwrap();
    assert_eq!(reloaded.export_scope_json("device").unwrap(), exported);
}

#[test]
fn legacy_fixture_import_reports_the_migration_and_its_provenance() {
    let mut session = session();
    let report = json_of(
        session
            .import_scope_report_json(
                "user",
                include_str!("../../../fixtures/persistence/v1-mixed.json"),
            )
            .unwrap(),
    );

    assert_eq!(
        report["migrations"],
        json!([{ "from_version": 1, "to_version": 2 }])
    );
    assert_eq!(report["loaded"], json!(["audio.master_volume"]));
    let volume = state(&session, "audio.master_volume");
    assert_eq!(
        volume["durable_provenance"],
        json!({ "type": "migration", "from_version": 1 })
    );
    assert_eq!(volume["durable_value"]["value"], 55);
}

#[test]
fn overlays_mask_without_destroying_or_exporting_the_durable_preference() {
    let mut session = session();
    session.set_json("audio.master_volume", VOLUME_65).unwrap();
    session
        .set_overlay_json("session", "audio.master_volume", VOLUME_10)
        .unwrap();
    session
        .set_overlay_json(
            "policy",
            "audio.master_volume",
            r#"{"type":"integer","value":20}"#,
        )
        .unwrap();

    let volume = state(&session, "audio.master_volume");
    assert_eq!(volume["value"]["value"], 20);
    assert_eq!(volume["provenance"]["type"], "policy");
    assert_eq!(volume["durable_value"]["value"], 65);
    assert_eq!(volume["durable_provenance"]["type"], "user_override");
    assert_eq!(volume["overlays"]["policy"]["value"], 20);
    assert_eq!(volume["overlays"]["session"]["value"], 10);
    assert!(volume["overlays"].get("command_line").is_none());
    assert_eq!(volume["staged"], false);

    // Neither overlay leaks into the durable snapshot.
    assert_eq!(
        export(&session, "user")["overrides"],
        json!({ "audio.master_volume": { "type": "integer", "value": 65 } })
    );

    // Reset and import change durable preferences only.
    session.reset("audio.master_volume").unwrap();
    let snapshot = json!({ "schema_version": 2, "scope": "user", "overrides": {} });
    session
        .import_scope_report_json("user", &snapshot.to_string())
        .unwrap();
    let volume = state(&session, "audio.master_volume");
    assert_eq!(volume["value"]["value"], 20);
    assert_eq!(volume["durable_provenance"]["type"], "default");

    assert!(
        session
            .clear_overlay("policy", "audio.master_volume")
            .unwrap()
    );
    assert!(
        !session
            .clear_overlay("policy", "audio.master_volume")
            .unwrap()
    );
    assert_eq!(state(&session, "audio.master_volume")["value"]["value"], 10);
    session.clear_overlays("session").unwrap();
    let volume = state(&session, "audio.master_volume");
    assert_eq!(volume["provenance"]["type"], "default");
    assert_eq!(volume["overlays"], json!({}));
}

#[test]
fn overlays_reject_unknown_layers_and_invalid_values() {
    let mut session = session();
    assert!(
        session
            .set_overlay_json("user", "audio.master_volume", VOLUME_10)
            .is_err()
    );
    assert!(
        session
            .set_overlay_json(
                "policy",
                "audio.master_volume",
                r#"{"type":"integer","value":101}"#
            )
            .is_err()
    );
    assert!(session.clear_overlays("preset").is_err());
    assert_eq!(
        state(&session, "audio.master_volume")["overlays"],
        json!({})
    );
}

#[test]
fn setting_states_report_the_default_and_whether_the_value_differs_from_it() {
    let mut session = session();
    let quality = state(&session, "video.quality");
    assert_eq!(quality["default"]["value"], "high");
    assert_eq!(quality["differs_from_default"], false);

    session.stage_set_json("video.quality", LOW).unwrap();
    assert_eq!(
        state(&session, "video.quality")["differs_from_default"],
        true
    );
}

#[test]
fn presets_apply_atomically_across_scopes_with_preset_provenance() {
    let mut session = session();
    let preset = json!({
        "id": "performance",
        "values": {
            "audio.master_volume": { "type": "integer", "value": 80 },
            "video.quality": { "type": "choice", "value": "low" },
            "video.vsync": { "type": "bool", "value": true }
        }
    });
    let changes: Vec<Value> =
        serde_json::from_str(&session.set_preset_json(&preset.to_string()).unwrap()).unwrap();
    let ids: Vec<_> = changes.iter().map(|change| &change["id"]).collect();
    assert_eq!(ids, ["video.quality", "video.vsync"]);
    assert_eq!(changes[0]["after_provenance"]["type"], "preset");
    assert_eq!(
        state(&session, "video.quality")["provenance"]["type"],
        "preset"
    );
    // A preset value equal to the default canonicalizes to no override.
    assert_eq!(state(&session, "audio.master_volume")["overridden"], false);
    assert!(!session.has_staged_changes());

    // One invalid value rejects the whole preset.
    let before = session.export_scope_json("device").unwrap();
    let invalid = json!({
        "id": "broken",
        "values": {
            "video.fullscreen": { "type": "bool", "value": true },
            "video.quality": { "type": "choice", "value": "cinematic" }
        }
    });
    assert!(session.set_preset_json(&invalid.to_string()).is_err());
    let unknown =
        json!({ "id": "broken", "values": { "video.missing": { "type": "bool", "value": true } } });
    assert!(session.stage_preset_json(&unknown.to_string()).is_err());
    assert_eq!(session.export_scope_json("device").unwrap(), before);
    assert!(!session.has_staged_changes());
}

#[test]
fn staged_presets_wait_for_apply() {
    let mut session = session();
    let preset = json!({
        "id": "quality",
        "values": { "video.fullscreen": { "type": "bool", "value": true } }
    });
    let staged: Vec<Value> =
        serde_json::from_str(&session.stage_preset_json(&preset.to_string()).unwrap()).unwrap();
    assert_eq!(staged.len(), 1);
    assert_eq!(export(&session, "device")["overrides"], json!({}));
    assert_eq!(
        state(&session, "video.fullscreen")["committed_value"]["value"],
        false
    );

    session.cancel_staged_json().unwrap();
    assert_eq!(state(&session, "video.fullscreen")["value"]["value"], false);
}

fn session_pending_low_quality(deadline: f64) -> SessionCore {
    let mut session = session();
    session.stage_set_json("video.quality", LOW).unwrap();
    let applied: Vec<Value> = serde_json::from_str(
        &session
            .apply_staged_with_confirmation_json(deadline)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(applied.len(), 1);
    assert_eq!(state(&session, "video.quality")["value"]["value"], "low");
    session
}

#[test]
fn unconfirmed_changes_roll_back_once_the_caller_tick_reaches_the_deadline() {
    let mut session = session_pending_low_quality(10.0);
    assert_eq!(session.confirmation_status(9.0).unwrap(), "pending");
    assert_eq!(session.roll_back_expired_json(9.0).unwrap(), "[]");
    assert_eq!(state(&session, "video.quality")["value"]["value"], "low");

    // A transient overlay set while pending is not part of the rollback.
    session
        .set_overlay_json(
            "command_line",
            "video.vsync",
            r#"{"type":"bool","value":true}"#,
        )
        .unwrap();

    assert_eq!(session.confirmation_status(10.0).unwrap(), "expired");
    assert!(!session.confirm_applied(10.0).unwrap());
    let rollback: Vec<Value> =
        serde_json::from_str(&session.roll_back_expired_json(10.0).unwrap()).unwrap();
    assert_eq!(rollback.len(), 1);
    assert_eq!(rollback[0]["id"], "video.quality");
    assert_eq!(rollback[0]["before"]["value"], "low");
    assert_eq!(rollback[0]["after"]["value"], "high");

    assert_eq!(session.confirmation_status(11.0).unwrap(), "none");
    assert_eq!(state(&session, "video.quality")["value"]["value"], "high");
    assert_eq!(state(&session, "video.vsync")["value"]["value"], true);
    assert_eq!(export(&session, "device")["overrides"], json!({}));
    assert!(!session.has_staged_changes());
}

#[test]
fn confirmed_changes_stay_and_close_the_confirmation() {
    let mut session = session_pending_low_quality(10.0);
    assert!(session.confirm_applied(9.0).unwrap());
    assert_eq!(session.confirmation_status(100.0).unwrap(), "none");
    assert_eq!(session.roll_back_expired_json(100.0).unwrap(), "[]");
    assert_eq!(session.revert_applied_json().unwrap(), "[]");
    assert_eq!(state(&session, "video.quality")["value"]["value"], "low");
}

#[test]
fn explicit_revert_restores_the_baseline_before_the_deadline() {
    let mut session = session_pending_low_quality(10.0);
    // Staged edits made while pending are discarded with the rollback.
    session
        .stage_set_json("video.fullscreen", r#"{"type":"bool","value":true}"#)
        .unwrap();
    let rollback: Vec<Value> =
        serde_json::from_str(&session.revert_applied_json().unwrap()).unwrap();
    assert_eq!(rollback.len(), 1);
    assert_eq!(state(&session, "video.quality")["value"]["value"], "high");
    assert!(!session.has_staged_changes());
    assert_eq!(session.confirmation_status(0.0).unwrap(), "none");
}

#[test]
fn only_one_confirmation_is_open_and_ticks_must_be_exact_integers() {
    let mut session = session_pending_low_quality(10.0);
    assert!(session.apply_staged_with_confirmation_json(20.0).is_err());
    for tick in [f64::NAN, f64::INFINITY, -1.0, 1.5, 9_007_199_254_740_992.0] {
        assert!(session.confirmation_status(tick).is_err(), "{tick}");
        assert!(session.confirm_applied(tick).is_err(), "{tick}");
    }
    assert_eq!(session.confirmation_status(0.0).unwrap(), "pending");
}
