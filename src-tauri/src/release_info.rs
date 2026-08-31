use serde::Serialize;

use crate::{windows_faces, windows_ocr};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Capability {
    Available,
    Unavailable,
}

impl Capability {
    const fn from_available(is_available: bool) -> Self {
        if is_available {
            Self::Available
        } else {
            Self::Unavailable
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectorCapabilities {
    pub text: Capability,
    pub metadata: Capability,
    pub face: Capability,
    pub qr: Capability,
    pub barcode: Capability,
    pub pdf: Capability,
}

impl DetectorCapabilities {
    #[cfg(test)]
    fn all_available() -> Self {
        Self {
            text: Capability::Available,
            metadata: Capability::Available,
            face: Capability::Available,
            qr: Capability::Available,
            barcode: Capability::Available,
            pdf: Capability::Available,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub app_version: String,
    pub channel: String,
    pub commit: String,
    pub verified_build: bool,
    pub target: String,
    pub os_version: String,
    pub license: String,
    pub detectors: DetectorCapabilities,
}

pub fn runtime_info() -> RuntimeInfo {
    build_runtime_info(
        env!("CARGO_PKG_VERSION"),
        Some(env!("VEILSEND_GIT_SHA")),
        Some(env!("VEILSEND_RELEASE_CHANNEL")),
        &format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        &windows_version(),
        detector_capabilities(),
    )
}

fn build_runtime_info(
    app_version: &str,
    git_sha: Option<&str>,
    release_channel: Option<&str>,
    target: &str,
    os_version: &str,
    detectors: DetectorCapabilities,
) -> RuntimeInfo {
    let verified_build = release_channel == Some("beta") && is_full_git_sha(git_sha);
    let channel = if verified_build {
        "beta"
    } else {
        "development"
    };
    let commit = if verified_build {
        git_sha.expect("verified builds have a Git SHA")[..12].to_owned()
    } else {
        "unverified".to_owned()
    };

    RuntimeInfo {
        app_version: app_version.to_owned(),
        channel: channel.to_owned(),
        commit,
        verified_build,
        target: target.to_owned(),
        os_version: os_version.to_owned(),
        license: env!("CARGO_PKG_LICENSE").to_owned(),
        detectors,
    }
}

fn is_full_git_sha(value: Option<&str>) -> bool {
    value.is_some_and(|sha| sha.len() == 40 && sha.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

fn detector_capabilities() -> DetectorCapabilities {
    DetectorCapabilities {
        text: Capability::from_available(windows_ocr::is_available()),
        metadata: Capability::Available,
        face: Capability::from_available(windows_faces::is_available()),
        qr: Capability::Available,
        barcode: Capability::Available,
        pdf: Capability::from_available(cfg!(target_os = "windows")),
    }
}

#[cfg(target_os = "windows")]
fn windows_version() -> String {
    use windows::System::Profile::AnalyticsInfo;

    let value = AnalyticsInfo::VersionInfo()
        .and_then(|info| info.DeviceFamilyVersion())
        .ok()
        .and_then(|value| value.to_string_lossy().parse::<u64>().ok());
    value
        .map(|value| {
            format!(
                "{}.{}.{}.{}",
                (value >> 48) & 0xffff,
                (value >> 32) & 0xffff,
                (value >> 16) & 0xffff,
                value & 0xffff,
            )
        })
        .unwrap_or_else(|| "unknown".to_owned())
}

#[cfg(not(target_os = "windows"))]
fn windows_version() -> String {
    "not-windows".to_owned()
}

#[cfg(test)]
mod tests {
    use super::{DetectorCapabilities, build_runtime_info};

    #[test]
    fn official_identity_requires_the_ci_channel_and_full_sha() {
        let info = build_runtime_info(
            "0.2.0-beta.1",
            Some("0123456789abcdef0123456789abcdef01234567"),
            Some("beta"),
            "windows-x86_64",
            "10.0.26100.0",
            DetectorCapabilities::all_available(),
        );
        assert!(info.verified_build);
        assert_eq!(info.commit, "0123456789ab");

        let local = build_runtime_info(
            "0.2.0-beta.1",
            None,
            None,
            "windows-x86_64",
            "unknown",
            DetectorCapabilities::all_available(),
        );
        assert!(!local.verified_build);
        assert_eq!(local.commit, "unverified");
        assert_eq!(local.channel, "development");
    }

    #[test]
    fn invalid_or_non_beta_identity_is_unverified() {
        for (sha, channel) in [
            (None, Some("beta")),
            (Some("0123456789ab"), Some("beta")),
            (
                Some("0123456789abcdef0123456789abcdef0123456g"),
                Some("beta"),
            ),
            (Some("0123456789abcdef0123456789abcdef01234567"), None),
            (
                Some("0123456789abcdef0123456789abcdef01234567"),
                Some("stable"),
            ),
            (
                Some("0123456789abcdef0123456789abcdef01234567"),
                Some("Beta"),
            ),
            (Some(""), Some("beta")),
            (Some("0123456789abcdef0123456789abcdef01234567"), Some("")),
        ] {
            let info = build_runtime_info(
                "0.2.0-beta.1",
                sha,
                channel,
                "windows-x86_64",
                "unknown",
                DetectorCapabilities::all_available(),
            );
            assert!(!info.verified_build, "sha={sha:?}, channel={channel:?}");
            assert_eq!(info.commit, "unverified");
            assert_eq!(info.channel, "development");
        }
    }

    #[test]
    fn serializes_the_runtime_shape_in_camel_case() {
        let info = build_runtime_info(
            "0.2.0-beta.1",
            Some("0123456789abcdef0123456789abcdef01234567"),
            Some("beta"),
            "windows-x86_64",
            "10.0.26100.0",
            DetectorCapabilities::all_available(),
        );

        let value = serde_json::to_value(info).unwrap();
        assert_eq!(value["appVersion"], "0.2.0-beta.1");
        assert_eq!(value["verifiedBuild"], true);
        assert_eq!(value["detectors"]["text"], "available");
    }
}
