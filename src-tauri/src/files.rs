//! Minimal filesystem commands for the Files pane.

use serde::Serialize;

use crate::proc::NoWindow;

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    /// Last-modified time in unix seconds (0 if unavailable) — lets callers find
    /// the freshest file (e.g. the idle focus tile's newest memory note).
    mtime: f64,
}

/// Lists a directory (dirs first, alphabetical, dotfiles hidden). Empty path → $HOME.
#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let p = if path.is_empty() {
        home_dir()
    } else {
        path
    };
    let mut entries: Vec<DirEntry> = Vec::new();
    for e in std::fs::read_dir(&p).map_err(|e| e.to_string())? {
        let e = match e {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let meta = e.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let mtime = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        entries.push(DirEntry {
            name,
            path: e.path().to_string_lossy().to_string(),
            is_dir,
            mtime,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Like `read_dir` but for the VS Code-style explorer tree. Two filter knobs:
///  - `show_hidden` (default false): when false, dotfiles (`.env`, `.claude`, …)
///    are hidden like VS Code's default; when true they show. `.git`/`.DS_Store`
///    are ALWAYS hidden (pure noise).
///  - `show_all` (default false): when false, heavy build/dep dirs (node_modules,
///    target, dist, .next, …) are pruned the same way the search backend prunes
///    them (`is_search_pruned_dir`); when true they show.
/// Same sort (dirs first, alphabetical). Params are `Option` so old callers that
/// pass neither get the VS Code-ish default (hidden dotfiles, pruned junk).
#[tauri::command]
pub fn read_dir_tree(
    path: String,
    show_hidden: Option<bool>,
    show_all: Option<bool>,
) -> Result<Vec<DirEntry>, String> {
    let show_hidden = show_hidden.unwrap_or(false);
    let show_all = show_all.unwrap_or(false);
    let p = if path.is_empty() {
        home_dir()
    } else {
        path
    };
    let mut entries: Vec<DirEntry> = Vec::new();
    for e in std::fs::read_dir(&p).map_err(|e| e.to_string())? {
        let e = match e {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = e.file_name().to_string_lossy().to_string();
        // Always-noise: never surface these.
        if name == ".git" || name == ".DS_Store" {
            continue;
        }
        // Dotfiles hidden by default (VS Code-style); shown only with show_hidden.
        if !show_hidden && name.starts_with('.') {
            continue;
        }
        // Heavy build/dep dirs pruned by default; shown only with show_all. Same
        // set the file finder / content search prunes, so the tree matches ⌘P.
        if !show_all && is_search_pruned_dir(&name) {
            continue;
        }
        let meta = e.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let mtime = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        entries.push(DirEntry {
            name,
            path: e.path().to_string_lossy().to_string(),
            is_dir,
            mtime,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[derive(Serialize)]
pub struct GitEntry {
    /// Absolute path of the changed file.
    path: String,
    /// Single-letter status: M(odified) A(dded) D(eleted) R(enamed) U(ntracked).
    status: String,
}

#[derive(Serialize)]
pub struct GitStatus {
    /// Repo toplevel, or null if `path` isn't inside a git repo.
    root: Option<String>,
    entries: Vec<GitEntry>,
}

#[derive(Serialize)]
pub struct ShellSourceStatus {
    root: Option<String>,
    branch: String,
    dirty: u32,
    changed: Vec<GitEntry>,
}

/// Git status for the repo containing `path`, as absolute-path → status-letter,
/// so the Files tree can decorate changed files + their parent folders. Returns
/// `{ root: null, entries: [] }` (never errors) when not in a repo.
#[tauri::command]
pub fn git_status(path: String) -> Result<GitStatus, String> {
    let root = match std::process::Command::new("git")
        .args(["-C", &path, "rev-parse", "--show-toplevel"])
        .no_window()
        .output()
    {
        Ok(o) if o.status.success() => {
            String::from_utf8_lossy(&o.stdout).trim().to_string()
        }
        _ => return Ok(GitStatus { root: None, entries: Vec::new() }),
    };
    let out = std::process::Command::new("git")
        .args(["-C", &root, "status", "--porcelain", "--ignored=no"])
        .no_window()
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut entries = Vec::new();
    for line in text.lines() {
        if line.len() < 4 {
            continue;
        }
        let xy = &line[..2];
        let mut rest = line[3..].to_string();
        // renames come as "old -> new" — decorate the new path
        if let Some(idx) = rest.find(" -> ") {
            rest = rest[idx + 4..].to_string();
        }
        let rel = rest.trim().trim_matches('"');
        let abs = std::path::Path::new(&root)
            .join(rel)
            .to_string_lossy()
            .to_string();
        let status = simplify_status(xy).to_string();
        entries.push(GitEntry { path: abs, status });
    }
    Ok(GitStatus { root: Some(root), entries })
}

#[tauri::command]
pub fn shell_source_status() -> Result<ShellSourceStatus, String> {
    let Some(root) = find_shell_source_root() else {
        return Ok(ShellSourceStatus {
            root: None,
            branch: String::new(),
            dirty: 0,
            changed: Vec::new(),
        });
    };

    let branch = std::process::Command::new("git")
        .args(["-C", &root, "rev-parse", "--abbrev-ref", "HEAD"])
        .no_window()
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    let status = git_status(root.clone())?;
    let dirty = status.entries.len() as u32;
    let changed = status.entries.into_iter().take(18).collect();

    Ok(ShellSourceStatus {
        root: Some(root),
        branch,
        dirty,
        changed,
    })
}

fn find_shell_source_root() -> Option<String> {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("AIOS_SHELL_SOURCE_ROOT") {
        candidates.push(path);
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.to_string_lossy().to_string());
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(format!("{home}/Repo/aios/shell"));
        candidates.push(format!("{home}/Repo/aios/shell"));
    }

    candidates.into_iter().find_map(|path| {
        let root = std::process::Command::new("git")
            .args(["-C", &path, "rev-parse", "--show-toplevel"])
            .no_window()
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())?;
        let has_tauri = std::path::Path::new(&root)
            .join("src-tauri/tauri.conf.json")
            .exists();
        let has_package = std::path::Path::new(&root).join("package.json").exists();
        if has_tauri && has_package {
            Some(root)
        } else {
            None
        }
    })
}

/// Collapse a 2-char porcelain XY code to one display letter.
fn simplify_status(xy: &str) -> &'static str {
    if xy == "??" {
        return "U";
    }
    if xy.contains('D') {
        "D"
    } else if xy.contains('A') {
        "A"
    } else if xy.contains('R') {
        "R"
    } else if xy.contains('M') {
        "M"
    } else {
        "M"
    }
}

#[derive(Serialize)]
pub struct RepoPulse {
    /// The input path, echoed back so the frontend can map results.
    root: String,
    /// Final path component of root.
    name: String,
    /// Current branch; "" if detached / not a repo.
    branch: String,
    /// Count of porcelain status lines (working-tree changes).
    dirty: u32,
    /// Commits ahead of upstream; 0 if no upstream / error.
    ahead: u32,
    /// Commits behind upstream; 0 if no upstream / error.
    behind: u32,
}

/// Best-effort dev-pulse for a set of repo paths (the "dev pulse" dashboard tile).
/// For each path: current branch, working-tree dirty count, and ahead/behind vs
/// upstream. Never errors — a non-repo (or any git failure) yields a zeroed
/// RepoPulse for that path. Results preserve input order, one per path. Frontend
/// passes only a handful of paths so the git calls run sequentially.
#[tauri::command]
pub fn git_pulse(paths: Vec<String>) -> Vec<RepoPulse> {
    let mut out: Vec<RepoPulse> = Vec::with_capacity(paths.len());
    for path in paths {
        let name = std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());

        // branch — "" if detached / not a repo
        let branch = match std::process::Command::new("git")
            .args(["-C", &path, "rev-parse", "--abbrev-ref", "HEAD"])
            .no_window()
            .output()
        {
            Ok(o) if o.status.success() => {
                String::from_utf8_lossy(&o.stdout).trim().to_string()
            }
            _ => String::new(),
        };

        // dirty — count of porcelain status lines
        let dirty = match std::process::Command::new("git")
            .args(["-C", &path, "status", "--porcelain", "--ignored=no"])
            .no_window()
            .output()
        {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|l| !l.is_empty())
                .count() as u32,
            _ => 0,
        };

        // ahead/behind vs upstream — output is "<behind>\t<ahead>"
        let (mut ahead, mut behind) = (0u32, 0u32);
        if let Ok(o) = std::process::Command::new("git")
            .args([
                "-C",
                &path,
                "rev-list",
                "--count",
                "--left-right",
                "@{upstream}...HEAD",
            ])
            .no_window()
            .output()
        {
            if o.status.success() {
                let text = String::from_utf8_lossy(&o.stdout);
                let mut parts = text.split_whitespace();
                if let Some(b) = parts.next() {
                    behind = b.parse().unwrap_or(0);
                }
                if let Some(a) = parts.next() {
                    ahead = a.parse().unwrap_or(0);
                }
            }
        }

        out.push(RepoPulse {
            root: path,
            name,
            branch,
            dirty,
            ahead,
            behind,
        });
    }
    out
}

#[derive(Serialize)]
pub struct RunCommand {
    label: String,
    cmd: String,
}

#[derive(Serialize)]
pub struct ProjectRun {
    /// "flutter" | "node" | "rust" | "go" | "python" | "make" | "unknown"
    kind: String,
    /// Directory the project marker was found in (where the command should run).
    root: Option<String>,
    /// Candidate run commands; the first is the default for F5.
    commands: Vec<RunCommand>,
}

/// If `dir` is itself a runnable project root (has a known marker), returns its
/// `(kind, commands)`. This is the single source of truth for marker detection +
/// command derivation, shared by `detect_project` (walks up) and `list_projects`
/// (scans down). Returns `None` when `dir` has no recognized marker.
fn project_at(dir: &std::path::Path) -> Option<(String, Vec<RunCommand>)> {
    let has = |f: &str| dir.join(f).is_file();

    if has("pubspec.yaml") {
        return Some((
            "flutter".into(),
            vec![
                RunCommand { label: "flutter run".into(), cmd: "flutter run".into() },
                RunCommand { label: "flutter run --release".into(), cmd: "flutter run --release".into() },
                RunCommand { label: "flutter test".into(), cmd: "flutter test".into() },
            ],
        ));
    }
    if has("package.json") {
        return Some(("node".into(), node_scripts(dir)));
    }
    if has("Cargo.toml") {
        return Some((
            "rust".into(),
            vec![
                RunCommand { label: "cargo run".into(), cmd: "cargo run".into() },
                RunCommand { label: "cargo test".into(), cmd: "cargo test".into() },
                RunCommand { label: "cargo build".into(), cmd: "cargo build".into() },
            ],
        ));
    }
    if has("go.mod") {
        return Some((
            "go".into(),
            vec![
                RunCommand { label: "go run .".into(), cmd: "go run .".into() },
                RunCommand { label: "go test ./...".into(), cmd: "go test ./...".into() },
            ],
        ));
    }
    if has("pyproject.toml") || has("requirements.txt") || has("manage.py") {
        let cmd = if has("manage.py") {
            "python manage.py runserver"
        } else {
            "python main.py"
        };
        return Some((
            "python".into(),
            vec![RunCommand { label: cmd.into(), cmd: cmd.into() }],
        ));
    }
    if has("Makefile") {
        return Some((
            "make".into(),
            vec![RunCommand { label: "make".into(), cmd: "make".into() }],
        ));
    }
    None
}

/// Detects the runnable project containing `path` (walks up to find a marker)
/// and returns the F5-style run commands. Used by the Run pane / F5 to spawn a
/// terminal running the right thing in the right directory.
#[tauri::command]
pub fn detect_project(path: String) -> ProjectRun {
    let mut dir = std::path::PathBuf::from(&path);
    if dir.is_file() {
        if let Some(p) = dir.parent() {
            dir = p.to_path_buf();
        }
    }
    for _ in 0..12 {
        if let Some((kind, commands)) = project_at(&dir) {
            return ProjectRun {
                kind,
                root: Some(dir.to_string_lossy().to_string()),
                commands,
            };
        }
        match dir.parent() {
            Some(p) => dir = p.to_path_buf(),
            None => break,
        }
    }
    ProjectRun { kind: "unknown".into(), root: None, commands: Vec::new() }
}

#[derive(Serialize)]
pub struct ProjectInfo {
    /// Directory name of the project root (display title).
    name: String,
    /// Absolute path of the project root.
    root: String,
    /// "flutter" | "node" | "rust" | "go" | "python" | "make"
    kind: String,
    /// Candidate run commands; the first is the primary (default for the palette).
    commands: Vec<RunCommand>,
    /// Unix epoch seconds of the project dir's last modification.
    mtime: u64,
}

/// Directory names we never descend into — heavy build/dep/vcs dirs that would
/// blow up the scan and never contain a project root worth running on its own.
fn is_pruned_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | "build"
            | "target"
            | "dist"
            | ".next"
            | "Pods"
            | ".dart_tool"
            | "vendor"
            | ".venv"
            | "venv"
            | "__pycache__"
            | ".turbo"
            | ".cache"
    )
}

/// Scans `~/Repo` (bounded depth ~4) for runnable project roots. A directory is
/// a project if `project_at` recognizes a marker in it; once found we record it
/// and STOP descending (the marker dir is the project — nested sub-packages are
/// not surfaced as separate run targets here). Heavy dirs (node_modules, target,
/// .git, …) are pruned. Results are capped, deduped by root, and sorted by name.
/// Reuses `project_at` so command derivation is identical to F5 / `detect_project`.
#[tauri::command]
pub fn list_projects() -> Vec<ProjectInfo> {
    const MAX_DEPTH: usize = 4;
    const CAP: usize = 200;

    let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
    let repo_root = std::path::Path::new(&home).join("Repo");

    let mut out: Vec<ProjectInfo> = Vec::new();
    // (dir, depth) stack — iterative to bound recursion + allow early cap.
    let mut stack: Vec<(std::path::PathBuf, usize)> = vec![(repo_root, 0)];

    while let Some((dir, depth)) = stack.pop() {
        if out.len() >= CAP {
            break;
        }
        // If this dir is a project root, record it. Still descend afterward:
        // many AIOS workspaces are monorepos with runnable nested apps, and the
        // command palette must surface the actual app, not only the parent.
        if let Some((kind, commands)) = project_at(&dir) {
            let name = dir
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| dir.to_string_lossy().to_string());
            let mtime = std::fs::metadata(&dir)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            out.push(ProjectInfo {
                name,
                root: dir.to_string_lossy().to_string(),
                kind,
                commands,
                mtime,
            });
        }
        if depth >= MAX_DEPTH {
            continue;
        }
        let rd = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || is_pruned_dir(&name) {
                continue;
            }
            let is_dir = e
                .file_type()
                .map(|t| t.is_dir())
                .unwrap_or_else(|_| e.path().is_dir());
            if is_dir {
                stack.push((e.path(), depth + 1));
            }
        }
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out.truncate(CAP);
    out
}

/// Reads package.json `scripts` and turns them into `<pm> run <name>` commands,
/// dev/start/serve first. Picks the package manager from the lockfile present.
fn node_scripts(dir: &std::path::Path) -> Vec<RunCommand> {
    let pm = if dir.join("pnpm-lock.yaml").is_file() {
        "pnpm"
    } else if dir.join("yarn.lock").is_file() {
        "yarn"
    } else if dir.join("bun.lockb").is_file() {
        "bun"
    } else {
        "npm"
    };
    let mut out = Vec::new();
    if let Ok(text) = std::fs::read_to_string(dir.join("package.json")) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
            let is_react_native = json
                .get("dependencies")
                .and_then(|d| d.as_object())
                .is_some_and(|d| d.contains_key("react-native"));
            if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
                let mut names: Vec<&String> = scripts.keys().collect();
                // priority order first, then the rest alphabetically
                let prio: &[&str] = if is_react_native {
                    &["android", "ios", "start", "test", "lint"]
                } else {
                    &["dev", "start", "serve", "build", "test"]
                };
                names.sort_by_key(|n| {
                    prio.iter().position(|p| *p == n.as_str()).unwrap_or(prio.len() + 1)
                });
                for name in names {
                    let run = if pm == "npm" {
                        format!("npm run {name}")
                    } else {
                        format!("{pm} {name}")
                    };
                    out.push(RunCommand { label: run.clone(), cmd: run });
                }
            }
        }
    }
    if out.is_empty() {
        out.push(RunCommand {
            label: format!("{pm} start"),
            cmd: format!("{pm} start"),
        });
    }
    out
}

