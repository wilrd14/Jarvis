// Genera el logo de Jarvis (SVG + PNG + ICO) con el tema holográfico.
// Uso: node scripts/branding/make-logo.cjs
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = path.join(__dirname, "..", "..");

// Arco de circunferencia (grados, 0 = arriba, sentido horario) como path SVG.
function arc(cx, cy, r, from, to) {
  const p = (deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)].map((n) => n.toFixed(2));
  };
  const [x1, y1] = p(from);
  const [x2, y2] = p(to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

const icon = (withBg = true) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs>
  <radialGradient id="bg" cx="50%" cy="46%" r="60%">
    <stop offset="0" stop-color="#0b2a23"/><stop offset="0.6" stop-color="#06100d"/><stop offset="1" stop-color="#030504"/>
  </radialGradient>
  <radialGradient id="core" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#2bffb8" stop-opacity="0.55"/><stop offset="0.6" stop-color="#14c4c4" stop-opacity="0.14"/><stop offset="1" stop-color="#14c4c4" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#2bffb8"/><stop offset="1" stop-color="#14c4c4"/>
  </linearGradient>
  <linearGradient id="j" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f2fff9"/><stop offset="1" stop-color="#8dffd9"/>
  </linearGradient>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
${withBg ? '<rect width="512" height="512" rx="112" fill="url(#bg)"/>' : ""}
<circle cx="256" cy="256" r="200" fill="url(#core)"/>
<!-- anillo exterior segmentado -->
<g fill="none" stroke="url(#ring)" stroke-linecap="round" filter="url(#soft)">
  <path d="${arc(256, 256, 218, 8, 100)}" stroke-width="10" opacity="0.9"/>
  <path d="${arc(256, 256, 218, 128, 232)}" stroke-width="10" opacity="0.55"/>
  <path d="${arc(256, 256, 218, 260, 352)}" stroke-width="10" opacity="0.9"/>
</g>
<!-- anillo medio, grueso, con apertura abajo -->
<path d="${arc(256, 256, 170, 38, 322)}" fill="none" stroke="url(#ring)" stroke-width="16" stroke-linecap="round" filter="url(#glow)"/>
<!-- marcas tipo HUD -->
<g stroke="#2bffb8" stroke-width="6" stroke-linecap="round" opacity="0.75">
  <line x1="256" y1="22" x2="256" y2="46"/><line x1="256" y1="466" x2="256" y2="490"/>
  <line x1="22" y1="256" x2="46" y2="256"/><line x1="466" y1="256" x2="490" y2="256"/>
</g>
<!-- J central -->
<path d="M 226 150 L 318 150 M 318 150 L 318 272 A 62 62 0 0 1 256 334 A 62 62 0 0 1 194 272" fill="none" stroke="url(#j)" stroke-width="44" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
</svg>`;

(async () => {
  const svg = icon(true);
  fs.writeFileSync(path.join(root, "public", "logo.svg"), svg);
  const render = (size, s = svg) =>
    sharp(Buffer.from(s), { density: (72 * size) / 512 * 2 }).resize(size, size).png().toBuffer();

  fs.writeFileSync(path.join(root, "public", "icon-512.png"), await render(512));
  fs.writeFileSync(path.join(root, "public", "icon-192.png"), await render(192));
  fs.writeFileSync(path.join(root, "electron", "icon.png"), await render(512));
  // Version "maskable": sin esquinas redondeadas, el sistema recorta.
  fs.writeFileSync(path.join(root, "public", "icon-maskable-512.png"), await render(512, icon(false).replace('<circle cx="256" cy="256" r="200"', '<rect width="512" height="512" fill="#030504"/><circle cx="256" cy="256" r="200"')));

  // ICO multitamano con PNG embebido.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map((s) => render(s)));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const o = 6 + 16 * i;
    head[o] = s === 256 ? 0 : s;
    head[o + 1] = s === 256 ? 0 : s;
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(pngs[i].length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += pngs[i].length;
  });
  const ico = Buffer.concat([head, ...pngs]);
  fs.writeFileSync(path.join(root, "scripts", "desktop", "jarvis.ico"), ico);
  fs.writeFileSync(path.join(root, "src", "app", "favicon.ico"), ico);
    { input: await render(128), left: 6, top: 6 }, { input: await render(48), left: 160, top: 46 }, { input: await render(16), left: 300, top: 62 } ]).png().toBuffer());
  console.log("logo generado");
})();
