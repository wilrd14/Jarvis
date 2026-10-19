// Genera electron/icon.png (512x512) con un orbe holografico simple. Uso: node electron/make-icon.cjs
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><radialGradient id="g" cx="50%" cy="45%" r="55%">
<stop offset="0" stop-color="#b8fff0"/><stop offset="0.35" stop-color="#19e6c1"/><stop offset="1" stop-color="#05302b"/></radialGradient></defs>
<rect width="512" height="512" rx="96" fill="#05080a"/>
<circle cx="256" cy="256" r="150" fill="url(#g)"/>
<ellipse cx="256" cy="256" rx="200" ry="60" fill="none" stroke="#19e6c1" stroke-width="8" opacity="0.8" transform="rotate(-20 256 256)"/>
<circle cx="256" cy="256" r="215" fill="none" stroke="#19e6c1" stroke-width="4" opacity="0.4"/>
</svg>`;
const out = __dirname;
fs.mkdirSync(out, { recursive: true });
sharp(Buffer.from(svg))
  .png()
  .toFile(path.join(out, "icon.png"))
  .then(() => console.log("ok"));