// ── workspaces (structured projects; see misc/PLAN-projects-workspaces.md §4/§8) ──
//
// The detection backend for the `ProjectWorkspace` model in
// src/lib/projectWorkspaces.ts. Scans configurable roots (e.g. C:\FHE-Work) and
// infers each child folder's shape — fullstack | split (front/back) | environments
// (Beta/Staging, N components each) — with per-component stack/role/status. The
// JSON shape mirrors the TS types exactly (serde camelCase + a "kind"-tagged
// structure enum). Detection is advisory; the frontend can override anything.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectComponentInfo {
    id: String,
    name: String,
    path: String,
    role: String,
    stack: String,
    run_commands: Vec<RunCommand>,
    #[serde(skip_serializing_if = "Option::is_none")]
    port: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    supersedes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
}

#[derive(Serialize)]
pub struct ProjectEnvironmentInfo {
    id: String,
    name: String,
    path: String,
    components: Vec<ProjectComponentInfo>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProjectStructureInfo {
    Fullstack {
        component: ProjectComponentInfo,
    },
    Split {
        components: Vec<ProjectComponentInfo>,
    },
    Environments {
        #[serde(rename = "defaultEnv", skip_serializing_if = "Option::is_none")]
        default_env: Option<String>,
        environments: Vec<ProjectEnvironmentInfo>,
    },
    Unconfigured,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspaceInfo {
    id: String,
    name: String,
    root: String,
    structure: ProjectStructureInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hidden: Option<bool>,
    source: String,
    mtime: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    manifest_path: Option<String>,
    schema_version: u32,
}

/// Folder names treated as environment groupings (owner decision §10.1). Editable
/// in Settings later; the defaults are the names the owner actually uses.
fn is_env_name(name: &str) -> bool {
    const ENVS: &[&str] = &["beta", "staging", "prod", "production", "dev", "current", "fresh"];
    ENVS.contains(&name.to_lowercase().as_str())
}

/// Best-effort component role from a folder name (backend signals win over
/// frontend so "web-api" reads as backend). Mirrors `inferRole` in TS.
fn role_for(name: &str) -> &'static str {
    let segs: Vec<String> = name
        .to_lowercase()
        .split(|c| c == '-' || c == '_' || c == '.')
        .map(|s| s.to_string())
        .collect();
    let has = |opts: &[&str]| segs.iter().any(|s| opts.contains(&s.as_str()));
    if has(&["back", "backend", "api", "server", "svc", "service", "nitro", "gateway", "worker"]) {
        return "backend";
    }
    if has(&["front", "frontend", "web", "client", "ui", "admin", "portal", "app", "site", "dashboard", "console"]) {
        return "frontend";
    }
    if has(&["mobile", "ios", "android", "flutter", "expo", "native"]) {
        return "mobile";
    }
    if has(&["infra", "deploy", "terraform", "docker", "ops", "k8s", "helm"]) {
        return "infra";
    }
    if has(&["docs", "doc", "documentation"]) {
        return "docs";
    }
    "other"
}

/// A `<base>-next` / `<base>-nitro` / `<base>-v2` / `<base>-new` / `<base>2`
/// successor → the base name it supersedes (else None). Mirrors `supersedesBase`.
fn supersedes_base(name: &str) -> Option<String> {
    let lower = name.to_lowercase();
    // longest/most-specific suffix first so "v2" wins over the bare "2".
    for suf in ["nitro", "next", "new", "v2", "2"] {
        if let Some(stripped) = lower.strip_suffix(suf) {
            // char-based slice of the original name (panic-safe on multibyte).
            let keep = stripped.chars().count();
            let base = name
                .chars()
                .take(keep)
                .collect::<String>()
                .trim_end_matches(['-', '_'])
                .to_string();
            if !base.is_empty() && base.to_lowercase() != lower {
                return Some(base);
            }
        }
    }
    None
}

/// Stable id from a root — djb2 → base36, "ws_"-prefixed. Mirrors TS `hashRoot`
/// (case- + trailing-separator-insensitive) for ASCII paths.
fn hash_root(root: &str) -> String {
    let s = root.trim().trim_end_matches(['/', '\\']).to_lowercase();
    let mut h: i32 = 5381;
    for c in s.chars() {
        h = h.wrapping_shl(5).wrapping_add(h).wrapping_add(c as i32);
    }
    let mut n = h as u32;
    if n == 0 {
        return "ws_0".into();
    }
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut buf = Vec::new();
    while n > 0 {
        buf.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    buf.reverse();
    format!("ws_{}", String::from_utf8(buf).unwrap())
}

fn file_name_string(p: &std::path::Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| p.to_string_lossy().to_string())
}

/// Immediate child directories (dotfiles + heavy dirs pruned), sorted.
fn child_dirs(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || is_pruned_dir(&name) {
                continue;
            }
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or_else(|_| e.path().is_dir());
            if is_dir {
                out.push(e.path());
            }
        }
    }
    out.sort();
    out
}

