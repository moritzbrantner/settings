use settings_adapters::{AdapterDescriptor, AdapterInstallError, install_adapter_descriptor};
use settings_core::{CapabilityFacts, CapabilityId, SettingsRegistry};

fn capability(value: &str) -> CapabilityId {
    CapabilityId::new(value).unwrap()
}

#[test]
fn contradictory_capabilities_inside_one_descriptor_fail_independent_of_order() {
    for values in [[true, false], [false, true]] {
        let descriptor = AdapterDescriptor::new([])
            .with_capability(capability("renderer.hdr"), values[0])
            .with_capability(capability("renderer.hdr"), values[1]);
        let mut registry = SettingsRegistry::new();
        let mut capabilities = CapabilityFacts::new();

        let error = install_adapter_descriptor(&mut registry, &mut capabilities, &descriptor)
            .expect_err("contradictory duplicate facts must fail closed");

        assert!(matches!(
            error,
            AdapterInstallError::CapabilityConflict { .. }
        ));
        assert!(registry.is_empty());
        assert_eq!(capabilities.get(&capability("renderer.hdr")), None);
    }
}

#[test]
fn duplicate_equal_capabilities_are_idempotent() {
    let descriptor = AdapterDescriptor::new([])
        .with_capability(capability("renderer.hdr"), true)
        .with_capability(capability("renderer.hdr"), true);
    let mut registry = SettingsRegistry::new();
    let mut capabilities = CapabilityFacts::new();

    install_adapter_descriptor(&mut registry, &mut capabilities, &descriptor).unwrap();

    assert_eq!(capabilities.get(&capability("renderer.hdr")), Some(true));
}
