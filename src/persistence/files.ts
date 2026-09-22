// New / Open / Save / Backup for real .sqlite files. Uses the File System Access API when the
// browser supports it (Chrome/Edge — gives a true "Save" that writes back to the same file);
// falls back to a download + hidden file input elsewhere (e.g. Firefox).

export interface OpenedFile {
  bytes: Uint8Array;
  name: string;
  handle: FileSystemFileHandle | null;
}

interface FileSystemFileHandleLike extends FileSystemFileHandle {}

function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

const SQLITE_TYPES = {
  description: 'SQLite database',
  accept: { 'application/x-sqlite3': ['.sqlite', '.db'] },
};

export async function openFile(): Promise<OpenedFile | null> {
  if (hasFileSystemAccess()) {
    try {
      const win = window as unknown as { showOpenFilePicker: (opts: unknown) => Promise<FileSystemFileHandleLike[]> };
      const [handle] = await win.showOpenFilePicker({ types: [SQLITE_TYPES], multiple: false });
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { bytes, name: file.name, handle };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      throw err;
    }
  }
  return openFileFallback();
}

function openFileFallback(): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sqlite,.db';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      resolve({ bytes, name: file.name, handle: null });
    };
    input.click();
  });
}

/** Saves to an existing file handle (from Open or a prior Save As) without prompting. */
export async function saveToHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(bytes.slice());
  await writable.close();
}

/** Prompts for a destination. Returns the new handle when the platform supports one. */
export async function saveAs(bytes: Uint8Array, suggestedName: string): Promise<FileSystemFileHandle | null> {
  if (hasFileSystemAccess()) {
    try {
      const win = window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandleLike> };
      const handle = await win.showSaveFilePicker({ suggestedName, types: [SQLITE_TYPES] });
      await saveToHandle(handle, bytes);
      return handle;
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      throw err;
    }
  }
  downloadBytes(bytes, suggestedName);
  return null;
}

export function downloadBytes(bytes: Uint8Array, filename: string, mimeType = 'application/x-sqlite3'): void {
  const blob = new Blob([bytes.slice()], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function supportsFileSystemAccess(): boolean {
  return hasFileSystemAccess();
}

export interface OpenedXlsx {
  buffer: ArrayBuffer;
  name: string;
}

const XLSX_TYPES = {
  description: 'Excel workbook',
  accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
};

export async function openXlsxFile(): Promise<OpenedXlsx | null> {
  if (hasFileSystemAccess()) {
    try {
      const win = window as unknown as { showOpenFilePicker: (opts: unknown) => Promise<FileSystemFileHandleLike[]> };
      const [handle] = await win.showOpenFilePicker({ types: [XLSX_TYPES], multiple: false });
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      return { buffer, name: file.name };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      throw err;
    }
  }
  return openXlsxFileFallback();
}

function openXlsxFileFallback(): Promise<OpenedXlsx | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const buffer = await file.arrayBuffer();
      resolve({ buffer, name: file.name });
    };
    input.click();
  });
}

export interface OpenedJson {
  text: string;
  name: string;
}

const JSON_TYPES = {
  description: 'JSON file',
  accept: { 'application/json': ['.json'] },
};

/** Picks a .json file — the manual bridge for a Jira REST search-response export (see
 * docs/INTEGRATIONS.md §3.1: "even a manual CSV/export step ... as a bridge until real API access
 * is arranged") until Phase 5b wires up the real Jira HTTP client. */
export async function openJsonFile(): Promise<OpenedJson | null> {
  if (hasFileSystemAccess()) {
    try {
      const win = window as unknown as { showOpenFilePicker: (opts: unknown) => Promise<FileSystemFileHandleLike[]> };
      const [handle] = await win.showOpenFilePicker({ types: [JSON_TYPES], multiple: false });
      const file = await handle.getFile();
      const text = await file.text();
      return { text, name: file.name };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      throw err;
    }
  }
  return openJsonFileFallback();
}

function openJsonFileFallback(): Promise<OpenedJson | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const text = await file.text();
      resolve({ text, name: file.name });
    };
    input.click();
  });
}