/// Richer stack detection than `project_at`: refines the node family to
/// next/nitro/nuxt/vite/angular and adds php/dotnet. Returns (stack tag, commands).
fn detect_stack(dir: &std::path::Path) -> Option<(String, Vec<RunCommand>)> {
    if let Some((kind, commands)) = project_at(dir) {
        let stack = if kind == "node" { refine_node_stack(dir) } else { kind };
        return Some((stack, commands));
    }
    if dir.join("artisan").is_file() || dir.join("composer.json").is_file() {
        let cmd = if dir.join("artisan").is_file() { "php artisan serve" } else { "composer install" };
        return Some(("php".into(), vec![RunCommand { label: cmd.into(), cmd: cmd.into() }]));
    }
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_lowercase();
            if n.ends_with(".csproj") || n.ends_with(".sln") {
                return Some(("dotnet".into(), vec![RunCommand { label: "dotnet run".into(), cmd: "dotnet run".into() }]));
            }
        }
    }
    None
}

/// Refine a `node` marker into a specific framework tag via config files, then a
/// light package.json dependency check.
fn refine_node_stack(dir: &std::path::Path) -> String {
    let any = |fs: &[&str]| fs.iter().any(|f| dir.join(f).is_file());
    if any(&["next.config.js", "next.config.ts", "next.config.mjs", "next.config.cjs"]) {
        return "next".into();
    }
    if any(&["nuxt.config.js", "nuxt.config.ts", "nuxt.config.mjs"]) {
        return "nuxt".into();
    }
    if any(&["nitro.config.ts", "nitro.config.js"]) {
        return "nitro".into();
    }
    if any(&["vite.config.js", "vite.config.ts", "vite.config.mjs"]) {
        return "vite".into();
    }
    if dir.join("angular.json").is_file() {
        return "angular".into();
    }
    if let Ok(text) = std::fs::read_to_string(dir.join("package.json")) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
            let dep = |k: &str| {
                json.get("dependencies").and_then(|d| d.get(k)).is_some()
                    || json.get("devDependencies").and_then(|d| d.get(k)).is_some()
            };
            if dep("next") {
                return "next".into();
            }
            if dep("nitropack") {
                return "nitro".into();
            }
            if dep("nuxt") {
                return "nuxt".into();
            }
            if dep("vite") {
                return "vite".into();
            }
            if dep("@angular/core") {
                return "angular".into();
            }
        }
    }
    "node".into()
}

/// Build a component descriptor for a directory. `id_prefix` namespaces the id
/// (workspace id, or "<wsid>/<env>"); `rel_prefix` is the env folder (or "" at
/// the workspace root) so `path` stays relative to the workspace root.
fn build_component(id_prefix: &str, comp_dir: &std::path::Path, rel_prefix: &str) -> ProjectComponentInfo {
    let name = file_name_string(comp_dir);
    let (stack, run_commands) = detect_stack(comp_dir).unwrap_or_else(|| (String::new(), Vec::new()));
    let path = if rel_prefix.is_empty() { name.clone() } else { format!("{rel_prefix}/{name}") };
    ProjectComponentInfo {
        id: format!("{id_prefix}/{name}"),
        name: name.clone(),
        path,
        role: role_for(&name).to_string(),
        stack,
        run_commands,
        port: None,
        status: Some("current".to_string()),
        supersedes: None,
        notes: None,
    }
}

/// Within one component list (a split level or a single env), wire up the
/// legacy/wip + supersedes relationship from the `-next`/`-nitro`/`v2` heuristic.
fn apply_supersedes(components: &mut [ProjectComponentInfo]) {
    let by_name: std::collections::HashMap<String, usize> = components
        .iter()
        .enumerate()
        .map(|(i, c)| (c.name.to_lowercase(), i))
        .collect();
    let mut links: Vec<(usize, usize, String)> = Vec::new();
    for (i, c) in components.iter().enumerate() {
        if let Some(base) = supersedes_base(&c.name) {
            if let Some(&bi) = by_name.get(&base.to_lowercase()) {
                links.push((i, bi, components[bi].id.clone()));
            }
        }
    }
    for (wi, bi, base_id) in links {
        components[wi].status = Some("wip".to_string());
        components[wi].supersedes = Some(base_id);
        components[bi].status = Some("legacy".to_string());
    }
}

/// True if `env_dir` reads as an environment: it holds runnable component(s), or
/// is itself a single runnable app (the `current/`+`fresh/` variants case).
fn env_has_components(env_dir: &std::path::Path) -> bool {
    detect_stack(env_dir).is_some() || child_dirs(env_dir).iter().any(|c| detect_stack(c).is_some())
}

/// Pick a sensible default environment id by priority, else the first.
fn pick_default_env(envs: &[ProjectEnvironmentInfo]) -> Option<String> {
    const PRIO: &[&str] = &["current", "beta", "dev", "staging", "prod", "production", "fresh"];
    for p in PRIO {
        if let Some(e) = envs.iter().find(|e| e.name.to_lowercase() == *p) {
            return Some(e.id.clone());
        }
    }
    envs.first().map(|e| e.id.clone())
}

