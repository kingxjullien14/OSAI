//! OSAI — desktop cockpit. Lean Tauri shell: multi-pane PTY terminals + the
//! oracle roster (attach to bridge-managed tmux sessions). No IDE cruft.

mod appcast;
#[cfg(target_os = "windows")]
mod wincast;
mod bridges;
mod browser;
mod browser_store;
mod chat;
mod chat_api;
mod chat_history;
mod apikeys;
mod control;
mod device;
mod diag;
mod files;
mod lsp;
mod mac_apps;
mod memory;
mod model_catalog;
mod monitor;
mod oracles;
mod plugins;
mod proc;
mod pty;
mod snc;
mod stats;
mod telemetry;
mod usage;
mod voice;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

#[tauri::command]
fn read_telemetry() -> telemetry::Telemetry {
    telemetry::collect()
}

/// Whether closing the window hides to the tray (Windows/Linux) instead of
/// quitting. The frontend mirrors the `minimizeToTray` setting into this via
/// `set_close_to_tray`. macOS ignores it (it keeps the dock background). The
/// AUTHORITATIVE close behavior lives in Rust (`on_window_event` below) so it
/// can't be defeated by JS event-bridge timing — the earlier frontend-only
/// `onCloseRequested` approach didn't reliably let the window close.
#[derive(Default)]
struct CloseToTray(AtomicBool);

#[tauri::command]
fn set_close_to_tray(state: tauri::State<CloseToTray>, enabled: bool) {
    state.0.store(enabled, Ordering::SeqCst);
}

/// Builds the native macOS app menu and installs it.
///
/// WHY THIS EXISTS (R2a — the urgent fix): cockpit shortcuts (⌘F exit-fullscreen,
/// ⌘W close, ⌘1-9 jump, ⌘K/⌘B/⌘M, etc.) were registered ONLY via a React
/// `window.addEventListener("keydown")`. When focus sits inside a NATIVE child
/// webview — a browser pane (its own WKWebView) or a terminal (xterm grabs keys)
/// — those keystrokes never bubble up to the React webview, so every cockpit
/// shortcut DIED exactly when a pane was focused. the user got stuck unable to exit
/// a fullscreen browser pane.
///
/// A real app-MENU accelerator fires whenever the app is frontmost REGARDLESS of
/// which webview holds focus — and, unlike `tauri-plugin-global-shortcut`, it does
/// NOT hijack the shortcut system-wide across other apps. So every menu item below
/// emits a `menu-action` event the React side listens for and routes into the
/// SAME handlers the in-React keydown fallback already calls.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    // App submenu (the "OSAI" menu) — keep the standard about/quit so ⌘Q works.
    let app_menu = SubmenuBuilder::new(app, "OSAI")
        .item(&PredefinedMenuItem::about(app, None, None)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    // Edit submenu — without these the standard ⌘C/⌘V/⌘X/⌘A/⌘Z stop working once
    // we install a custom menu (a menu REPLACES the default, so the OS edit verbs
    // must be re-declared or copy/paste breaks inside every webview).
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    // Pane submenu — the cockpit shortcuts. Each id is matched in on_menu_event
    // and forwarded to the React handler via the `menu-action` event.
    //
    // NOTE on Escape: muda/macOS does NOT accept a bare "Escape" as a menu
    // accelerator (no modifier), so the URGENT exit-fullscreen path is bound to
    // ⌘F (toggle) AND given its own explicit "Exit Full Screen" item on ⌘. so
    // there are two reliable, webview-independent ways out of fullscreen.
    let exit_fs = MenuItemBuilder::with_id("pane:exit-fullscreen", "Exit Full Screen")
        .accelerator("CmdOrCtrl+.")
        .build(app)?;
    let toggle_fs = MenuItemBuilder::with_id("pane:toggle-fullscreen", "Toggle Pane Full Screen")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let new_term = MenuItemBuilder::with_id("pane:new", "New Terminal / Pane")
        .accelerator("CmdOrCtrl+T")
        .build(app)?;
    let close_pane = MenuItemBuilder::with_id("pane:close", "Close Pane")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let palette = MenuItemBuilder::with_id("pane:palette", "Command Palette")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;
    // ⌘P fuzzy file finder + ⌘⇧F global content search. Routed through the native
    // menu (not just window.keydown) so they fire even while focus is inside a
    // terminal/browser child webview — same reasoning as the rest of the Pane menu.
    let file_finder = MenuItemBuilder::with_id("pane:file-finder", "Find File…")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let global_search = MenuItemBuilder::with_id("pane:global-search", "Search in Files…")
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;
    // DevTools for the focused browser pane (R5 item 3). ⌥⌘I = the standard
    // "Web Inspector" accelerator; routed via the native menu so it fires even
    // when focus is inside the browser child webview.
    let devtools = MenuItemBuilder::with_id("pane:open-devtools", "Open DevTools")
        .accelerator("Alt+CmdOrCtrl+I")
        .build(app)?;
    let sidebar = MenuItemBuilder::with_id("pane:sidebar", "Toggle Sidebar")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;
    let minimize = MenuItemBuilder::with_id("pane:minimize", "Hide Pane")
        .accelerator("CmdOrCtrl+M")
        .build(app)?;
    // NOTE: muda's accelerator parser has no mapping for the backtick char, so
    // `CmdOrCtrl+\`` would silently parse to no-accelerator. The in-React keydown
    // handler keeps ⌘` working when the React webview is focused; the menu item
    // stays clickable (and works over a focused webview via click) but carries no
    // accelerator to avoid a misleading/dead shortcut label.
    let overview = MenuItemBuilder::with_id("pane:overview", "Pane Overview").build(app)?;

    let mut pane_builder = SubmenuBuilder::new(app, "Pane")
        .item(&exit_fs)
        .item(&toggle_fs)
        .separator()
        .item(&new_term)
        .item(&close_pane)
        .separator()
        .item(&palette)
        .item(&file_finder)
        .item(&global_search)
        .item(&devtools)
        .item(&sidebar)
        .item(&minimize)
        .item(&overview)
        .separator();

    // ⌘1 … ⌘9 — jump to the Nth open pane. Built in a loop so each carries its
    // own arg (the 1-based index) decoded from the id in on_menu_event.
    let mut jump_items = Vec::new();
    for n in 1..=9u8 {
        let item = MenuItemBuilder::with_id(format!("pane:jump:{n}"), format!("Go to Pane {n}"))
            .accelerator(format!("CmdOrCtrl+{n}"))
            .build(app)?;
        jump_items.push(item);
    }
    for item in &jump_items {
        pane_builder = pane_builder.item(item);
    }
    let pane_menu = pane_builder.build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&pane_menu)
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

