//! Deterministic appearance preference semantics layered over `settings-core`.
//!
//! This crate owns only reusable preference choices and resolution against caller-supplied system
//! appearance facts. It does not own palettes, CSS, renderer post-processing, operating-system
//! theme detection, color grading, or accessibility cue design.

use serde::{Deserialize, Serialize};
use settings_core::{
    ApplyMode, RegistryError, SettingDefinition, SettingId, SettingKind, SettingScope,
    SettingValue, SettingsRegistry, SettingsState,
};
use thiserror::Error;

pub const COLOR_SCHEME_SETTING_ID: &str = "appearance.color_scheme";
pub const CONTRAST_SETTING_ID: &str = "appearance.contrast";
pub const COLOR_VISION_SETTING_ID: &str = "appearance.color_vision";
pub const NIGHT_MODE_SETTING_ID: &str = "appearance.night_mode";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColorSchemePreference {
    System,
    Light,
    Dark,
}

impl ColorSchemePreference {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "system" => Some(Self::System),
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            _ => None,
        }
    }

    fn options() -> Vec<String> {
        [Self::System, Self::Light, Self::Dark]
            .into_iter()
            .map(|value| value.as_str().to_owned())
            .collect()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContrastPreference {
    System,
    Normal,
    High,
    Low,
}

impl ContrastPreference {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Normal => "normal",
            Self::High => "high",
            Self::Low => "low",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "system" => Some(Self::System),
            "normal" => Some(Self::Normal),
            "high" => Some(Self::High),
            "low" => Some(Self::Low),
            _ => None,
        }
    }

    fn options() -> Vec<String> {
        [Self::System, Self::Normal, Self::High, Self::Low]
            .into_iter()
            .map(|value| value.as_str().to_owned())
            .collect()
    }
}

/// A request for a palette that remains distinguishable for the selected color-vision profile.
///
/// This is an accessibility preference, not a diagnosis and not a request to simulate a vision
/// deficiency by filtering the final framebuffer. Consumers should use it to select palettes and
/// redundant visual cues appropriate to their domain.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColorVisionAssistMode {
    Off,
    Protanopia,
    Deuteranopia,
    Tritanopia,
    Achromatopsia,
}