/// Infer a single workspace's structure from its folder layout.
fn detect_workspace_impl(dir: &std::path::Path) -> ProjectWorkspaceInfo {
    let root = dir.to_string_lossy().to_string();
    let name = file_name_string(dir);
    let id = hash_root(&root);
    let mtime = std::fs::metadata(dir)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let kids = child_dirs(dir);

    // 1. environments — ≥2 env-named children that each hold components.
    let env_dirs: Vec<&std::path::PathBuf> = kids
        .iter()
        .filter(|k| is_env_name(&file_name_string(k)) && env_has_components(k))
        .collect();

    let structure = if env_dirs.len() >= 2 {
        let mut environments = Vec::new();
        for ed in &env_dirs {
            let env_name = file_name_string(ed);
            let env_id = format!("{id}/{}", env_name.to_lowercase());
            let mut comps: Vec<ProjectComponentInfo> = child_dirs(ed)
                .iter()
                .filter(|c| detect_stack(c).is_some())
                .map(|c| build_component(&env_id, c, &env_name))
                .collect();
            // env folder is itself a single app (no sub-components) → represent it.
            if comps.is_empty() {
                if let Some((stack, run_commands)) = detect_stack(ed) {
                    comps.push(ProjectComponentInfo {
                        id: format!("{env_id}/."),
                        name: env_name.clone(),
                        path: env_name.clone(),
                        role: "fullstack".to_string(),
                        stack,
                        run_commands,
                        port: None,
                        status: Some("current".to_string()),
                        supersedes: None,
                        notes: None,
                    });
                }
            }
            apply_supersedes(&mut comps);
            environments.push(ProjectEnvironmentInfo {
                id: env_id,
                name: env_name.clone(),
                path: env_name,
                components: comps,
            });
        }
        let default_env = pick_default_env(&environments);
        ProjectStructureInfo::Environments { default_env, environments }
    } else {
        // 2. split — ≥2 children that each have their own project marker.
        let comp_dirs: Vec<&std::path::PathBuf> =
            kids.iter().filter(|k| detect_stack(k).is_some()).collect();
        if comp_dirs.len() >= 2 {
            let mut comps: Vec<ProjectComponentInfo> =
                comp_dirs.iter().map(|c| build_component(&id, c, "")).collect();
            apply_supersedes(&mut comps);
            ProjectStructureInfo::Split { components: comps }
        } else if let Some((stack, run_commands)) = detect_stack(dir) {
            // 3. fullstack — a marker at the root.
            ProjectStructureInfo::Fullstack {
                component: ProjectComponentInfo {
                    id: format!("{id}/."),
                    name: name.clone(),
                    path: ".".to_string(),
                    role: "fullstack".to_string(),
                    stack,
                    run_commands,
                    port: None,
                    status: Some("current".to_string()),
                    supersedes: None,
                    notes: None,
                },
            }
        } else {
            // 4. discovered but unshaped — the user picks/auto-detects later.
            ProjectStructureInfo::Unconfigured
        }
    };

    ProjectWorkspaceInfo {
        id,
        name,
        root,
        structure,
        tags: None,
        hidden: None,
        source: "scanned".to_string(),
        mtime,
        manifest_path: if dir.join("aios.workspace.json").is_file() {
            Some("aios.workspace.json".to_string())
        } else {
            None
        },
        schema_version: 1,
    }
}

/// Best-effort default scan roots: the parent of the launch dir (e.g. C:\FHE-Work
/// when run from C:\FHE-Work\AIOS-Superapp) + common code dirs under home. Only
/// existing dirs, deduped.
/// True for non-project SYSTEM locations that must NEVER be scanned as workspace
/// roots — the Windows dir, install dirs, ProgramData, and any bare drive/fs root.
/// An installed GUI app on Windows often launches with cwd = C:\Windows\System32,
/// so without this guard `cwd.parent()` (a scan-root heuristic below) would scan
/// all of C:\Windows — every subfolder became a bogus "workspace" (reported bug).
fn is_system_dir(path: &std::path::Path) -> bool {
    let norm = |p: &std::path::Path| {
        p.to_string_lossy()
            .to_lowercase()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_string()
    };
    let p = norm(path);
    // a bare drive root ("c:") / filesystem root ("") is far too broad to scan.
    if p.len() <= 2 {
        return true;
    }
    #[cfg(windows)]
    {
        for var in [
            "WINDIR",
            "SystemRoot",
            "ProgramFiles",
            "ProgramFiles(x86)",
            "ProgramW6432",
            "ProgramData",
        ] {
            if let Ok(v) = std::env::var(var) {
                let v = norm(std::path::Path::new(&v));
                if !v.is_empty() && (p == v || p.starts_with(&format!("{v}\\"))) {
                    return true;
                }
            }
        }
    }
    false
}

fn default_scan_roots() -> Vec<String> {
    let mut cand: Vec<String> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(parent) = cwd.parent() {
            cand.push(parent.to_string_lossy().to_string());
        }
    }
    let home = home_dir();
    for c in ["Repo", "repos", "Projects", "projects", "code", "Code", "dev", "src", "work"] {
        cand.push(std::path::Path::new(&home).join(c).to_string_lossy().to_string());
    }
    let mut seen = std::collections::HashSet::new();
    cand.into_iter()
        .filter(|r| {
            let p = std::path::Path::new(r);
            p.is_dir() && !is_system_dir(p) && seen.insert(r.to_lowercase())
        })
        .collect()
}

/// Suggested scan roots for the Settings UI to offer (P3).
#[tauri::command]
pub fn suggested_scan_roots() -> Vec<String> {
    default_scan_roots()
}

/// Detect a single workspace's structure at `root`.
#[tauri::command]
pub fn detect_workspace(root: String) -> ProjectWorkspaceInfo {
    detect_workspace_impl(std::path::Path::new(&root))
}

