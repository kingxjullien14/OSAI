//! One place that suppresses the child-process console window on Windows.
//!
//! In a *built* app there is no parent console, so any `std::process::Command`
//! spawned without `CREATE_NO_WINDOW` pops its OWN conhost window. On a polled
//! path (the dashboard's `git` repo-pulse, the usage `curl`, `ccusage`) that
//! reads to the user as "the app keeps spamming new terminals". `.no_window()`
//! sets the flag on Windows and is a no-op everywhere else, so every spawn site
//! can call it unconditionally.

/// Extension trait: chain `.no_window()` into a `Command` builder before the
/// terminal `.output()` / `.spawn()` / `.status()` call.
pub trait NoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl NoWindow for std::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}
