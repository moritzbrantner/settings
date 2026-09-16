/// Storage boundary for one concrete settings snapshot target.
///
/// An adapter instance should represent one storage target, such as a user profile,
/// device profile, savegame, document, or browser-storage key. `settings-core` does
/// not prescribe a filesystem, database, cloud provider, or key scheme.
pub trait AtomicSettingsStorage {
    type Error;

    /// Read the currently committed bytes, or `None` when no snapshot exists.
    fn read(&self) -> Result<Option<Vec<u8>>, Self::Error>;

    /// Durably replace the committed snapshot as one atomic operation.
    ///
    /// Success means the new bytes are the committed value. Failure must not expose
    /// a partially written snapshot: the previous complete value (or no value) must
    /// remain recoverable. Filesystem adapters should normally implement this using
    /// write-to-temporary, durability barriers appropriate to the platform, and an
    /// atomic rename/replace rather than truncating the live file in place.
    fn replace_atomically(&mut self, contents: &[u8]) -> Result<(), Self::Error>;
}