/// Scan the given roots (each child dir = a candidate workspace) and return their
/// inferred structures, sorted by name. Empty `roots` → best-effort defaults.
#[tauri::command]
pub fn scan_workspaces(roots: Vec<String>) -> Vec<ProjectWorkspaceInfo> {
    const CAP: usize = 300;
    let roots = if roots.is_empty() { default_scan_roots() } else { roots };
    let mut out: Vec<ProjectWorkspaceInfo> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    'outer: for root in roots {
        // never scan a system location (defense in depth — a stale/explicit root
        // could still point at C:\Windows etc.).
        if is_system_dir(std::path::Path::new(&root)) {
            continue;
        }
        for child in child_dirs(std::path::Path::new(&root)) {
            if !seen.insert(child.to_string_lossy().to_lowercase()) {
                continue;
            }
            out.push(detect_workspace_impl(&child));
            if out.len() >= CAP {
                break 'outer;
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

// ── agent context generation (PLAN §6; owner decision §10.3) ──────────────
//
// Render a workspace's structure into a managed, delimited block written into the
// repo's native context files (CLAUDE.md + AGENTS.md) so any agent launched in the
// workspace inherits a true map of it — no per-turn preamble. The block is the only
// region we touch; everything outside the BEGIN/END markers is the owner's.

const CTX_BEGIN: &str = "<!-- AIOS:workspace BEGIN";
const CTX_END: &str = "<!-- AIOS:workspace END -->";

/// One markdown line for a component: name, role · stack · status, run cmd, path,
/// and the supersedes link (resolved to the superseded component's name).
fn ctx_component_line(c: &ProjectComponentInfo, name_by_id: &std::collections::HashMap<&str, &str>) -> String {
    let mut meta = vec![c.role.clone()];
    if !c.stack.is_empty() {
        meta.push(c.stack.clone());
    }
    if let Some(st) = &c.status {
        if st != "current" {
            meta.push(st.clone());
        }
    }
    let mut line = format!("- **{}** — {}", c.name, meta.join(" · "));
    if let Some(r) = c.run_commands.first() {
        line.push_str(&format!(" · run `{}`", r.cmd));
    }
    line.push_str(&format!(" · `{}`", c.path));
    if let Some(sup) = &c.supersedes {
        if let Some(n) = name_by_id.get(sup.as_str()) {
            line.push_str(&format!(" · supersedes `{n}`"));
        }
    }
    line.push('\n');
    line
}

fn ctx_render_components(out: &mut String, comps: &[ProjectComponentInfo]) {
    let name_by_id: std::collections::HashMap<&str, &str> =
        comps.iter().map(|c| (c.id.as_str(), c.name.as_str())).collect();
    for c in comps {
        out.push_str(&ctx_component_line(c, &name_by_id));
    }
}

fn ctx_has_supersedes(ws: &ProjectWorkspaceInfo) -> bool {
    let any = |cs: &[ProjectComponentInfo]| cs.iter().any(|c| c.supersedes.is_some());
    match &ws.structure {
        ProjectStructureInfo::Split { components } => any(components),
        ProjectStructureInfo::Environments { environments, .. } => {
            environments.iter().any(|e| any(&e.components))
        }
        _ => false,
    }
}

/// Render the full managed block (delimiters included) for a workspace.
fn render_workspace_context(ws: &ProjectWorkspaceInfo) -> String {
    let mut s = String::new();
    // NOTE: the "AIOS:workspace" marker itself is a PARSE ANCHOR — existing
    // CLAUDE.md/AGENTS.md blocks across every workspace match on it, so it
    // keeps the codename; only the human-facing prose says OSAI.
    s.push_str(CTX_BEGIN);
    s.push_str(" — generated by OSAI; edit outside this block -->\n");
    s.push_str(&format!("## Workspace: {}\n", ws.name));
    match &ws.structure {
        ProjectStructureInfo::Fullstack { component } => {
            s.push_str("Layout: **fullstack** — a single app at the root.\n\n");
            let map = std::collections::HashMap::new();
            s.push_str(&ctx_component_line(component, &map));
        }
        ProjectStructureInfo::Split { components } => {
            s.push_str("Layout: **split** — one repo, multiple components.\n\n");
            ctx_render_components(&mut s, components);
        }
        ProjectStructureInfo::Environments { default_env, environments } => {
            let names: Vec<&str> = environments.iter().map(|e| e.name.as_str()).collect();
            s.push_str(&format!("Layout: **environments** — {}.\n", names.join(", ")));
            if let Some(de) = default_env {
                if let Some(env) = environments.iter().find(|e| &e.id == de) {
                    s.push_str(&format!("Default environment: **{}**.\n", env.name));
                }
            }
            for env in environments {
                s.push_str(&format!("\n### {}\n", env.name));
                ctx_render_components(&mut s, &env.components);
            }
        }
        ProjectStructureInfo::Unconfigured => {
            s.push_str("Layout: not yet recognized — no project marker found at the root.\n");
        }
    }
    if ctx_has_supersedes(ws) {
        s.push_str(
            "\nWhen working here: components marked `wip` (the `*-next` / `*-nitro` rewrites) supersede the `legacy` ones — default new work to the wip components unless told otherwise.\n",
        );
    }
    s.push_str("\n_Structure auto-detected by OSAI; full machine-readable form in `aios.workspace.json`._\n");
    s.push_str(CTX_END);
    s
}

/// Replace the managed block in `existing` with `block`, or append it if absent.
/// Only ever touches the text between (and including) the BEGIN/END markers. Pure.
fn upsert_managed_block(existing: &str, block: &str) -> String {
    if let Some(bi) = existing.find(CTX_BEGIN) {
        if let Some(rel) = existing[bi..].find(CTX_END) {
            let ei = bi + rel + CTX_END.len();
            let mut out = String::with_capacity(existing.len());
            out.push_str(&existing[..bi]);
            out.push_str(block);
            out.push_str(&existing[ei..]);
            return out;
        }
    }
    let mut out = existing.trim_end().to_string();
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(block);
    out.push('\n');
    out
}

/// Ensure `line` is present in the dir's `.gitignore` (created if missing) — so the
/// regenerable `aios.workspace.json` stays out of git by default (owner §10.2).
fn ensure_gitignored(dir: &std::path::Path, line: &str) {
    let path = dir.join(".gitignore");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == line) {
        return;
    }
    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(line);
    next.push('\n');
    let _ = std::fs::write(&path, next);
}

/// Preview the context block that `generate_workspace_context` would write — does
/// NOT touch the filesystem. Powers the consent-first preview in Settings.
#[tauri::command]
pub fn preview_workspace_context(root: String) -> String {
    render_workspace_context(&detect_workspace_impl(std::path::Path::new(&root)))
}

/// Write `aios.workspace.json` + upsert the managed block into CLAUDE.md + AGENTS.md
/// at the workspace root. Returns the files written. The CLI agents (Claude/Codex)
/// then pick the context up natively from their cwd.
#[tauri::command]
pub fn generate_workspace_context(root: String) -> Result<Vec<String>, String> {
    let dir = std::path::Path::new(&root);
    if !dir.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let ws = detect_workspace_impl(dir);
    let mut written: Vec<String> = Vec::new();

    let json = serde_json::to_string_pretty(&ws).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("aios.workspace.json"), json + "\n").map_err(|e| e.to_string())?;
    ensure_gitignored(dir, "aios.workspace.json");
    written.push("aios.workspace.json".to_string());

    let block = render_workspace_context(&ws);
    for fname in ["CLAUDE.md", "AGENTS.md"] {
        let path = dir.join(fname);
        let existing = std::fs::read_to_string(&path).unwrap_or_default();
        std::fs::write(&path, upsert_managed_block(&existing, &block)).map_err(|e| e.to_string())?;
        written.push(fname.to_string());
    }
    Ok(written)
}

#[cfg(test)]
mod workspace_tests {
    use super::{hash_root, is_env_name, role_for, supersedes_base, upsert_managed_block};

    #[test]
    fn role_inference_backend_wins() {
        assert_eq!(role_for("admin-web"), "frontend");
        assert_eq!(role_for("admin-web-next"), "frontend");
        assert_eq!(role_for("api"), "backend");
        assert_eq!(role_for("api-nitro"), "backend");
        assert_eq!(role_for("web-api"), "backend");
        assert_eq!(role_for("front"), "frontend");
        assert_eq!(role_for("back"), "backend");
        assert_eq!(role_for("weird-thing"), "other");
    }

    #[test]
    fn env_name_matching() {
        assert!(is_env_name("Beta"));
        assert!(is_env_name("staging"));
        assert!(is_env_name("current"));
        assert!(!is_env_name("admin-web"));
        assert!(!is_env_name("front"));
    }

    #[test]
    fn supersedes_detection() {
        assert_eq!(supersedes_base("admin-web-next").as_deref(), Some("admin-web"));
        assert_eq!(supersedes_base("api-nitro").as_deref(), Some("api"));
        assert_eq!(supersedes_base("app-v2").as_deref(), Some("app"));
        assert_eq!(supersedes_base("admin-web"), None);
        assert_eq!(supersedes_base("api"), None);
    }

    #[test]
    fn hash_stable_and_normalized() {
        let a = hash_root("C:\\FHE-Work\\WRMS");
        assert!(a.starts_with("ws_"));
        assert_eq!(a, hash_root("C:\\FHE-Work\\WRMS\\"));
        assert_eq!(a, hash_root("c:\\fhe-work\\wrms"));
        assert_ne!(a, hash_root("C:\\FHE-Work\\Trading-Portal"));
    }

    #[test]
    fn upsert_block_appends_then_replaces_in_place() {
        let b1 = "<!-- AIOS:workspace BEGIN x -->\nAAA\n<!-- AIOS:workspace END -->";
        let out = upsert_managed_block("# my notes\n", b1);
        assert!(out.starts_with("# my notes"));
        assert!(out.contains("AAA"));
        // re-running replaces the block in place (no duplicate), preserves prose.
        let b2 = "<!-- AIOS:workspace BEGIN y -->\nBBB\n<!-- AIOS:workspace END -->";
        let out2 = upsert_managed_block(&out, b2);
        assert!(out2.contains("BBB"));
        assert!(!out2.contains("AAA"));
        assert!(out2.starts_with("# my notes"));
        assert_eq!(out2.matches("AIOS:workspace BEGIN").count(), 1);
        assert_eq!(out2.matches("AIOS:workspace END").count(), 1);
    }
}

/// Returns the user's home directory (HOME, then USERPROFILE on Windows).
#[tauri::command]
pub fn home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| if cfg!(windows) { "C:\\".into() } else { "/".into() })
}

/// Builds a `file://` URL from an absolute path, cross-platform. On Windows
/// `C:\Users\…` → `file:///C:/Users/…`; on unix `/tmp/…` → `file:///tmp/…`.
fn url_from_path(p: &std::path::Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    if s.starts_with('/') {
        format!("file://{s}")
    } else {
        format!("file:///{s}")
    }
}

/// Cap on editable text files: 8 MB. Larger files are refused (the editor isn't
/// meant for huge blobs — guards against loading a gigabyte into the webview).
const EDIT_TEXT_CAP: u64 = 8 * 1024 * 1024;

/// Reads a file's full UTF-8 contents for the editor pane. Refuses files over
/// the cap or that aren't valid UTF-8 (binary). Errors are returned as strings.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("{e}"))?;
    if meta.len() > EDIT_TEXT_CAP {
        return Err(format!(
            "file too large to edit ({} MB > 8 MB)",
            meta.len() / (1024 * 1024)
        ));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("{e}"))?;
    String::from_utf8(bytes).map_err(|_| "not a UTF-8 text file".to_string())
}

/// File modification time in unix MILLISECONDS (0 if unavailable). Higher
/// precision than the seconds used in directory listings, so the editor's
/// save-conflict guard can tell two saves a fraction of a second apart apart.
fn file_mtime_ms(path: &std::path::Path) -> f64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Returns a file's last-modified time in unix milliseconds (0 if missing /
/// unavailable). The editor pane captures this on load so it can detect a
/// conflicting on-disk change before overwriting (AI + human editing the same
/// file). Cheap stat — safe to call on every open/save.
#[tauri::command]
pub fn file_mtime(path: String) -> f64 {
    file_mtime_ms(std::path::Path::new(&path))
}