impl ColorVisionAssistMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Protanopia => "protanopia",
            Self::Deuteranopia => "deuteranopia",
            Self::Tritanopia => "tritanopia",
            Self::Achromatopsia => "achromatopsia",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "off" => Some(Self::Off),
            "protanopia" => Some(Self::Protanopia),
            "deuteranopia" => Some(Self::Deuteranopia),
            "tritanopia" => Some(Self::Tritanopia),
            "achromatopsia" => Some(Self::Achromatopsia),
            _ => None,
        }
    }

    fn options() -> Vec<String> {
        [
            Self::Off,
            Self::Protanopia,
            Self::Deuteranopia,
            Self::Tritanopia,
            Self::Achromatopsia,
        ]
        .into_iter()
        .map(|value| value.as_str().to_owned())
        .collect()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolvedColorScheme {
    Light,
    Dark,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolvedContrast {
    Normal,
    High,
    Low,
}

/// Caller-supplied platform facts used only when a preference follows the system.
///
/// `None` means the platform fact is genuinely unknown. Resolution fails instead of silently
/// guessing a light/normal fallback.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemAppearance {
    pub color_scheme: Option<ResolvedColorScheme>,
    pub contrast: Option<ResolvedContrast>,
}

impl SystemAppearance {
    pub fn known(color_scheme: ResolvedColorScheme, contrast: ResolvedContrast) -> Self {
        Self {
            color_scheme: Some(color_scheme),
            contrast: Some(contrast),
        }
    }
}

/// Consumer-owned defaults for the canonical appearance settings.
///
/// There is intentionally no `Default` implementation: applications must choose defaults rather
/// than inheriting policy from this foundation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppearanceDefaults {
    pub color_scheme: ColorSchemePreference,
    pub contrast: ContrastPreference,
    pub color_vision: ColorVisionAssistMode,
    pub night_mode: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppearanceSettingIds {
    pub color_scheme: SettingId,
    pub contrast: SettingId,
    pub color_vision: SettingId,
    pub night_mode: SettingId,
}

impl AppearanceSettingIds {
    pub fn canonical() -> Self {
        Self {
            color_scheme: SettingId::new(COLOR_SCHEME_SETTING_ID)
                .expect("canonical appearance setting id is valid"),
            contrast: SettingId::new(CONTRAST_SETTING_ID)
                .expect("canonical appearance setting id is valid"),
            color_vision: SettingId::new(COLOR_VISION_SETTING_ID)
                .expect("canonical appearance setting id is valid"),
            night_mode: SettingId::new(NIGHT_MODE_SETTING_ID)
                .expect("canonical appearance setting id is valid"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppearancePreferences {
    pub color_scheme: ColorSchemePreference,
    pub contrast: ContrastPreference,
    pub color_vision: ColorVisionAssistMode,
    /// Low-light/night presentation is independent from light/dark and contrast. A consumer may
    /// warm or dim its palette, but must not silently replace the other resolved preferences.
    pub night_mode: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResolvedAppearance {
    pub color_scheme: ResolvedColorScheme,
    pub contrast: ResolvedContrast,
    pub color_vision: ColorVisionAssistMode,
    pub night_mode: bool,
}

#[derive(Clone, Debug, PartialEq, Error)]
pub enum AppearanceError {
    #[error("appearance setting `{0}` is not registered")]
    MissingSetting(SettingId),
    #[error("appearance setting `{id}` has unexpected value {value:?}")]
    UnexpectedValue { id: SettingId, value: SettingValue },
    #[error("appearance setting `{id}` contains unsupported choice `{value}`")]
    UnsupportedChoice { id: SettingId, value: String },
    #[error("color scheme follows the system, but the system color-scheme fact is unknown")]
    MissingSystemColorScheme,
    #[error("contrast follows the system, but the system contrast fact is unknown")]
    MissingSystemContrast,
}

/// Atomically installs the canonical appearance definitions into an ordinary settings registry.
///
/// All four settings are immediate user preferences. The caller remains authoritative for their
/// defaults and for applying the resulting appearance to a UI or renderer.
pub fn install_appearance_settings(
    registry: &mut SettingsRegistry,
    defaults: AppearanceDefaults,
) -> Result<AppearanceSettingIds, RegistryError> {
    let ids = AppearanceSettingIds::canonical();
    let mut candidate = registry.clone();

    candidate.register(choice_definition(
        ids.color_scheme.clone(),
        ColorSchemePreference::options(),
        defaults.color_scheme.as_str(),
    ))?;
    candidate.register(choice_definition(
        ids.contrast.clone(),
        ContrastPreference::options(),
        defaults.contrast.as_str(),
    ))?;
    candidate.register(choice_definition(
        ids.color_vision.clone(),
        ColorVisionAssistMode::options(),
        defaults.color_vision.as_str(),
    ))?;
    candidate.register(SettingDefinition {
        id: ids.night_mode.clone(),
        kind: SettingKind::Bool,
        default: SettingValue::Bool(defaults.night_mode),
        scope: SettingScope::User,
        apply_mode: ApplyMode::Immediate,
        availability: None,
    })?;

    *registry = candidate;
    Ok(ids)
}

/// Reads the currently effective appearance preferences, including policy/command-line/session
/// overlays according to `settings-core` precedence.
pub fn read_appearance_preferences(
    registry: &SettingsRegistry,
    state: &SettingsState,
) -> Result<AppearancePreferences, AppearanceError> {
    let ids = AppearanceSettingIds::canonical();

    Ok(AppearancePreferences {
        color_scheme: ColorSchemePreference::parse(read_choice(
            registry,
            state,
            &ids.color_scheme,
        )?)
        .ok_or_else(|| unsupported_choice(registry, state, &ids.color_scheme))?,
        contrast: ContrastPreference::parse(read_choice(registry, state, &ids.contrast)?)
            .ok_or_else(|| unsupported_choice(registry, state, &ids.contrast))?,
        color_vision: ColorVisionAssistMode::parse(read_choice(
            registry,
            state,
            &ids.color_vision,
        )?)
        .ok_or_else(|| unsupported_choice(registry, state, &ids.color_vision))?,
        night_mode: read_bool(registry, state, &ids.night_mode)?,
    })
}

/// Resolves only preferences that explicitly follow caller-supplied system facts.
///
/// Each dimension remains independent. In particular, night mode never forces dark mode and never
/// downgrades an explicit high-contrast request.
pub fn resolve_appearance(
    preferences: AppearancePreferences,
    system: SystemAppearance,
) -> Result<ResolvedAppearance, AppearanceError> {
    let color_scheme = match preferences.color_scheme {
        ColorSchemePreference::System => system
            .color_scheme
            .ok_or(AppearanceError::MissingSystemColorScheme)?,
        ColorSchemePreference::Light => ResolvedColorScheme::Light,
        ColorSchemePreference::Dark => ResolvedColorScheme::Dark,
    };

    let contrast = match preferences.contrast {
        ContrastPreference::System => system
            .contrast
            .ok_or(AppearanceError::MissingSystemContrast)?,
        ContrastPreference::Normal => ResolvedContrast::Normal,
        ContrastPreference::High => ResolvedContrast::High,
        ContrastPreference::Low => ResolvedContrast::Low,
    };

    Ok(ResolvedAppearance {
        color_scheme,
        contrast,
        color_vision: preferences.color_vision,
        night_mode: preferences.night_mode,
    })
}

pub fn resolve_effective_appearance(
    registry: &SettingsRegistry,
    state: &SettingsState,
    system: SystemAppearance,
) -> Result<ResolvedAppearance, AppearanceError> {
    resolve_appearance(read_appearance_preferences(registry, state)?, system)
}

fn choice_definition(id: SettingId, options: Vec<String>, default: &str) -> SettingDefinition {
    SettingDefinition {
        id,
        kind: SettingKind::Choice { options },
        default: SettingValue::Choice(default.to_owned()),
        scope: SettingScope::User,
        apply_mode: ApplyMode::Immediate,
        availability: None,
    }
}

fn read_choice<'a>(
    registry: &'a SettingsRegistry,
    state: &'a SettingsState,
    id: &SettingId,
) -> Result<&'a str, AppearanceError> {
    match effective_value(registry, state, id)? {
        SettingValue::Choice(value) => Ok(value.as_str()),
        value => Err(AppearanceError::UnexpectedValue {
            id: id.clone(),
            value: value.clone(),
        }),
    }
}

fn read_bool(
    registry: &SettingsRegistry,
    state: &SettingsState,
    id: &SettingId,
) -> Result<bool, AppearanceError> {
    match effective_value(registry, state, id)? {
        SettingValue::Bool(value) => Ok(*value),
        value => Err(AppearanceError::UnexpectedValue {
            id: id.clone(),
            value: value.clone(),
        }),
    }
}

fn effective_value<'a>(
    registry: &'a SettingsRegistry,
    state: &'a SettingsState,
    id: &SettingId,
) -> Result<&'a SettingValue, AppearanceError> {
    state
        .effective_value(registry, id)
        .ok_or_else(|| AppearanceError::MissingSetting(id.clone()))
}

fn unsupported_choice(
    registry: &SettingsRegistry,
    state: &SettingsState,
    id: &SettingId,
) -> AppearanceError {
    let value = state
        .effective_value(registry, id)
        .and_then(|value| match value {
            SettingValue::Choice(value) => Some(value.clone()),
            _ => None,
        })
        .unwrap_or_default();
    AppearanceError::UnsupportedChoice {
        id: id.clone(),
        value,
    }
}
