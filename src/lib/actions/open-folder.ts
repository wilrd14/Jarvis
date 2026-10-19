import { isRecord, type ActionDefinition } from "./types";
import { resolveAlias, SERVER_ONLY } from "./pc-shared";

export const FOLDER_ALIASES = {
  documents: ["documentos", "mis documentos", "documents"],
  downloads: ["descargas", "downloads"],
  desktop: ["escritorio", "desktop"],
  pictures: ["imagenes", "fotos", "pictures", "mis imagenes"],
  music: ["musica", "music"],
  videos: ["videos", "video"],
} as const satisfies Record<string, readonly string[]>;

export type FolderId = keyof typeof FOLDER_ALIASES;
const FOLDER_LABELS: Record<FolderId, string> = {
  documents: "Documentos",
  downloads: "Descargas",
  desktop: "Escritorio",
  pictures: "Imágenes",
  music: "Música",
  videos: "Videos",
};

export interface OpenFolderAction {
  type: "open_folder";
  folder: FolderId;
}

export const openFolderAction: ActionDefinition<OpenFolderAction> = {
  type: "open_folder",
  description: `Abrir una carpeta conocida del usuario en el Explorador. Valores de "folder": ${Object.keys(FOLDER_ALIASES).join(", ")} (documentos, descargas, escritorio, imágenes, música, videos). No se aceptan rutas.`,
  schema: `{ "type": "open_folder", "folder": "downloads" }`,
  risk: "confirm",
  label: (a) => ({ title: "Abrir carpeta", detail: `Abrir ${FOLDER_LABELS[a.folder]}` }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const folder = resolveAlias(raw.folder, FOLDER_ALIASES);
    return folder ? { type: "open_folder", folder } : null;
  },
  execution: {
    kind: "server",
    async run(a) {
      if (typeof window === "undefined") {
        const { openKnownFolder } = await import("./pc-control.server");
        return openKnownFolder(a.folder);
      }
      return SERVER_ONLY;
    },
  },
};