/// Writes UTF-8 contents back to a file (editor save). Writes to a temp file in
/// the same dir then renames, so a crash mid-write can't truncate the original.
///
/// SAVE-CONFLICT GUARD: when `expected_mtime` is provided (the mtime the editor
/// captured when it loaded the file), the on-disk mtime is re-checked just
/// before the rename. If it changed, the file was modified by someone else (a
/// human, or the AI) since load — we abort with a `conflict:<current_mtime>`
/// error rather than silently clobbering their work. The frontend parses the
/// `conflict:` prefix to show a reload/overwrite prompt. A bare overwrite (no
/// guard) is still possible by passing `expected_mtime = None`.
#[tauri::command]
pub fn write_text_file(
    path: String,
    content: String,
    expected_mtime: Option<f64>,
) -> Result<f64, String> {
    let p = std::path::Path::new(&path);
    // Conflict check: tolerate sub-millisecond float jitter. A real external
    // write moves the mtime by far more than 1ms, so a >1ms delta = conflict.
    if let Some(expected) = expected_mtime {
        if expected > 0.0 {
            let current = file_mtime_ms(p);
            if current > 0.0 && (current - expected).abs() > 1.0 {
                return Err(format!("conflict:{current}"));
            }
        }
    }
    let dir = p.parent().ok_or_else(|| "invalid path".to_string())?;
    // First write into a fresh location (e.g. the notes outbox under
    // ~/.aios/cache/snc/) shouldn't fail on a missing parent.
    std::fs::create_dir_all(dir).map_err(|e| format!("{e}"))?;
    let tmp = dir.join(format!(
        ".{}.aios-tmp",
        p.file_name().and_then(|s| s.to_str()).unwrap_or("file")
    ));
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("{e}"))?;
    std::fs::rename(&tmp, p).map_err(|e| format!("{e}"))?;
    // Hand the new mtime back so the editor re-bases its conflict guard without a
    // second stat round-trip.
    Ok(file_mtime_ms(p))
}

/// Delete a single file (used by the notes pane — full CRUD). Refuses to touch
/// directories so a bad path can't nuke a tree; a missing file is a no-op (the
/// note is already gone, which is the caller's intent).
#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Ok(());
    }
    if p.is_dir() {
        return Err("refusing to delete a directory".into());
    }
    std::fs::remove_file(p).map_err(|e| format!("{e}"))?;
    Ok(())
}

/// Files-pane ops (W7.3). Creation REFUSES to overwrite — the pane's inline
/// editor is for NEW entries; clobbering an existing file via a name typo
/// would be silent data loss.
#[tauri::command]
pub fn fs_create_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err("already exists".into());
    }
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{e}"))?;
    }
    std::fs::write(p, b"").map_err(|e| format!("{e}"))
}

#[tauri::command]
pub fn fs_create_dir(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err("already exists".into());
    }
    std::fs::create_dir_all(p).map_err(|e| format!("{e}"))
}

/// Rename/move within a volume. Refuses to overwrite an existing target for
/// the same reason creation does.
#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    let src = std::path::Path::new(&from);
    let dst = std::path::Path::new(&to);
    if !src.exists() {
        return Err("source does not exist".into());
    }
    if dst.exists() {
        return Err("target already exists".into());
    }
    std::fs::rename(src, dst).map_err(|e| format!("{e}"))
}

/// Move a file OR folder to the OS trash (Recycle Bin / macOS Trash) — the
/// files pane's delete. Recoverable by design; a missing path is a no-op.
#[tauri::command]
pub fn fs_trash(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Ok(());
    }
    trash::delete(p).map_err(|e| format!("{e}"))
}

/// Cap on inline text payloads: ~256 KB.
const PREVIEW_TEXT_CAP: usize = 256 * 1024;

/// Reads a file for preview. Returns a JSON value:
/// `{ kind: "text"|"image"|"pdf"|"binary", text: string|null, size: number,
///    name: string, truncated: bool }`.
/// Defensive — never panics; bad paths return an `Err` string.
#[tauri::command]
pub fn read_file_preview(path: String) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let p = std::path::Path::new(&path);
    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    let size = meta.len();
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    // Images — frontend renders via the asset protocol, no inline payload.
    if matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico"
    ) {
        return Ok(json!({
            "kind": "image",
            "text": serde_json::Value::Null,
            "size": size,
            "name": name,
            "truncated": false,
        }));
    }

    // PDFs — frontend renders via the asset protocol.
    if ext == "pdf" {
        return Ok(json!({
            "kind": "pdf",
            "text": serde_json::Value::Null,
            "size": size,
            "name": name,
            "truncated": false,
        }));
    }

    // Office docs (word/excel/powerpoint + OpenDocument + rtf) — frontend asks
    // for an on-demand LibreOffice → PDF conversion and then renders that PDF.
    if is_office_ext(&ext) {
        return Ok(json!({
            "kind": "office",
            "text": serde_json::Value::Null,
            "size": size,
            "name": name,
            "truncated": false,
        }));
    }

    // Read up to the cap (plus a byte to detect truncation).
    let to_read = (size as usize).min(PREVIEW_TEXT_CAP) + 1;
    let mut bytes = Vec::with_capacity(to_read.min(PREVIEW_TEXT_CAP + 1));
    {
        use std::io::Read;
        let f = std::fs::File::open(p).map_err(|e| e.to_string())?;
        let mut handle = f.take((PREVIEW_TEXT_CAP + 1) as u64);
        handle.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    }

    let truncated = bytes.len() > PREVIEW_TEXT_CAP;
    if truncated {
        bytes.truncate(PREVIEW_TEXT_CAP);
    }

    // Quick media detection: route common video formats directly into the in-pane
    // player instead of generic binary rendering.
    if matches!(ext.as_str(), "mp4" | "mov" | "webm" | "m4v" | "avi" | "mkv") {
        return Ok(json!({
            "kind": "video",
            "text": serde_json::Value::Null,
            "size": size,
            "name": name,
            "truncated": false,
        }));
    }

    // Known text/code extensions, OR anything that decodes cleanly as UTF-8.
    let texty = matches!(
        ext.as_str(),
        "txt" | "md" | "markdown" | "json" | "jsonl" | "csv" | "tsv" | "yaml" | "yml"
            | "toml" | "log" | "ini" | "cfg" | "conf" | "env" | "xml" | "html" | "htm"
            | "css" | "scss" | "less" | "js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs"
            | "rs" | "py" | "rb" | "go" | "java" | "kt" | "kts" | "swift" | "c" | "h"
            | "cpp" | "cc" | "hpp" | "cs" | "php" | "sh" | "bash" | "zsh" | "fish"
            | "sql" | "dart" | "lua" | "pl" | "r" | "scala" | "clj" | "ex" | "exs"
            | "elm" | "vue" | "svelte" | "graphql" | "gql" | "proto" | "dockerfile"
            | "makefile" | "gradle" | "properties" | "diff" | "patch" | "lock" | "gitignore"
    );

    match std::str::from_utf8(&bytes) {
        Ok(s) if texty || !bytes.is_empty() => Ok(json!({
            "kind": "text",
            "text": s,
            "size": size,
            "name": name,
            "truncated": truncated,
        })),
        // Empty file → treat as empty text.
        Ok(_) => Ok(json!({
            "kind": "text",
            "text": "",
            "size": size,
            "name": name,
            "truncated": false,
        })),
        Err(_) => Ok(json!({
            "kind": "binary",
            "text": serde_json::Value::Null,
            "size": size,
            "name": name,
            "truncated": false,
        })),
    }
}

/// Office / document formats LibreOffice can render to PDF.
fn is_office_ext(ext: &str) -> bool {
    matches!(
        ext,
        "doc" | "docx" | "docm" | "dot" | "dotx" | "rtf" | "odt" | "ott" | "fodt"
            | "xls" | "xlsx" | "xlsm" | "xlsb" | "ods" | "ots" | "fods"
            | "ppt" | "pptx" | "pptm" | "pps" | "ppsx" | "odp" | "otp" | "fodp"
    )
}

/// Locates the LibreOffice headless binary across the common install spots.
fn soffice_bin() -> Option<String> {
    #[cfg(windows)]
    {
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(pf) = std::env::var(var) {
                let p = format!(r"{pf}\LibreOffice\program\soffice.exe");
                if std::path::Path::new(&p).exists() {
                    return Some(p);
                }
            }
        }
        return Some("soffice.exe".to_string());
    }
    #[cfg(not(windows))]
    {
        let candidates = [
            "/opt/homebrew/bin/soffice",
            "/usr/local/bin/soffice",
            "/Applications/LibreOffice.app/Contents/MacOS/soffice",
            "/usr/bin/soffice",
            "/usr/bin/libreoffice",
        ];
        for c in candidates {
            if std::path::Path::new(c).exists() {
                return Some(c.to_string());
            }
        }
        // Last resort: rely on PATH resolution.
        Some("soffice".to_string())
    }
}

