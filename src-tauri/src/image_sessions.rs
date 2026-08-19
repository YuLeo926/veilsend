use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::Serialize;
use sharegate_core::{DEFAULT_MAX_IMAGE_BYTES, fingerprint};
use uuid::Uuid;

#[derive(Debug, Clone)]
enum ImageSource {
    File { canonical_path: PathBuf },
    Clipboard { encoded_bytes: Vec<u8> },
}

#[derive(Debug, Clone)]
struct StoredImageSession {
    id: String,
    source: ImageSource,
    fingerprint: String,
    filename: String,
    source_kind: ImageSourceKind,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImageSourceKind {
    File,
    Clipboard,
}

#[derive(Debug, Clone)]
pub struct ImageSessionSummary {
    pub id: String,
    pub fingerprint: String,
    pub filename: String,
    pub source_kind: ImageSourceKind,
}

#[derive(Debug)]
pub struct ResolvedImageSession {
    pub bytes: Vec<u8>,
    pub fingerprint: String,
    pub filename: String,
    pub original_path: Option<PathBuf>,
}

#[derive(Default)]
pub struct ImageSessionStore(Mutex<Option<StoredImageSession>>);

impl ImageSessionStore {
    pub fn replace_file(&self, path: &Path) -> Result<ImageSessionSummary, String> {
        let canonical_path = path.canonicalize().map_err(|_| {
            "The selected image could not be resolved. Choose the file again.".to_owned()
        })?;
        let bytes = read_source_file(&canonical_path)?;
        let filename = canonical_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_owned();
        self.replace(
            ImageSource::File { canonical_path },
            fingerprint(&bytes),
            filename,
            ImageSourceKind::File,
        )
    }

    pub fn replace_clipboard(&self, encoded_bytes: Vec<u8>) -> Result<ImageSessionSummary, String> {
        if encoded_bytes.is_empty() {
            return Err("The clipboard image was empty.".to_owned());
        }
        if encoded_bytes.len() > DEFAULT_MAX_IMAGE_BYTES {
            return Err(format!(
                "The pasted screenshot is larger than ShareGate's {} MB local safety limit.",
                DEFAULT_MAX_IMAGE_BYTES / 1024 / 1024
            ));
        }
        let source_fingerprint = fingerprint(&encoded_bytes);
        self.replace(
            ImageSource::Clipboard { encoded_bytes },
            source_fingerprint,
            "clipboard-screenshot.png".to_owned(),
            ImageSourceKind::Clipboard,
        )
    }

    pub fn resolve(&self, id: &str) -> Result<ResolvedImageSession, String> {
        let stored = self
            .0
            .lock()
            .map_err(|_| "The active image session could not be opened.".to_owned())?
            .as_ref()
            .filter(|session| session.id == id)
            .cloned()
            .ok_or_else(|| {
                "This image session has expired. Choose or paste the image again.".to_owned()
            })?;

        let (bytes, original_path) = match stored.source {
            ImageSource::File { canonical_path } => {
                let bytes = read_source_file(&canonical_path)?;
                (bytes, Some(canonical_path))
            }
            ImageSource::Clipboard { encoded_bytes } => (encoded_bytes, None),
        };
        if fingerprint(&bytes) != stored.fingerprint {
            return Err(
                "The source image changed after review. Choose it again before saving.".to_owned(),
            );
        }

        Ok(ResolvedImageSession {
            bytes,
            fingerprint: stored.fingerprint,
            filename: stored.filename,
            original_path,
        })
    }

    pub fn clear(&self) -> Result<(), String> {
        *self
            .0
            .lock()
            .map_err(|_| "The active image session could not be cleared.".to_owned())? = None;
        Ok(())
    }

    fn replace(
        &self,
        source: ImageSource,
        source_fingerprint: String,
        filename: String,
        source_kind: ImageSourceKind,
    ) -> Result<ImageSessionSummary, String> {
        let stored = StoredImageSession {
            id: Uuid::new_v4().to_string(),
            source,
            fingerprint: source_fingerprint,
            filename,
            source_kind,
        };
        let summary = ImageSessionSummary {
            id: stored.id.clone(),
            fingerprint: stored.fingerprint.clone(),
            filename: stored.filename.clone(),
            source_kind: stored.source_kind,
        };
        *self
            .0
            .lock()
            .map_err(|_| "The new image session could not be stored.".to_owned())? = Some(stored);
        Ok(summary)
    }
}

fn read_source_file(path: &Path) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path)
        .map_err(|_| "The selected image could not be read. Choose it again.".to_owned())?;
    let mut bytes = Vec::new();
    file.take(DEFAULT_MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "The selected image could not be read. Choose it again.".to_owned())?;
    if bytes.len() > DEFAULT_MAX_IMAGE_BYTES {
        return Err(format!(
            "This image is larger than ShareGate's {} MB local safety limit.",
            DEFAULT_MAX_IMAGE_BYTES / 1024 / 1024
        ));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacing_a_clipboard_session_expires_the_previous_bytes() {
        let store = ImageSessionStore::default();
        let first = store.replace_clipboard(vec![1, 2, 3]).unwrap();
        let second = store.replace_clipboard(vec![4, 5, 6]).unwrap();

        assert!(store.resolve(&first.id).is_err());
        assert_eq!(
            store.resolve(&second.id).unwrap().fingerprint,
            second.fingerprint
        );
    }

    #[test]
    fn clearing_expires_the_active_session() {
        let store = ImageSessionStore::default();
        let session = store.replace_clipboard(vec![7, 8, 9]).unwrap();

        store.clear().unwrap();

        assert!(store.resolve(&session.id).is_err());
    }
}
