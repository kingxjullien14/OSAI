//! Windows app-cast (W4-8b, Phase A: capture + mirror, NO input forwarding).
//!
//! The Windows twin of `appcast.rs`: Windows forbids reparenting another
//! process's window into ours just as macOS does, so we CAPTURE the target
//! window's pixels live (Windows.Graphics.Capture — the OS-blessed, GPU-
//! resident path) and present them into a native child HWND we DO own,
//! position-synced over a React slot exactly like the mac CALayer float.
//!
//! Pipeline (frames stay on the GPU — never copied through JS):
//!   EnumWindows → pick HWND  (appcast_list_windows picker rows)
//!   IGraphicsCaptureItemInterop::CreateForWindow(hwnd) → GraphicsCaptureItem
//!   D3D11CreateDevice (BGRA) → IDirect3DDevice (WinRT wrapper)
//!   Direct3D11CaptureFramePool::CreateFreeThreaded(BGRA8, 2 buffers)
//!   FrameArrived (threadpool) → ID3D11Texture2D → CopyResource → backbuffer
//!     → IDXGISwapChain1::Present  (DXGI_SCALING_STRETCH absorbs slot resizes
//!        between pool recreations, so bounds-sync never tears)
//!   the swapchain's HWND is a WS_CHILD of the Tauri main window whose wndproc
//!   answers WM_NCHITTEST with HTTRANSPARENT — display-only, the Windows
//!   equivalent of the mac overlay's `ignoresMouseEvents = true`.
//!
//! THREADING: every HWND op (create/move/show/destroy) marshals to the MAIN
//! thread via `run_on_main_thread` — a window belongs to its creating thread's
//! message queue, and only the main thread pumps. The D3D/capture stack is
//! free-threaded: setup runs on the command's worker thread, frames arrive on
//! a WinRT threadpool thread, and one Mutex serializes all GPU work.
//!
//! The parent HWND comes from raw-window-handle (an isize), NOT
//! `tauri::Window::hwnd()`, so this file never depends on tauri's own
//! `windows`-crate version unifying with ours.

#![cfg(target_os = "windows")]

use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use windows::core::Interface;
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_ALPHA_MODE_IGNORE, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    IDXGIDevice, IDXGIFactory2, IDXGISwapChain1, DXGI_PRESENT, DXGI_SCALING_STRETCH,
    DXGI_SWAP_CHAIN_DESC1, DXGI_SWAP_CHAIN_FLAG, DXGI_SWAP_EFFECT_FLIP_DISCARD,
    DXGI_USAGE_RENDER_TARGET_OUTPUT,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, EnumWindows, GetClientRect,
    GetWindowLongW, GetWindowTextW, GetWindowThreadProcessId, IsWindow, IsWindowVisible,
    RegisterClassW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HTTRANSPARENT, SWP_NOACTIVATE,
    SWP_NOZORDER, SW_HIDE, SW_SHOW, WINDOW_EX_STYLE, WM_NCHITTEST, WNDCLASSW, WS_CHILD,
    WS_CLIPSIBLINGS, WS_EX_TOOLWINDOW, WS_VISIBLE,
};

use crate::appcast::WindowInfo;

// ─────────────────────────────────────────────────────────────────────────────
// state
// ─────────────────────────────────────────────────────────────────────────────

/// windows-core 0.61 deliberately does NOT mark COM interfaces Send/Sync (raw
/// COM thread-safety is the caller's contract). This wrapper restores Send for
/// exactly the types this module shares across threads, with the justification:
///   - ID3D11Device is fully free-threaded by D3D11 API contract;
///   - ID3D11DeviceContext (immediate) + IDXGISwapChain1 may be used from any
///     thread WITH external synchronization — every use here is serialized
///     behind one Mutex (the `gpu` tuple below);
///   - WinRT Graphics.Capture runtime classes (session/frame pool/device
///     wrapper) are agile objects.
/// Never exposed outside this module.
struct SendWrap<T>(T);
unsafe impl<T> Send for SendWrap<T> {}
unsafe impl<T> Sync for SendWrap<T> {}
impl<T> SendWrap<T> {
    /// Accessor instead of field access INSIDE closures: Rust 2021 precise
    /// capture would otherwise capture the bare `.0` field (the non-Send
    /// interface) and skip the wrapper entirely.
    fn get(&self) -> &T {
        &self.0
    }
}

/// One live mirror: the capture objects + the child HWND (stored as isize —
/// HWND itself is a raw pointer and not Send; the integer travels fine and is
/// only turned back into an HWND on the main thread).
pub struct CastSession {
    child: isize,
    session: SendWrap<GraphicsCaptureSession>,
    pool: SendWrap<Direct3D11CaptureFramePool>,
    frame_token: i64,
}

