export interface LocalFileResult {
  path: string;
  fileName: string;
  content: string;
}

export interface MemoFileResult {
  exists: boolean;
  content: string;
}

export interface MemoListEntry {
  memoPath: string;
  source: string;
  modTime: number;
}

interface WailsAppApi {
  SelectLocalFile: () => Promise<LocalFileResult | null>;
  SelectLocalFilePath: () => Promise<string>;
  SelectSaveFilePath: (defaultFileName: string) => Promise<string>;
  SelectDirectoryPath: () => Promise<string>;
  SelectExternalEditor: () => Promise<string>;
  ReadLocalFile: (path: string) => Promise<LocalFileResult>;
  WriteLocalTextFile: (path: string, content: string) => Promise<LocalFileResult>;
  ListSiblingImageFiles: (path: string) => Promise<string[] | null>;
  ReadMemoFile: (path: string) => Promise<MemoFileResult>;
  ListMemoFiles: (dir: string) => Promise<MemoListEntry[] | null>;
  AppendMemoFile: (path: string, content: string) => Promise<void>;
  WriteMemoFileAtomic: (path: string, content: string) => Promise<void>;
  StartupFilePaths: () => Promise<string[]>;
  OpenExternalEditor: (editorPath: string, filePath: string) => Promise<void>;
}

interface WailsRuntimeApi {
  OnFileDrop: (callback: (x: number, y: number, paths: string[]) => void, useDropTarget?: boolean) => void;
  OnFileDropOff: () => void;
}

declare global {
  interface Window {
    go?: {
      main?: {
        App?: WailsAppApi;
      };
    };
    runtime?: WailsRuntimeApi;
  }
}

function appApi(): WailsAppApi | null {
  return window.go?.main?.App ?? null;
}

export function hasWailsBackend(): boolean {
  return appApi() !== null;
}

export async function selectLocalFile(): Promise<LocalFileResult | null> {
  return await appApi()?.SelectLocalFile() ?? null;
}

export async function selectLocalFilePath(): Promise<string> {
  return await appApi()?.SelectLocalFilePath() ?? "";
}

export async function selectSaveFilePath(defaultFileName: string): Promise<string> {
  return await appApi()?.SelectSaveFilePath(defaultFileName) ?? "";
}

export async function selectDirectoryPath(): Promise<string> {
  return await appApi()?.SelectDirectoryPath() ?? "";
}

export async function readMemoFile(path: string): Promise<MemoFileResult> {
  if (!path) return { exists: false, content: "" };
  return await appApi()?.ReadMemoFile(path) ?? { exists: false, content: "" };
}

export async function listMemoFiles(dir: string): Promise<MemoListEntry[]> {
  if (!dir) return [];
  return await appApi()?.ListMemoFiles(dir) ?? [];
}

export async function appendMemoFile(path: string, content: string): Promise<void> {
  const api = appApi();
  if (!api) throw new Error("Memo files require the desktop app.");
  await api.AppendMemoFile(path, content);
}

export async function writeMemoFileAtomic(path: string, content: string): Promise<void> {
  const api = appApi();
  if (!api) throw new Error("Memo files require the desktop app.");
  await api.WriteMemoFileAtomic(path, content);
}

export async function selectExternalEditor(): Promise<string> {
  return await appApi()?.SelectExternalEditor() ?? "";
}

export async function readLocalFile(path: string): Promise<LocalFileResult | null> {
  if (!path) return null;
  return await appApi()?.ReadLocalFile(path) ?? null;
}

export async function writeLocalTextFile(path: string, content: string): Promise<LocalFileResult | null> {
  if (!path) return null;
  return await appApi()?.WriteLocalTextFile(path, content) ?? null;
}

export async function listSiblingImageFiles(path: string): Promise<string[]> {
  if (!path) return [];
  return await appApi()?.ListSiblingImageFiles(path) ?? [];
}

export async function startupFilePaths(): Promise<string[]> {
  return await appApi()?.StartupFilePaths() ?? [];
}

export async function openExternalEditor(editorPath: string, filePath: string): Promise<void> {
  if (!editorPath || !filePath) return;
  await appApi()?.OpenExternalEditor(editorPath, filePath);
}

export function onWailsFileDrop(callback: (x: number, y: number, paths: string[]) => void): (() => void) | null {
  const runtime = window.runtime;
  if (!runtime?.OnFileDrop || !runtime.OnFileDropOff) return null;
  runtime.OnFileDrop(callback, false);
  return () => runtime.OnFileDropOff();
}