/// FNV-1a — small, dependency-free hash for cache-key derivation.
fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Converts an office document to PDF via headless LibreOffice and returns the
/// resulting PDF path. Output lands under `/tmp/aios-office-preview/` (in the
/// asset-protocol scope) and is cached by source path + mtime + size, so
/// re-opening an unchanged file is instant. A per-call user profile dir lets
/// this run even while the LibreOffice GUI is open.
#[tauri::command]
pub fn convert_office_to_pdf(path: String) -> Result<String, String> {
    let src = std::path::Path::new(&path);
    let meta = std::fs::metadata(src).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a file".into());
    }

    // Cache key: source path + mtime + size → stable while the file is unchanged.
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let key = fnv1a(&format!("{}|{}|{}", path, mtime, meta.len()));

    let preview_root = std::env::temp_dir().join("aios-office-preview");
    let out_dir = preview_root.join(format!("{key:x}"));
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".into());
    let out_pdf = out_dir.join(format!("{stem}.pdf"));

    // Cached hit — return immediately.
    if out_pdf.exists() {
        return Ok(out_pdf.to_string_lossy().to_string());
    }

    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let bin = soffice_bin().ok_or("LibreOffice (soffice) not found")?;
    // Isolated profile so we don't clash with a running LibreOffice instance.
    // Build the file:// URL from the platform temp dir (valid on Windows too).
    let profile_url = url_from_path(&preview_root.join(format!(".profile-{key:x}")));
    let profile = format!("-env:UserInstallation={profile_url}");

    let output = std::process::Command::new(&bin)
        .arg("--headless")
        .arg(&profile)
        .arg("--convert-to")
        .arg("pdf")
        .arg("--outdir")
        .arg(&out_dir)
        .arg(src)
        .no_window()
        .output()
        .map_err(|e| format!("failed to launch soffice: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("conversion failed: {}", err.trim()));
    }

    if out_pdf.exists() {
        return Ok(out_pdf.to_string_lossy().to_string());
    }

    // soffice occasionally sanitizes the output stem — fall back to whatever
    // single PDF it dropped in the (otherwise empty) output dir.
    if let Ok(rd) = std::fs::read_dir(&out_dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().map(|x| x == "pdf").unwrap_or(false) {
                return Ok(p.to_string_lossy().to_string());
            }
        }
    }

    Err("conversion produced no PDF".into())
}

/// Decodes standard base64 (no whitespace/newlines tolerated beyond what we
/// strip) into bytes. Dependency-free so we don't pull a crate just for paste.
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let mut buf = 0u32;
    let mut bits = 0u32;
    for c in input.bytes() {
        if c == b'=' || c == b'\n' || c == b'\r' || c == b' ' || c == b'\t' {
            continue;
        }
        let v = val(c).ok_or("invalid base64 character")?;
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

/// Persists a clipboard / dropped image to a temp file and returns its path, so
/// the terminal can hand the path to a CLI AI (claude code) for vision.
///
/// `data` is the raw base64 of the image bytes (NOT a data-URL — the frontend
/// strips the `data:image/png;base64,` prefix). `ext` is the desired file
/// extension (e.g. "png", "jpg"). The file lands under `/tmp/aios-paste/` with
/// a content-hashed name so repeated pastes of the same image dedupe.
#[tauri::command]
pub fn save_image_temp(data: String, ext: String) -> Result<String, String> {
    let bytes = base64_decode(&data)?;
    if bytes.is_empty() {
        return Err("empty image data".into());
    }
    let safe_ext: String = ext
        .trim_start_matches('.')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    let safe_ext = if safe_ext.is_empty() { "png".into() } else { safe_ext };

    let dir = std::env::temp_dir().join("aios-paste");
    let dir = dir.as_path();
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let key = fnv1a(&format!("{}|{}", bytes.len(), bytes.iter().take(4096).fold(0u64, |a, &b| a.wrapping_add(b as u64))));
    let path = dir.join(format!("paste-{key:x}.{safe_ext}"));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// ── Cmd+P file finder + Cmd+Shift+F content search ──────────────────────────

/// Directory names always skipped by the file finder + content search, on top
/// of whatever `.gitignore` excludes. These are heavy build/dep/vcs dirs the
/// `ignore` walker doesn't drop by default (it only knows .git).
fn is_search_pruned_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | ".turbo"
            | ".cache"
            | ".dart_tool"
            | "Pods"
            | "vendor"
            | ".venv"
            | "venv"
            | "__pycache__"
    )
}

/// Builds an `ignore`-crate walker rooted at `root` that honors `.gitignore`
/// (and global/parent gitignores) and also prunes our extra junk dirs. Shared
/// by `find_files` and the search fallback so both respect identical rules.
fn search_walk_builder(root: &str) -> ignore::WalkBuilder {
    let mut b = ignore::WalkBuilder::new(root);
    b.hidden(false) // show dotfiles (.claude, .env) like VS Code; we prune junk explicitly
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .parents(true)
        .filter_entry(|e| {
            // Prune our extra heavy dirs by name (applies to directories only).
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                if let Some(name) = e.file_name().to_str() {
                    return !is_search_pruned_dir(name);
                }
            }
            // Always drop .DS_Store noise.
            e.file_name().to_str() != Some(".DS_Store")
        });
    b
}

/// Recursively lists file paths under `root`, RELATIVE to `root`, files only.
/// Honors `.gitignore` (+ global/parent) and prunes heavy dirs (node_modules,
/// target, dist, .next, …). Capped at `max` (default 20000) so a giant tree
/// can't run away — returns whatever was found up to the cap. Powers Cmd+P.
#[tauri::command]
pub fn find_files(root: String, max: Option<usize>) -> Result<Vec<String>, String> {
    let cap = max.unwrap_or(20000);
    let root_path = std::path::Path::new(&root);
    if !root_path.is_dir() {
        return Err("root is not a directory".into());
    }

    let mut out: Vec<String> = Vec::new();
    for dent in search_walk_builder(&root).build() {
        if out.len() >= cap {
            break;
        }
        let dent = match dent {
            Ok(d) => d,
            Err(_) => continue,
        };
        // Files only (depth 0 is the root dir itself).
        if dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            let rel = dent
                .path()
                .strip_prefix(root_path)
                .unwrap_or(dent.path());
            // Always emit forward slashes — the frontend (⌘P scoring, chat's
            // fuzzy file-open fallback) matches against `/`-joined paths, and
            // Windows APIs accept either separator on the way back in.
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(out)
}

/// Deterministically resolves a file `reference` (as emitted by an LLM in chat
/// — a bare name, a relative path, or an absolute/`~` path) against the chat
/// session's working dir. Returns the canonical absolute path ONLY if it points
/// at a file that actually exists; `None` otherwise. This is the gold-source
/// check behind chat's "open in pane" affordance — we never search-by-name and
/// hope. The resolution order mirrors how a human reads a path the model wrote:
///   1. absolute (`/…`) or home (`~/…`) — used as-is;
///   2. exact join against `cwd` (`{cwd}/{ref}`) — the common case;
///   3. nothing matched → `None` (caller may fall back to a bounded fuzzy find).
/// Symlinks/`..` are collapsed via `canonicalize`, which also confirms existence.
#[tauri::command]
pub fn resolve_in_cwd(cwd: String, reference: String) -> Option<String> {
    let r = reference.trim();
    if r.is_empty() {
        return None;
    }
    // strip a trailing :line[:col] suffix (e.g. "src/x.rs:42") the model may add.
    let r = r
        .rsplit_once(':')
        .and_then(|(head, tail)| {
            if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) && !head.is_empty() {
                Some(head)
            } else {
                None
            }
        })
        .unwrap_or(r);

    let candidate: std::path::PathBuf = if let Some(rest) = r.strip_prefix("~/") {
        std::path::Path::new(&home_dir()).join(rest)
    } else if r == "~" {
        std::path::PathBuf::from(home_dir())
    } else if r.starts_with('/') || std::path::Path::new(r).is_absolute() {
        // covers `/…` AND Windows `C:\…` / `C:/…` / UNC — joining an absolute
        // ref onto cwd would be wrong on all of them. (`/…` is checked
        // explicitly: on Windows a rooted-but-driveless path isn't
        // `is_absolute()`, yet joining it onto cwd would still be wrong.)
        std::path::PathBuf::from(r)
    } else if cwd.trim().is_empty() {
        // no cwd to anchor a relative ref against → can't resolve deterministically.
        return None;
    } else {
        std::path::Path::new(&cwd).join(r)
    };

    let canon = candidate.canonicalize().ok()?;
    if canon.is_file() {
        Some(strip_verbatim(&canon.to_string_lossy()))
    } else {
        None
    }
}

/// Windows `canonicalize` returns extended-length paths (`\\?\C:\…`,
/// `\\?\UNC\server\share`). Strip the verbatim prefix back to the familiar
/// form — downstream consumers (pane titles, dedup-by-path, MRU) compare
/// against plain paths. No-op on Unix and on already-plain paths.
fn strip_verbatim(p: &str) -> String {
    if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = p.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        p.to_string()
    }
}

