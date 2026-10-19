// Genera scripts/desktop/jarvis.ico (PNG embebido de 256 px) a partir de electron/icon.png.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

(async () => {
  const png = await sharp(path.join(__dirname, "..", "..", "electron", "icon.png"))
    .resize(256, 256)
    .png()
    .toBuffer();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // tipo: icono
  header.writeUInt16LE(1, 4); // una imagen
  header[6] = 0; // ancho 256
  header[7] = 0; // alto 256
  header.writeUInt16LE(1, 10); // planos
  header.writeUInt16LE(32, 12); // bits por pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(__dirname, "jarvis.ico"), Buffer.concat([header, png]));
  console.log("jarvis.ico generado");
})();
