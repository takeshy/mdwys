export interface LocalFileResult {
  path: string;
  fileName: string;
  content: string;
}

interface WailsAppApi {
  SelectLocalFile: () => Promise<LocalFileResult | null>;
  SelectLocalFilePath: () => Promise<string>;
  SelectExternalEditor: () => Promise<string>;
  ReadLocalFile: (path: string) => Promise<LocalFileResult>;
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

export async function selectExternalEditor(): Promise<string> {
  return await appApi()?.SelectExternalEditor() ?? "";
}

export async function readLocalFile(path: string): Promise<LocalFileResult | null> {
  if (!path) return null;
  return await appApi()?.ReadLocalFile(path) ?? null;
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
