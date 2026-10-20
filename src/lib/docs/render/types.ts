/** Opciones de renderizado compartidas por todos los formatos. */
export interface RenderOpts {
  /** CSV: separador (por defecto ";" que abre bien en Excel en español). */
  csvDelimiter?: "," | ";" | "\t";
  /** CSV: exportar todas las tablas (separadas por una línea en blanco) en vez de solo la primera. */
  csvAllTables?: boolean;
  /** Nombre base del archivo; por defecto el título del documento. */
  fileName?: string;
}
