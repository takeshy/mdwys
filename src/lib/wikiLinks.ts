import { isWindowsPath } from "./memoPath";

export const IMAGE_EXT_RE = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;

export function transformWikiLinks(body: string): string {
  return body
    .replace(/!\[\[([^\]\n]+)\]\]/g, (_match, target: string) => `![${target}](#wikiembed:${encodeURIComponent(target)})`)
    .replace(/(^|[^!])\[\[([^\]\n]+)\]\]/g, (_match, lead: string, target: string) => {
      const label = target.split("|")[1]?.trim() || target.split("|")[0].trim();
      return `${lead}[${label}](#wiki:${encodeURIComponent(target)})`;
    });
}

export function wikiTargetToPath(baseDirPath: string, target: string): string {
  const clean = target.split("|")[0].split("#")[0].trim();
  return localTargetToPath(baseDirPath, clean);
}

export function localTargetToPath(baseDirPath: string, target: string): string {
  const clean = target.split("#")[0].trim();
  if (!clean) return "";
  const windows = isWindowsPath(baseDirPath) || isWindowsPath(clean);
  if (clean.startsWith("/") || isWindowsPath(clean) || clean.startsWith("\\\\")) {
    return /\.[A-Za-z0-9]+$/.test(clean) ? clean : `${clean}.md`;
  }
  const withExt = /\.[A-Za-z0-9]+$/.test(clean) ? clean : `${clean}.md`;
  const separator = windows ? "\\" : "/";
  const trimmed = baseDirPath.endsWith("/") || baseDirPath.endsWith("\\") ? baseDirPath.slice(0, -1) : baseDirPath;
  return `${trimmed}${separator}${withExt}`;
}

export function localHrefToPathCandidates(baseDirPath: string, href: string): string[] {
  const target = hrefToLocalTarget(href);
  const clean = target.split("#")[0].trim();
  if (!clean) return [];
  if (clean.startsWith("/") && !isWindowsPath(clean) && !clean.startsWith("\\\\")) {
    const rootTarget = clean.replace(/^\/+/, "");
    const parentDir = pathDirName(baseDirPath);
    return [localTargetToPath(parentDir || baseDirPath, rootTarget), localTargetToPath(baseDirPath, rootTarget)]
      .filter((path, index, paths) => path && paths.indexOf(path) === index);
  }
  return [localTargetToPath(baseDirPath, clean)];
}

export function isLocalDocumentHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith("#wiki:") || href.startsWith("#wikiembed:")) return true;
  if (href.startsWith("#")) return false;
  if (href.startsWith("//")) return false;
  if (/^https?:\/\/wails\.localhost(?::\d+)?\//i.test(href)) return true;
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href);
}

export function hrefToLocalTarget(href: string): string {
  if (/^https?:\/\/wails\.localhost(?::\d+)?\//i.test(href)) {
    try {
      return decodeURIComponent(new URL(href).pathname);
    } catch {
      return href;
    }
  }
  return href;
}

export function pathDirName(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex === -1 ? "" : path.slice(0, separatorIndex);
}
