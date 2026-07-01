import { unzipSync } from "fflate";

type ZipEntries = Record<string, Uint8Array>;

type ManifestItem = {
  id: string;
  href: string;
  mediaType: string;
  path: string;
};

const textDecoder = new TextDecoder();

function decodeText(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function normalizePath(path: string): string {
  const output: string[] = [];
  path.split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") output.pop();
    else output.push(part);
  });
  return output.join("/");
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index + 1);
}

function joinPath(basePath: string, relativePath: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(relativePath) || relativePath.startsWith("#")) return relativePath;
  return normalizePath(`${dirname(basePath)}${relativePath}`);
}

function attr(element: Element, name: string): string {
  return element.getAttribute(name) || "";
}

function parseXml(value: string, label: string): Document {
  const doc = new DOMParser().parseFromString(value, "application/xml");
  const error = doc.querySelector("parsererror");
  if (error) throw new Error(`Invalid ${label}`);
  return doc;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstTextByLocalName(doc: Document, localName: string): string {
  return [...doc.getElementsByTagName("*")].find((element) => element.localName === localName)?.textContent?.trim() || "";
}

function firstElementByLocalName(doc: Document, localName: string): Element | undefined {
  return [...doc.getElementsByTagName("*")].find((element) => element.localName === localName);
}

function dataUrlFor(path: string, mediaType: string, entries: ZipEntries): string | null {
  const bytes = entries[path];
  if (!bytes) return null;
  return `data:${mediaType || "application/octet-stream"};base64,${bytesToBase64(bytes)}`;
}

function readManifest(opf: Document, opfPath: string): Map<string, ManifestItem> {
  const items = new Map<string, ManifestItem>();
  opf.querySelectorAll("manifest > item").forEach((item) => {
    const id = attr(item, "id");
    const href = attr(item, "href");
    if (!id || !href) return;
    items.set(id, {
      id,
      href,
      mediaType: attr(item, "media-type"),
      path: joinPath(opfPath, href),
    });
  });
  return items;
}

function rewriteUrls(root: ParentNode, chapterPath: string, manifestByPath: Map<string, ManifestItem>, entries: ZipEntries) {
  root.querySelectorAll("script").forEach((script) => script.remove());

  root.querySelectorAll("[src]").forEach((element) => {
    const source = attr(element, "src");
    const path = joinPath(chapterPath, source);
    const item = manifestByPath.get(path);
    const dataUrl = dataUrlFor(path, item?.mediaType || "", entries);
    if (dataUrl) element.setAttribute("src", dataUrl);
  });

  root.querySelectorAll("a[href]").forEach((element) => {
    const href = attr(element, "href");
    if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    element.setAttribute("href", "#");
  });
}

function chapterTitle(doc: Document): string {
  return doc.querySelector("title")?.textContent?.trim() || "";
}

export async function epubToHtml(file: File): Promise<string> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const containerBytes = entries["META-INF/container.xml"];
  if (!containerBytes) throw new Error("EPUB container.xml was not found.");

  const container = parseXml(decodeText(containerBytes), "EPUB container");
  const opfPath = firstElementByLocalName(container, "rootfile")?.getAttribute("full-path");
  if (!opfPath || !entries[opfPath]) throw new Error("EPUB package file was not found.");

  const opf = parseXml(decodeText(entries[opfPath]), "EPUB package");
  const title = firstTextByLocalName(opf, "title") || file.name;
  const manifest = readManifest(opf, opfPath);
  const manifestByPath = new Map([...manifest.values()].map((item) => [item.path, item]));
  const spine = [...opf.querySelectorAll("spine > itemref")]
    .map((item) => manifest.get(attr(item, "idref")))
    .filter((item): item is ManifestItem => !!item && !!entries[item.path]);

  if (!spine.length) throw new Error("EPUB spine is empty.");

  const chapters = spine.map((item, index) => {
    const doc = new DOMParser().parseFromString(decodeText(entries[item.path]), "text/html");
    rewriteUrls(doc, item.path, manifestByPath, entries);
    const body = doc.body?.innerHTML || "";
    const heading = chapterTitle(doc);
    return `<section class="epub-chapter" id="epub-chapter-${index + 1}">${heading ? `<h1>${escapeHtml(heading)}</h1>` : ""}${body}</section>`;
  });

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      html { font-size: var(--view-font-scale, 100%); }
      body { margin: 0; padding: 28px clamp(12px, 2vw, 28px); color: #172033; background: #fff; font: 1rem/1.75 ui-serif, Georgia, serif; }
      .epub-book { width: min(100%, var(--view-content-width, 1120px)); margin: 0 auto; }
      .epub-title { margin: 0 0 1.5rem; font: 700 1.8rem/1.25 ui-sans-serif, system-ui, sans-serif; }
      .epub-chapter { margin: 0 0 3rem; }
      .epub-chapter h1 { font: 700 1.45rem/1.3 ui-sans-serif, system-ui, sans-serif; margin: 0 0 1rem; }
      img, svg, video { max-width: 100%; height: auto; }
      a { color: #0f766e; }
      pre { overflow: auto; padding: 1rem; background: #f0f3f7; }
    </style>
  </head>
  <body>
    <main class="epub-book">
      <h1 class="epub-title">${escapeHtml(title)}</h1>
      ${chapters.join("\n")}
    </main>
  </body>
</html>`;
}

export function isEpubFileName(fileName: string): boolean {
  return /\.epub$/i.test(fileName);
}