/// Managed by tauri (`.manage(appcast::AppCastState::default())` in lib.rs —
/// the name is shared with the mac module via the re-export in appcast.rs).
#[derive(Default)]
pub struct AppCastState(pub Mutex<HashMap<String, CastSession>>);

// ─────────────────────────────────────────────────────────────────────────────
// picker — enumerate capturable top-level windows
// ─────────────────────────────────────────────────────────────────────────────

extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
    let out = unsafe { &mut *(lparam.0 as *mut Vec<WindowInfo>) };
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() {
            return true.into();
        }
        // tool windows (floating palettes, hidden helpers) aren't pane material
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if ex & WS_EX_TOOLWINDOW.0 != 0 {
            return true.into();
        }
        // cloaked = DWM-hidden (UWP suspended, other virtual desktops)
        let mut cloaked: u32 = 0;
        let _ = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut _,
            std::mem::size_of::<u32>() as u32,
        );
        if cloaked != 0 {
            return true.into();
        }
        // a real title, a non-trivial client area, and not AIOS itself
        let mut title_buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut title_buf);
        if n <= 0 {
            return true.into();
        }
        let title = String::from_utf16_lossy(&title_buf[..n as usize]);
        let mut rect = windows::Win32::Foundation::RECT::default();
        if GetClientRect(hwnd, &mut rect).is_err() {
            return true.into();
        }
        if rect.right - rect.left < 80 || rect.bottom - rect.top < 60 {
            return true.into();
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 || pid == GetCurrentProcessId() {
            return true.into();
        }
        // owning exe (full path doubles as the "bundle id"; basename = app name)
        let mut exe_path = String::new();
        if let Ok(proc) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            if QueryFullProcessImageNameW(
                proc,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut len,
            )
            .is_ok()
            {
                exe_path = String::from_utf16_lossy(&buf[..len as usize]);
            }
            let _ = windows::Win32::Foundation::CloseHandle(proc);
        }
        let app_name = exe_path
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
            .trim_end_matches(".exe")
            .trim_end_matches(".EXE")
            .to_string();
        out.push(WindowInfo {
            app_name: if app_name.is_empty() { "app".into() } else { app_name },
            window_title: title,
            // HWNDs fit in 32 bits even on Win64 (documented guarantee)
            window_id: (hwnd.0 as usize as u32),
            pid: pid as i32,
            bundle_id: exe_path,
        });
    }
    true.into()
}

pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
    let mut out: Vec<WindowInfo> = Vec::new();
    unsafe {
        EnumWindows(Some(enum_cb), LPARAM(&mut out as *mut _ as isize))
            .map_err(|e| format!("EnumWindows failed: {e}"))?;
    }
    Ok(out)
}

// ─────────────────────────────────────────────────────────────────────────────
// child HWND — the display-only surface floated over the React slot
// ─────────────────────────────────────────────────────────────────────────────

const CLASS_NAME: windows::core::PCWSTR = windows::core::w!("AIOS_WINCAST_HOST");

extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    // Phase A is display-only: hit-tests fall straight through to whatever is
    // beneath (the mac overlay's ignoresMouseEvents, in Win32 dialect).
    if msg == WM_NCHITTEST {
        return LRESULT(HTTRANSPARENT as isize);
    }
    unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
}

/// MAIN THREAD ONLY. Registers the class once (idempotent: re-registration
/// fails and is ignored) and creates the child at physical-pixel bounds.
unsafe fn create_child(parent: isize, x: i32, y: i32, w: i32, h: i32) -> Result<isize, String> {
    let hinstance = GetModuleHandleW(None).map_err(|e| e.to_string())?;
    let class = WNDCLASSW {
        lpfnWndProc: Some(wndproc),
        hInstance: hinstance.into(),
        lpszClassName: CLASS_NAME,
        ..Default::default()
    };
    let _ = RegisterClassW(&class); // 0 on re-register — fine
    let child = CreateWindowExW(
        WINDOW_EX_STYLE(0),
        CLASS_NAME,
        windows::core::w!(""),
        WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
        x,
        y,
        w.max(1),
        h.max(1),
        Some(HWND(parent as *mut _)),
        None,
        Some(hinstance.into()),
        None,
    )
    .map_err(|e| format!("CreateWindowExW failed: {e}"))?;
    Ok(child.0 as isize)
}

/// The Tauri main window's HWND via raw-window-handle (version-neutral isize).
fn main_window_hwnd(app: &AppHandle) -> Result<(tauri::WebviewWindow, isize, f64), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let handle = main.window_handle().map_err(|e| e.to_string())?;
    let raw: isize = match handle.as_raw() {
        RawWindowHandle::Win32(h) => h.hwnd.get(),
        _ => return Err("unexpected window handle kind".into()),
    };
    Ok((main, raw, scale))
}

