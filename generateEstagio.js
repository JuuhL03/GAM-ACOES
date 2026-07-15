const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const fontDir     = path.join(__dirname, 'fonts');
const fontRegular = path.join(fontDir, 'Roboto-Regular.ttf');
const fontBold    = path.join(fontDir, 'Roboto-Bold.woff2');

let fontsLoaded = false;
async function ensureFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  if (fs.existsSync(fontRegular)) GlobalFonts.registerFromPath(fontRegular, 'Roboto');
  if (fs.existsSync(fontBold))    GlobalFonts.registerFromPath(fontBold, 'Roboto Bold');
}

const F   = 'Roboto, Arial, sans-serif';
const F_B = 'Roboto Bold, Roboto, Arial, sans-serif';

// Paleta dark mode — monocromática (preto/cinza), sem cores por critério;
// só o medidor de segmentos marca o nível.
const C = {
  page:      '#0b0b0c',
  card:      '#18191c',
  border:    '#2b2c30',
  divider:   '#28292d',
  white:     '#f2f2f0',
  gray:      '#8b8c90',
  grayLight: '#55565b',
  segOn:     '#f2f2f0',
  segOff:    '#333438',
  obsBg:     '#111214',
};

const CONCEITOS = [
  { label: 'Ótimo',   peso: 4 },
  { label: 'Bom',     peso: 3 },
  { label: 'Regular', peso: 2 },
  { label: 'Ruim',    peso: 1 },
];

function conceitoInfo(label) {
  return CONCEITOS.find(c => c.label === label) ?? CONCEITOS[2];
}

function conceitoMaisProximo(peso) {
  let melhor = CONCEITOS[2];
  let menorDist = Infinity;
  for (const c of CONCEITOS) {
    const d = Math.abs(c.peso - peso);
    if (d < menorDist) { menorDist = d; melhor = c; }
  }
  return melhor;
}

const SCALE  = 2;
const W_CSS  = 720;
const W      = W_CSS * SCALE;
const CARD_M = 24 * SCALE;
const PAD    = 32 * SCALE;
const CARD_W = W - CARD_M * 2;
const INNER  = CARD_W - PAD * 2;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  if (!text || !text.trim()) return ['—'];
  const lines = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { lines.push(''); continue; }
    const words = para.split(' ');
    let cur = '';
    for (const word of words) {
      const test = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        cur = word;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines.length ? lines : ['—'];
}

async function carregarAvatar(url) {
  try {
    const resp = await fetch(url);
    const buf  = Buffer.from(await resp.arrayBuffer());
    return await loadImage(buf);
  } catch (e) {
    console.warn('⚠️  Falha ao carregar avatar:', e.message);
    return null;
  }
}

const S = {
  header:    76 * SCALE,
  divider:   1  * SCALE,
  metaRow:   58 * SCALE,
  rowH:      52 * SCALE,
  obsPad:    16 * SCALE,
  obsGapTop: 20 * SCALE,
  footer:    40 * SCALE,
};

/**
 * dados = {
 *   nome: string,
 *   avatarUrl: string | null,
 *   avaliadorNome: string,
 *   data: string,
 *   criterios: [{ label, conceito }],
 *   observacao: string,  // opcional
 * }
 */