/// Routes a native menu click into the React cockpit. The id encodes the action
/// (and, for `pane:jump:N`, the arg). The React side has a `listen("menu-action")`
/// that dispatches into the exact same handlers as the in-React keydown fallback.
fn handle_menu_event(app: &tauri::AppHandle, id: &str) {
    if let Some(rest) = id.strip_prefix("pane:") {
        let (action, arg): (&str, Option<u8>) = if let Some(n) = rest.strip_prefix("jump:") {
            ("jump", n.parse().ok())
        } else {
            (rest, None)
        };
        let _ = app.emit(
            "menu-action",
            serde_json::json!({ "action": action, "arg": arg }),
        );
    }
}

#[tauri::command]
fn startup_open_pane() -> Option<String> {
    std::env::var("OSAI_OPEN_PANE")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows has no $HOME, but nearly every data source here keys off it (usage
    // stats, the memory vault, the file browser, JSONL telemetry). Alias it to
    // %USERPROFILE% once at startup so every `std::env::var("HOME")` across the
    // backend resolves correctly — this is what makes the homescreen show the
    // current user's real data on Windows.
    #[cfg(windows)]
    if std::env::var_os("HOME").is_none() {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            std::env::set_var("HOME", profile);
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(pty::PtyState::new())
        // App-cast (ScreenCaptureKit "native app as a pane" spike) session map.
        .manage(appcast::AppCastState::default())
        // close-to-tray flag (mirrors the minimizeToTray setting; see below).
        .manage(CloseToTray::default())
        // AUTHORITATIVE window-close behavior (not the JS handler): on
        // Windows/Linux, hide to the tray when the setting is on, otherwise let
        // the window close (→ app exits). macOS is left to the frontend's dock
        // logic. This is what actually makes X quit on Windows.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Windows/Linux: WE own the close, fully and explicitly. ALWAYS
                // prevent the native close first — that also short-circuits
                // Tauri's JS `close-requested` bridge, which otherwise raced
                // this handler and left X doing NOTHING on the built app when
                // the tray setting was off. Then decide: hide to the tray
                // (setting on) or quit outright — `app.exit(0)` fires
                // RunEvent::Exit (→ LSP cleanup) and ends the process, no
                // reliance on the flaky default close→ExitRequested chain.
                // macOS is left to the frontend's dock logic: this whole block
                // compiles out there.
                #[cfg(not(target_os = "macos"))]
                {
                    api.prevent_close();
                    if window
                        .app_handle()
                        .state::<CloseToTray>()
                        .0
                        .load(Ordering::SeqCst)
                    {
                        let _ = window.hide();
                    } else {
                        window.app_handle().exit(0);
                    }
                }
                let _ = (window, api);
            }
        })
        .setup(|app| {
            // Desktop self-update (GitHub Releases, signed minisign). Registered
            // here rather than in the builder chain so it stays cleanly gated to
            // desktop — `tauri-plugin-updater` has no mobile support. The
            // `process` plugin backs the post-install `relaunch()` on the JS side
            // (src/lib/updater.ts). pubkey + endpoint live in tauri.conf.json.
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }

            // Boot the local-first diagnostics store (Phase 0+1): resolve the
            // per-bundle app-data dir (portable — a fork gets its own dir, no
            // dependency on the user's ~/.osai), seed the anon install id, and
            // install the Rust panic hook so backend panics persist as
            // DiagEvents instead of dying silently. Soft-fail: if the dir can't
            // resolve we just skip diag (never block startup).
            if let Ok(dir) = app.path().app_data_dir() {
                let version = app.package_info().version.to_string();
                diag::init(dir.clone(), version);
                // Persistent browser history/bookmarks/downloads store (same
                // app-data dir, JSON files — see browser_store.rs for the
                // "why JSON not sqlite" rationale). Soft-fail if dir missing.
                browser_store::init(dir);
            }

            // Control plane (Tier 2): a localhost HTTP server that lets an external
            // agent drive the app (emit → App.tsx dispatchControl). No-op unless
            // OSAI_CONTROL=1 — off by default, token-gated, 127.0.0.1 only.
            control::start_control_server(app.handle().clone());

            // Install the native menu so cockpit accelerators (⌘F/⌘W/⌘1-9/…)
            // fire even when a child webview holds focus (R2a urgent fix).
            // macOS ONLY: there the menu lives in the system menu bar for free;
            // on Windows it rendered as an in-window "OSAI Edit Pane" strip that
            // ate a row of chrome (user-reported). The in-React keydown handler
            // covers every chord when the main webview has focus.
            #[cfg(target_os = "macos")]
            if let Err(e) = build_app_menu(app.handle()) {
                eprintln!("[osai menu] failed to install app menu: {e}");
            }

            // System tray: a Show / Quit menu + left-click-to-show, so a window
            // hidden by the "minimize to tray" setting (or the macOS dock
            // background) is always recoverable AND quittable. Created on every
            // platform; harmless when unused. Soft-fail — a tray that won't
            // build must never block startup.
            let tray_menu = MenuBuilder::new(app.handle())
                .item(&MenuItemBuilder::with_id("tray_show", "Show OSAI").build(app.handle())?)
                .item(&PredefinedMenuItem::separator(app.handle())?)
                .item(&MenuItemBuilder::with_id("tray_quit", "Quit OSAI").build(app.handle())?)
                .build()?;
            let mut tray = TrayIconBuilder::with_id("osai-tray")
                .tooltip("OSAI")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "tray_show" => show_main_window(app),
                    // a real quit — bypasses the macOS busy-keep-alive arm.
                    "tray_quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            if let Err(e) = tray.build(app.handle()) {
                eprintln!("[osai tray] failed to build tray icon: {e}");
            }
            Ok(())
        })
        .on_menu_event(|app, event| handle_menu_event(app, event.id().0.as_str()))
        .invoke_handler(tauri::generate_handler![
            read_telemetry,
            diag::diag_report,
            diag::diag_recent,
            diag::diag_clear,
            diag::diag_info,
            startup_open_pane,
            pty::pty_spawn,
            pty::pty_spawn_oracle,
            pty::pty_spawn_tmux,
            // Registered on every platform: tmux-backed (persistent) on unix, a
            // plain PTY on Windows — see pty::pty_spawn_terminal.
            pty::pty_spawn_terminal,
            pty::pty_write,
            pty::pty_paste,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_set_label,
            pty::pty_reap_terminals,
            // LSP supervisor (lsp.rs) — process spawn + framed pipe; protocol
            // intelligence lives in src/lib/lsp/ on the TS side.
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            lsp::lsp_status,
            lsp::lsp_find_root,
            set_close_to_tray,
            control::osai_control_status,
            control::osai_set_control,
            apikeys::osai_set_api_key,
            apikeys::osai_delete_api_key,
            apikeys::osai_has_api_key,
            apikeys::osai_list_api_keys,
            snc::snc_status,
            snc::snc_configure,
            snc::snc_disconnect,
            snc::snc_fetch,
            model_catalog::refresh_model_catalog,
            oracles::list_oracles,
            oracles::list_tmux_sessions,
            oracles::create_oracle,
            oracles::rename_oracle,
            oracles::delete_oracle,
            oracles::kill_tmux_session,
            oracles::appshot,
            files::read_dir,
            files::read_dir_tree,
            files::git_status,
            files::git_pulse,
            files::shell_source_status,
            files::detect_project,
            files::list_projects,
            files::scan_workspaces,
            files::detect_workspace,
            files::suggested_scan_roots,
            files::preview_workspace_context,
            files::generate_workspace_context,
            files::home_dir,
            files::read_file_preview,
            files::read_text_file,
            files::write_text_file,
            files::file_mtime,
            files::delete_path,
            files::fs_create_file,
            files::fs_create_dir,
            files::fs_rename,
            files::fs_trash,
            files::convert_office_to_pdf,
            files::save_image_temp,
            files::find_files,
            files::resolve_in_cwd,
            files::search_in_files,
            files::ui_state_load,
            files::ui_state_save,
            voice::transcribe_available,
            voice::transcribe_audio,
            plugins::list_plugins,
            browser::browser_zoom,
            browser::browser_clear_cookies,
            browser::browser_device_mode,
            browser::browser_screenshot,
            browser::browser_enter_annotate,
            browser::browser_exit_annotate,
            browser::browser_copy_selection,
            browser::browser_extract_page,
            browser::read_clipboard,
            usage::usage_stats,
            usage::codex_usage,
            usage::claude_usage,
            memory::memory_graph,
            memory::memory_file,
            memory::memory_search,
            memory::memory_save,
            memory::memory_delete,
            memory::memory_focus,
            stats::usage_extras,
            device::device_stats,
            bridges::list_bridges,
            bridges::bridge_activity,
            bridges::pair_personal_wa,
            mac_apps::mac_list_apps,
            mac_apps::mac_focus_app,
            mac_apps::mac_capture_app,
            monitor::monitor_start,
            monitor::monitor_stop,
            monitor::list_monitors,
            chat::chat_start,
            chat::set_local_api_endpoint,
            chat::chat_send,
            chat::chat_steer,
            chat::chat_interrupt,
            chat::chat_send_raw,
            chat::chat_stop,
            chat::chat_detach,
            chat::chat_reattach,
            chat::chat_set_title,
            chat::list_chat_live,
            chat::list_chat_sessions,
            chat::record_chat_session,
            chat::read_chat_transcript,
            chat_history::read_chat_history,
            chat_history::chat_history_meta,
            chat_history::save_chat_tree,
            chat_history::load_chat_tree,
            chat_history::list_chat_history,
            chat_history::set_starred,
            chat_history::delete_chats,
            chat_history::restore_chats,
            chat_history::purge_trash,
            chat_history::list_trash,
            chat_history::export_chat,
            chat_history::search_chat_history,
            chat::detect_providers,
            browser::browser_show,
            browser::browser_set_bounds,
            browser::browser_current_url,
            browser::browser_fullscreen_state,
            browser::set_window_fullscreen,
            browser::browser_navigate,
            browser::browser_back,
            browser::browser_forward,
            browser::browser_reload,
            browser::browser_force_reload,
            browser::browser_nav_state,
            browser::browser_open_devtools,
            browser::browser_eval_result,
            browser::browser_eval,
            browser::browser_click,
            browser::browser_type,
            browser::browser_scroll,
            browser::browser_find,
            browser::browser_clear_cache,
            browser::browser_hide,
            browser::browser_close,
            browser_store::browser_history_record,
            browser_store::browser_history_query,
            browser_store::browser_history_clear,
            browser_store::browser_bookmark_add,
            browser_store::browser_bookmark_remove,
            browser_store::browser_bookmark_list,
            browser_store::browser_download_record,
            browser_store::browser_download_list,
            browser_store::browser_download_forget,
            browser_store::browser_download_clear,
            browser_store::browser_reveal_in_finder,
            // App-cast (ScreenCaptureKit native-app-as-a-pane spike, Phase A).
            appcast::appcast_list_windows,
            appcast::appcast_start,
            appcast::appcast_set_bounds,
            appcast::appcast_hide,
            appcast::appcast_show,
            appcast::appcast_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // `_app` (not `app`): the only consumers are the macOS-gated arms below,
        // so on Windows/Linux the param is unused — the underscore keeps it
        // warning-free there while staying usable in the mac arms.
        .run(|_app, event| match event {
            // macOS only: a busy agent keeps the app alive in the dock (X just
            // hides the window; Reopen brings it back). Windows/Linux have no
            // dock/tray here, so preventing exit would make X do nothing and
            // leave an unquittable ghost — there, the app must quit on close.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::ExitRequested { api, .. } if chat::has_busy_sessions() => {
                api.prevent_exit();
                show_main_window(_app);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                show_main_window(_app);
            }
            // App is exiting — kill any GUI-spawned language servers so node /
            // rust-analyzer processes never outlive the cockpit as orphans.
            tauri::RunEvent::Exit => {
                lsp::kill_all_servers();
            }
            _ => {}
        });
}

// Called by the tray (all platforms) + the macOS dock arms.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