/// Logical (CSS px from the frontend) → physical device px.
fn phys(v: f64, scale: f64) -> i32 {
    (v * scale).round() as i32
}

// ─────────────────────────────────────────────────────────────────────────────
// capture pipeline
// ─────────────────────────────────────────────────────────────────────────────

fn create_d3d() -> Result<(ID3D11Device, ID3D11DeviceContext, IDirect3DDevice), String> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            Default::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
        .map_err(|e| format!("D3D11CreateDevice failed: {e}"))?;
    }
    let device = device.ok_or("no D3D11 device")?;
    let context = context.ok_or("no D3D11 context")?;
    let dxgi: IDXGIDevice = device.cast().map_err(|e| e.to_string())?;
    let inspectable =
        unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }.map_err(|e| e.to_string())?;
    let winrt_device: IDirect3DDevice = inspectable.cast().map_err(|e| e.to_string())?;
    Ok((device, context, winrt_device))
}

fn create_swapchain(
    device: &ID3D11Device,
    hwnd: isize,
    width: u32,
    height: u32,
) -> Result<IDXGISwapChain1, String> {
    let dxgi: IDXGIDevice = device.cast().map_err(|e| e.to_string())?;
    let adapter = unsafe { dxgi.GetAdapter() }.map_err(|e| e.to_string())?;
    let factory: IDXGIFactory2 = unsafe { adapter.GetParent() }.map_err(|e| e.to_string())?;
    let desc = DXGI_SWAP_CHAIN_DESC1 {
        Width: width.max(1),
        Height: height.max(1),
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
        BufferCount: 2,
        // STRETCH: the backbuffer tracks the CAPTURED size; the child window
        // tracks the SLOT size — DXGI scales on present, so bounds-sync and
        // source resizes can never tear each other.
        Scaling: DXGI_SCALING_STRETCH,
        SwapEffect: DXGI_SWAP_EFFECT_FLIP_DISCARD,
        AlphaMode: DXGI_ALPHA_MODE_IGNORE,
        ..Default::default()
    };
    unsafe {
        factory
            .CreateSwapChainForHwnd(device, HWND(hwnd as *mut _), &desc, None, None)
            .map_err(|e| format!("CreateSwapChainForHwnd failed: {e}"))
    }
}