/// `~/.aios/state/ui-state.json` — a tiny disk mirror of the webview's
/// localStorage-backed UI prefs (settings blob, theme, accents, density).
/// WebView2 can drop localStorage on profile resets, and dev vs installed
/// builds live on different origins with separate localStorage — the mirror
/// survives both; boot re-hydrates any missing keys (lib/uiMirror.ts).
fn ui_state_path() -> std::path::PathBuf {
    std::path::Path::new(&home_dir()).join(".aios/state/ui-state.json")
}

#[tauri::command]
pub fn ui_state_load() -> Option<String> {
    std::fs::read_to_string(ui_state_path()).ok()
}

#[tauri::command]
pub fn ui_state_save(json: String) -> Result<(), String> {
    let path = ui_state_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // atomic-ish: temp + rename so a crash mid-write can't truncate the mirror.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod resolve_tests {
    use super::{resolve_in_cwd, strip_verbatim};

    #[test]
    fn verbatim_prefix_stripped() {
        assert_eq!(strip_verbatim(r"\\?\C:\x\y.md"), r"C:\x\y.md");
        assert_eq!(strip_verbatim(r"\\?\UNC\srv\share\y.md"), r"\\srv\share\y.md");
        assert_eq!(strip_verbatim("/plain/unix"), "/plain/unix");
    }

    #[test]
    fn relative_ref_resolves_to_a_plain_path() {
        let dir = std::env::temp_dir().join("aios-resolve-test");
        std::fs::create_dir_all(dir.join("docs")).unwrap();
        std::fs::write(dir.join("docs").join("note.md"), "x").unwrap();
        // forward slashes + a :line suffix, exactly as a model writes them
        let got = resolve_in_cwd(dir.to_string_lossy().to_string(), "docs/note.md:12".into())
            .expect("exact join should resolve");
        assert!(!got.starts_with(r"\\?\"), "verbatim prefix must be stripped: {got}");
        assert!(got.ends_with("note.md"), "unexpected path: {got}");
    }

    #[test]
    fn absolute_ref_ignores_cwd() {
        let dir = std::env::temp_dir().join("aios-resolve-test-abs");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        let abs = dir.join("a.txt").to_string_lossy().to_string();
        let got = resolve_in_cwd("definitely-not-a-dir".into(), abs)
            .expect("absolute ref should resolve without cwd");
        assert!(got.ends_with("a.txt"), "unexpected path: {got}");
    }
}

/// One content-search match. `path` is relative to the search root, `line`/`col`
/// are 1-based, `text` is the matching line trimmed + capped at ~300 chars.
#[derive(Serialize)]
pub struct SearchHit {
    path: String,
    line: u32,
    col: u32,
    text: String,
}

const HIT_TEXT_CAP: usize = 300;

/// Trims a matching line and caps it at `HIT_TEXT_CAP` chars (char-boundary safe).
fn cap_hit_text(s: &str) -> String {
    let t = s.trim();
    if t.chars().count() <= HIT_TEXT_CAP {
        return t.to_string();
    }
    t.chars().take(HIT_TEXT_CAP).collect()
}

/// Locates a real `rg` (ripgrep) binary on disk. Returns `None` if not found,
/// in which case the Rust fallback scanner is used. (We avoid bare "rg" /
/// PATH lookup because the GUI-launched process has a minimal PATH.)
fn ripgrep_bin() -> Option<String> {
    let candidates = [
        "/opt/homebrew/bin/rg",
        "/usr/local/bin/rg",
        "/usr/bin/rg",
    ];
    for c in candidates {
        if std::path::Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    #[cfg(windows)]
    {
        // Typical Windows installs: scoop shim, cargo install, chocolatey —
        // then a plain PATH scan for rg.exe.
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            for rel in [r"scoop\shims\rg.exe", r".cargo\bin\rg.exe"] {
                let p = std::path::Path::new(&home).join(rel);
                if p.is_file() {
                    return Some(p.to_string_lossy().into_owned());
                }
            }
        }
        if std::path::Path::new(r"C:\ProgramData\chocolatey\bin\rg.exe").is_file() {
            return Some(r"C:\ProgramData\chocolatey\bin\rg.exe".to_string());
        }
        if let Some(path) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&path) {
                let p = dir.join("rg.exe");
                if p.is_file() {
                    return Some(p.to_string_lossy().into_owned());
                }
            }
        }
    }
    None
}

/// Case-insensitive literal substring search of file CONTENTS under `root`.
/// Honors the same ignore rules as `find_files`. Returns up to `max` hits
/// (default 1000). Uses `rg --json` when a ripgrep binary is present (fast +
/// correct, skips binaries); falls back to a Rust line scanner via the
/// `ignore` walker otherwise. Powers Cmd+Shift+F.
#[tauri::command]
pub fn search_in_files(
    root: String,
    query: String,
    max: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let cap = max.unwrap_or(1000);
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let root_path = std::path::Path::new(&root);
    if !root_path.is_dir() {
        return Err("root is not a directory".into());
    }

    if let Some(rg) = ripgrep_bin() {
        return search_with_rg(&rg, root_path, &query, cap);
    }
    search_with_ignore(root_path, &query, cap)
}

/// Runs `rg --json` for a fixed (literal), case-insensitive substring search and
/// parses the streaming JSON match objects into `SearchHit`s.
fn search_with_rg(
    rg: &str,
    root: &std::path::Path,
    query: &str,
    cap: usize,
) -> Result<Vec<SearchHit>, String> {
    let output = std::process::Command::new(rg)
        .arg("--json")
        .arg("--fixed-strings") // literal, not regex
        .arg("--ignore-case")
        .arg("--max-count")
        .arg(cap.to_string()) // per-file cap; total bounded below too
        .arg("--")
        .arg(query)
        .arg(".")
        .current_dir(root)
        .no_window()
        .output()
        .map_err(|e| format!("failed to launch rg: {e}"))?;

    // rg exits 1 when there are no matches — that's not an error for us.
    if !output.status.success() && output.status.code() != Some(1) {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("rg failed: {}", err.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut hits: Vec<SearchHit> = Vec::new();
    for line in stdout.lines() {
        if hits.len() >= cap {
            break;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("match") {
            continue;
        }
        let data = match v.get("data") {
            Some(d) => d,
            None => continue,
        };
        let path = data
            .get("path")
            .and_then(|p| p.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .trim_start_matches("./")
            .to_string();
        let line_no = data
            .get("line_number")
            .and_then(|n| n.as_u64())
            .unwrap_or(0) as u32;
        let text = data
            .get("lines")
            .and_then(|l| l.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or("");
        // First submatch column (byte offset → 1-based col, best-effort).
        let col = data
            .get("submatches")
            .and_then(|s| s.as_array())
            .and_then(|a| a.first())
            .and_then(|m| m.get("start"))
            .and_then(|n| n.as_u64())
            .map(|n| n as u32 + 1)
            .unwrap_or(1);
        hits.push(SearchHit {
            path,
            line: line_no,
            col,
            text: cap_hit_text(text),
        });
    }
    Ok(hits)
}

/// Pure-Rust fallback: walk via the `ignore` crate and scan each text file line
/// by line for a case-insensitive literal substring. Skips files that aren't
/// valid UTF-8 (binary) and large files.
fn search_with_ignore(
    root: &std::path::Path,
    query: &str,
    cap: usize,
) -> Result<Vec<SearchHit>, String> {
    let needle = query.to_lowercase();
    let mut hits: Vec<SearchHit> = Vec::new();

    for dent in search_walk_builder(&root.to_string_lossy()).build() {
        if hits.len() >= cap {
            break;
        }
        let dent = match dent {
            Ok(d) => d,
            Err(_) => continue,
        };
        if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        // Skip very large files outright (binary or generated blobs).
        if dent.metadata().map(|m| m.len() > EDIT_TEXT_CAP).unwrap_or(false) {
            continue;
        }
        let bytes = match std::fs::read(dent.path()) {
            Ok(b) => b,
            Err(_) => continue,
        };
        // Binary heuristic: a NUL byte → skip.
        if bytes.contains(&0) {
            continue;
        }
        let content = match std::str::from_utf8(&bytes) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let rel = dent
            .path()
            .strip_prefix(root)
            .unwrap_or(dent.path())
            .to_string_lossy()
            .to_string();
        for (i, line) in content.lines().enumerate() {
            if hits.len() >= cap {
                break;
            }
            let lower = line.to_lowercase();
            if let Some(byte_idx) = lower.find(&needle) {
                // byte index in the lowercased line ≈ col for ascii; good enough.
                let col = line[..byte_idx.min(line.len())].chars().count() as u32 + 1;
                hits.push(SearchHit {
                    path: rel.clone(),
                    line: (i + 1) as u32,
                    col,
                    text: cap_hit_text(line),
                });
            }
        }
    }
    Ok(hits)
}
