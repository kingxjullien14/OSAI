import type { PaneContent } from "./apps";
import { basename, dirname } from "./paths.ts";

export type PaneFileTarget = {
  path: string;
  name: string;
};

export function paneFileTarget(kind: PaneContent): PaneFileTarget | null {
  if (kind.type !== "editor" && kind.type !== "file") return null;
  return {
    path: kind.path,
    name: kind.name || basename(kind.path),
  };
}

export function containingDir(path: string): string {
  return dirname(path);
}