async function generateEstagio(dados) {
  await ensureFonts();

  const tmp = createCanvas(10, 10);
  const tctx = tmp.getContext('2d');
  tctx.font = `${13 * SCALE}px ${F}`;
  const obsMaxWidth = INNER - S.obsPad * 2;
  const obsLines = wrapText(tctx, dados.observacao, obsMaxWidth);
  const obsLineH = 19 * SCALE;
  const obsLabelH = 10 * SCALE + 11 * SCALE;
  const obsBoxH   = 10 * SCALE + obsLines.length * obsLineH + S.obsPad;
  const obsBlockH = S.obsGapTop + obsLabelH + obsBoxH + S.obsPad;

  const cardH = S.header + S.divider + S.metaRow + S.divider
    + dados.criterios.length * S.rowH + S.divider
    + obsBlockH + S.divider + S.footer;
  const totalH = cardH + CARD_M * 2;

  const canvas = createCanvas(W, totalH);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = C.page;
  ctx.fillRect(0, 0, W, totalH);

  const cardX = CARD_M, cardY = CARD_M;
  ctx.fillStyle = C.card;
  roundRect(ctx, cardX, cardY, CARD_W, cardH, 14 * SCALE);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1 * SCALE;
  roundRect(ctx, cardX, cardY, CARD_W, cardH, 14 * SCALE);
  ctx.stroke();

  let y = cardY;
  const x0 = cardX + PAD;
  const xEnd = cardX + CARD_W - PAD;

  // ── Header ──
  ctx.fillStyle = C.gray;
  ctx.font = `${10 * SCALE}px ${F_B}`;
  ctx.fillText('ESTÁGIO OPERACIONAL', x0, y + 26 * SCALE);

  ctx.fillStyle = C.white;
  ctx.font = `${24 * SCALE}px ${F_B}`;
  ctx.fillText('Ficha de Avaliação', x0, y + 56 * SCALE);

  // Avatar circular, canto direito do header
  let avatarW_px = 0;
  if (dados.avatarUrl) {
    const avatar = await carregarAvatar(dados.avatarUrl);
    if (avatar) {
      const ah = 44 * SCALE;
      avatarW_px = ah;
      const ax = xEnd - ah;
      const ay = y + (S.header - ah) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(ax + ah / 2, ay + ah / 2, ah / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatar, ax, ay, ah, ah);
      ctx.restore();
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 1.5 * SCALE;
      ctx.beginPath();
      ctx.arc(ax + ah / 2, ay + ah / 2, ah / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const pesoMedio = dados.criterios.reduce((s, c) => s + conceitoInfo(c.conceito).peso, 0) / dados.criterios.length;
  const geral = conceitoMaisProximo(pesoMedio);
  const geralX = xEnd - avatarW_px - (avatarW_px > 0 ? 20 * SCALE : 0);

  ctx.textAlign = 'right';
  ctx.fillStyle = C.gray;
  ctx.font = `${10 * SCALE}px ${F_B}`;
  ctx.fillText('GERAL', geralX, y + 26 * SCALE);

  ctx.fillStyle = C.white;
  ctx.font = `${22 * SCALE}px ${F_B}`;
  ctx.fillText(geral.label, geralX, y + 54 * SCALE);
  ctx.textAlign = 'left';

  y += S.header;

  ctx.fillStyle = C.divider;
  ctx.fillRect(cardX, y, CARD_W, S.divider);
  y += S.divider;

  // ── Meta row ──
  const metaCols = [
    { label: 'ESTAGIÁRIO', valor: dados.nome },
    { label: 'DATA',       valor: dados.data },
  ];
  const colW = INNER / 2;
  metaCols.forEach((m, i) => {
    const mx = x0 + i * colW;
    ctx.fillStyle = C.gray;
    ctx.font = `${9.5 * SCALE}px ${F_B}`;
    ctx.fillText(m.label, mx, y + 22 * SCALE);

    ctx.fillStyle = C.white;
    ctx.font = `${14 * SCALE}px ${F}`;
    ctx.fillText(m.valor || '—', mx, y + 42 * SCALE);
  });
  y += S.metaRow;

  ctx.fillStyle = C.divider;
  ctx.fillRect(cardX, y, CARD_W, S.divider);
  y += S.divider;

  // ── Critérios ──
  const segCount = 4;
  const segW     = 20 * SCALE;
  const segH     = 6  * SCALE;
  const segGap   = 5  * SCALE;
  const meterW   = segCount * segW + (segCount - 1) * segGap;
  const labelColColW = 90 * SCALE;

  dados.criterios.forEach((crit, idx) => {
    const info = conceitoInfo(crit.conceito);

    ctx.fillStyle = C.white;
    ctx.font = `${14 * SCALE}px ${F}`;
    ctx.fillText(crit.label, x0, y + S.rowH / 2 + 5 * SCALE);

    const meterX = xEnd - labelColColW - meterW - 14 * SCALE;
    const meterY = y + S.rowH / 2 - segH / 2;
    for (let i = 0; i < segCount; i++) {
      ctx.fillStyle = i < info.peso ? C.segOn : C.segOff;
      roundRect(ctx, meterX + i * (segW + segGap), meterY, segW, segH, segH / 2);
      ctx.fill();
    }

    ctx.fillStyle = C.white;
    ctx.font = `${14 * SCALE}px ${F_B}`;
    ctx.textAlign = 'right';
    ctx.fillText(info.label, xEnd, y + S.rowH / 2 + 5 * SCALE);
    ctx.textAlign = 'left';

    y += S.rowH;

    if (idx < dados.criterios.length - 1) {
      ctx.fillStyle = C.divider;
      ctx.fillRect(x0, y, INNER, 1 * SCALE);
    }
  });

  ctx.fillStyle = C.divider;
  ctx.fillRect(cardX, y, CARD_W, S.divider);
  y += S.divider;

  // ── Observações ──
  y += S.obsGapTop;
  ctx.fillStyle = C.gray;
  ctx.font = `${9.5 * SCALE}px ${F_B}`;
  ctx.fillText('OBSERVAÇÕES', x0, y + 10 * SCALE);
  y += obsLabelH;

  ctx.fillStyle = C.obsBg;
  roundRect(ctx, x0, y, INNER, obsBoxH, 8 * SCALE);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1 * SCALE;
  roundRect(ctx, x0, y, INNER, obsBoxH, 8 * SCALE);
  ctx.stroke();

  ctx.fillStyle = C.white;
  ctx.font = `${13 * SCALE}px ${F}`;
  const obsTextX = x0 + S.obsPad;
  let obsY = y + S.obsPad + 4 * SCALE;
  obsLines.forEach(line => {
    ctx.fillText(line, obsTextX, obsY + 12 * SCALE);
    obsY += obsLineH;
  });
  y += obsBoxH + S.obsPad;

  ctx.fillStyle = C.divider;
  ctx.fillRect(cardX, y, CARD_W, S.divider);
  y += S.divider;

  // ── Footer ──
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  ctx.fillStyle = C.grayLight;
  ctx.font = `${10.5 * SCALE}px ${F}`;
  ctx.fillText(`${agora} · GRUPAMENTO AEROMÓVEL`, x0, y + S.footer / 2 + 5 * SCALE);

  const outPath = path.join(os.tmpdir(), `ficha_estagio_${Date.now()}.png`);
  fs.writeFileSync(outPath, await canvas.encode('png'));
  return outPath;
}

module.exports = { generateEstagio };