pub fn start(
    app: &AppHandle,
    label: String,
    window_id: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let state = app.state::<AppCastState>();
    // already mirroring → treat as a bounds update (mirrors the mac contract)
    if state.0.lock().unwrap().contains_key(&label) {
        return set_bounds(app, label, x, y, width, height);
    }

    let target = HWND(window_id as usize as *mut _);
    if !unsafe { IsWindow(Some(target)) }.as_bool() {
        return Err("that window is gone — refresh the picker".into());
    }

    // 1) child HWND on the main thread, at physical px
    let (main, parent_raw, scale) = main_window_hwnd(app)?;
    let (px, py, pw, ph) = (phys(x, scale), phys(y, scale), phys(width, scale), phys(height, scale));
    let (tx, rx) = mpsc::channel();
    main
        .run_on_main_thread(move || {
            let r = unsafe { create_child(parent_raw, px, py, pw, ph) };
            let _ = tx.send(r);
        })
        .map_err(|e| e.to_string())?;
    let child = rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "child window creation timed out".to_string())??;

    // 2) capture stack (free-threaded — fine on this worker thread)
    let built: Result<CastSession, String> = (|| {
        let (device, context, winrt_device) = create_d3d()?;
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(|e| e.to_string())?;
        let item: GraphicsCaptureItem =
            unsafe { interop.CreateForWindow(target) }.map_err(|e| {
                format!("CreateForWindow failed (window may not be capturable): {e}")
            })?;
        let size = item.Size().map_err(|e| e.to_string())?;
        let swapchain = create_swapchain(&device, child, size.Width as u32, size.Height as u32)?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )
        .map_err(|e| e.to_string())?;

        // FrameArrived: copy the captured texture into the backbuffer, present,
        // and recreate the pool + resize the backbuffer when the SOURCE window
        // changes size. One mutex serializes all GPU work (see SendWrap).
        let gpu: std::sync::Arc<Mutex<SendWrap<(ID3D11DeviceContext, IDXGISwapChain1, SizeInt32)>>> =
            std::sync::Arc::new(Mutex::new(SendWrap((context, swapchain, size))));
        let handler_device = SendWrap(winrt_device.clone());
        let handler_gpu = gpu.clone();
        let token = pool
            .FrameArrived(&TypedEventHandler::<
                Direct3D11CaptureFramePool,
                windows::core::IInspectable,
            >::new(move |sender, _| {
                let Some(pool) = sender.as_ref() else { return Ok(()) };
                let Ok(frame) = pool.TryGetNextFrame() else { return Ok(()) };
                let Ok(surface) = frame.Surface() else { return Ok(()) };
                let Ok(access) = surface.cast::<IDirect3DDxgiInterfaceAccess>() else {
                    return Ok(());
                };
                let tex: ID3D11Texture2D = match unsafe { access.GetInterface() } {
                    Ok(t) => t,
                    Err(_) => return Ok(()),
                };
                let Ok(content) = frame.ContentSize() else { return Ok(()) };
                if let Ok(mut wrap) = handler_gpu.lock() {
                    let g = &mut wrap.0;
                    // source resized → re-arm pool + backbuffer at the new size
                    if content.Width != g.2.Width || content.Height != g.2.Height {
                        if content.Width > 0 && content.Height > 0 {
                            let _ = pool.Recreate(
                                handler_device.get(),
                                DirectXPixelFormat::B8G8R8A8UIntNormalized,
                                2,
                                content,
                            );
                            unsafe {
                                let _ = g.1.ResizeBuffers(
                                    2,
                                    content.Width as u32,
                                    content.Height as u32,
                                    DXGI_FORMAT_B8G8R8A8_UNORM,
                                    DXGI_SWAP_CHAIN_FLAG(0),
                                );
                            }
                            g.2 = content;
                        }
                        return Ok(());
                    }
                    unsafe {
                        if let Ok(back) = g.1.GetBuffer::<ID3D11Texture2D>(0) {
                            g.0.CopyResource(&back, &tex);
                            let _ = g.1.Present(0, DXGI_PRESENT(0));
                        }
                    }
                }
                Ok(())
            }))
            .map_err(|e| e.to_string())?;

        let session = pool.CreateCaptureSession(&item).map_err(|e| e.to_string())?;
        // best-effort niceties: no cursor baked into the mirror (the yellow
        // capture border stays — trust-is-the-moat: never capture silently)
        let _ = session.SetIsCursorCaptureEnabled(false);
        session.StartCapture().map_err(|e| e.to_string())?;
        Ok(CastSession {
            child,
            session: SendWrap(session),
            pool: SendWrap(pool),
            frame_token: token,
        })
    })();

    match built {
        Ok(cast) => {
            state.0.lock().unwrap().insert(label, cast);
            Ok(())
        }
        Err(e) => {
            // tear the orphaned child back down on the main thread
            let _ = main.run_on_main_thread(move || unsafe {
                let _ = DestroyWindow(HWND(child as *mut _));
            });
            Err(e)
        }
    }
}

pub fn set_bounds(
    app: &AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let state = app.state::<AppCastState>();
    let child = match state.0.lock().unwrap().get(&label) {
        Some(s) => s.child,
        None => return Ok(()), // pane raced ahead of start — harmless
    };
    let (main, _, scale) = main_window_hwnd(app)?;
    let (px, py, pw, ph) = (phys(x, scale), phys(y, scale), phys(width, scale), phys(height, scale));
    main
        .run_on_main_thread(move || unsafe {
            let _ = SetWindowPos(
                HWND(child as *mut _),
                None,
                px,
                py,
                pw.max(1),
                ph.max(1),
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
        })
        .map_err(|e| e.to_string())
}

fn show_window(app: &AppHandle, label: String, visible: bool) -> Result<(), String> {
    let state = app.state::<AppCastState>();
    let child = match state.0.lock().unwrap().get(&label) {
        Some(s) => s.child,
        None => return Ok(()),
    };
    let (main, _, _) = main_window_hwnd(app)?;
    main
        .run_on_main_thread(move || unsafe {
            let _ = ShowWindow(HWND(child as *mut _), if visible { SW_SHOW } else { SW_HIDE });
        })
        .map_err(|e| e.to_string())
}

pub fn hide(app: &AppHandle, label: String) -> Result<(), String> {
    show_window(app, label, false)
}

pub fn show(app: &AppHandle, label: String) -> Result<(), String> {
    show_window(app, label, true)
}

pub fn close(app: &AppHandle, label: String) -> Result<(), String> {
    let state = app.state::<AppCastState>();
    let Some(cast) = state.0.lock().unwrap().remove(&label) else {
        return Ok(());
    };
    // stop frames first, then the capture objects, then the window
    let _ = cast.pool.0.RemoveFrameArrived(cast.frame_token);
    let _ = cast.session.0.Close();
    let _ = cast.pool.0.Close();
    let child = cast.child;
    if let Ok((main, _, _)) = main_window_hwnd(app) {
        let _ = main.run_on_main_thread(move || unsafe {
            let _ = DestroyWindow(HWND(child as *mut _));
        });
    }
    Ok(())
}
