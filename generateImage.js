const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const fontDir = path.join(__dirname, 'fonts');
if (fs.existsSync(path.join(fontDir, 'Roboto-Regular.ttf'))) {
  GlobalFonts.registerFromPath(path.join(fontDir, 'Roboto-Regular.ttf'), 'Roboto');
  GlobalFonts.registerFromPath(path.join(fontDir, 'Roboto-Bold.ttf'),    'Roboto');
}
const F = 'Roboto, Arial, sans-serif';

const C = {
  bg:           '#0c0e14',
  headerBg:     '#0e1018',
  metaBg:       '#0e1018',
  secBg:        '#111420',
  divider:      '#1e2433',
  topbar1:      '#00b4d8',
  topbar2:      '#90e0ef',
  cyan:         '#00b4d8',
  white:        '#ffffff',
  text:         '#c8d0e0',
  textDim:      '#4a5568',
  textMuted:    '#2d3447',
  vitoria:      '#22c55e',
  vitoriaBg:    '#0d3d1f',
  vitoriaBord:  '#22c55e55',
  derrota:      '#ef4444',
  derrotaBg:    '#3d0d0d',
  derrotaBord:  '#ef444455',
  positivo:     '#22c55e',
  positivoBg:   '#0a1f10',
  negativo:     '#ef4444',
  negativoBg:   '#1a0808',
  neutro:       '#00b4d8',
  neutroBg:     '#071520',
};

// Resolução 2x para qualidade
const SCALE  = 2;
const W_CSS  = 860;
const W      = W_CSS * SCALE;
const PAD    = 32 * SCALE;
const INNER  = W - PAD * 2;
const LINE_H = 21 * SCALE;

function scale(ctx) {
  ctx.scale(SCALE, SCALE);
}

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
  function breakWord(word) {
    const parts = []; let chunk = '';
    for (const ch of word) {
      const t = chunk + ch;
      if (ctx.measureText(t).width > maxWidth && chunk) { parts.push(chunk); chunk = ch; }
      else chunk = t;
    }
    if (chunk) parts.push(chunk);
    return parts;
  }
  for (const para of text.split('\n')) {
    if (!para.trim()) { lines.push(''); continue; }
    const words = para.split(' ');
    let cur = '';
    for (const word of words) {
      if (ctx.measureText(word).width > maxWidth) {
        if (cur) { lines.push(cur); cur = ''; }
        const parts = breakWord(word);
        for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i]);
        cur = parts[parts.length - 1];
      } else {
        const test = cur ? `${cur} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = word; }
        else cur = test;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines.length ? lines : ['—'];
}

// Alturas em pixels no espaço escalado
const S = {
  topbar:    5  * SCALE,
  header:    88 * SCALE,
  divider:   1  * SCALE,
  metaRow:   62 * SCALE,
  secGap:    8  * SCALE,
  footer:    40 * SCALE,
};

function sectionH(lines) {
  const labelH = 11 * SCALE;
  const sepGap = 10 * SCALE;
  const sepH   = 1  * SCALE;
  const textGap= 10 * SCALE;
  const padV   = 14 * SCALE;
  return padV + labelH + sepGap + sepH + textGap + lines.length * LINE_H + padV;
}

function fieldStyle(label) {
  const l = label.toUpperCase();
  if (l.includes('NEGATIVO'))  return { bar: C.negativo, labelColor: C.negativo, bg: C.negativoBg };
  if (l.includes('POSITIVO'))  return { bar: C.positivo, labelColor: C.positivo, bg: C.positivoBg };
  return { bar: C.cyan, labelColor: C.cyan, bg: C.neutroBg };
}

async function generateReportImage(dados) {
  const campos = [
    { label: 'Spots',            valor: dados.spots },
    { label: 'Calls',            valor: dados.calls },
    { label: 'Ângulos',          valor: dados.angulos },
    { label: 'Comportamento',    valor: dados.comportamento },
    { label: 'Pontos Positivos', valor: dados.melhorias },
    { label: 'Pontos Negativos', valor: dados.negativos },
  ].filter(c => c.valor && c.valor.trim());

  // Pré-calcular wraps no espaço escalado
  const tmp = createCanvas(W, 100);
  const tc  = tmp.getContext('2d');
  tc.font   = `${14 * SCALE}px ${F}`;
  const textW = INNER - 28 * SCALE;

  const secoes = campos.map(c => {
    const lines = wrapText(tc, c.valor, textW);
    return { ...c, lines, h: sectionH(lines), ...fieldStyle(c.label) };
  });

  // Altura total
  let totalH = S.topbar + S.header + S.divider + S.metaRow + S.divider;
  totalH += S.secGap;
  for (const s of secoes) totalH += s.h + S.secGap;
  if (!secoes.length) totalH += 50 * SCALE;
  totalH += S.divider + S.footer;

  const canvas = createCanvas(W, totalH);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, totalH);

  let y = 0;

  // Topbar
  const topGrad = ctx.createLinearGradient(0, 0, W, 0);
  topGrad.addColorStop(0, C.topbar1);
  topGrad.addColorStop(0.5, C.topbar2);
  topGrad.addColorStop(1, C.topbar1);
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, y, W, S.topbar);
  y += S.topbar;

  // Header
  ctx.fillStyle = C.headerBg;
  ctx.fillRect(0, y, W, S.header);

  // Logo no header (canto direito)
  let logoW_px = 0;
  let logo = null;
  const logoPath = path.join(__dirname, 'logo.png');
  if (fs.existsSync(logoPath)) {
    try {
      logo = await loadImage(logoPath);
      const lh = 56 * SCALE;
      logoW_px  = (logo.width / logo.height) * lh;
      ctx.drawImage(logo, W - PAD - logoW_px, y + (S.header - lh) / 2, logoW_px, lh);
    } catch (_) {}
  }

  // Título
  ctx.fillStyle = C.white;
  ctx.font = `bold ${22 * SCALE}px ${F}`;
  ctx.fillText('RELATÓRIO DE AÇÃO', PAD, y + 36 * SCALE);

  ctx.fillStyle = C.textDim;
  ctx.font = `${12 * SCALE}px ${F}`;
  ctx.fillText(`Emitido por ${dados.autor}  ·  Sistema de Análise Tática GAM`, PAD, y + 58 * SCALE);

  // Badge resultado
  const isVit = dados.resultado === 'Vitória';
  const bColor = isVit ? C.vitoria : C.derrota;
  const bBg    = isVit ? C.vitoriaBg : C.derrotaBg;
  const bBord  = isVit ? C.vitoriaBord : C.derrotaBord;
  const bText  = (dados.resultado ?? '—').toUpperCase();
  ctx.font = `bold ${12 * SCALE}px ${F}`;
  const bw = ctx.measureText(bText).width + 26 * SCALE;
  const bh = 28 * SCALE;
  const bx = W - PAD - logoW_px - (logoW_px > 0 ? 16 * SCALE : 0) - bw;
  const by = y + (S.header - bh) / 2;
  ctx.fillStyle = bBg;
  roundRect(ctx, bx, by, bw, bh, 5 * SCALE);
  ctx.fill();
  ctx.strokeStyle = bBord;
  ctx.lineWidth = 1 * SCALE;
  roundRect(ctx, bx, by, bw, bh, 5 * SCALE);
  ctx.stroke();
  ctx.fillStyle = bColor;
  ctx.fillText(bText, bx + 13 * SCALE, by + bh / 2 + 5 * SCALE);
  y += S.header;

  // Divider
  ctx.fillStyle = C.divider;
  ctx.fillRect(0, y, W, S.divider);
  y += S.divider;

  // Meta row — 4 colunas: Data | Ação | Piloto | Analista
  ctx.fillStyle = C.metaBg;
  ctx.fillRect(0, y, W, S.metaRow);

  const metaCols = [
    { label: 'DATA',     valor: dados.data        },
    { label: 'AÇÃO',     valor: dados.acao         },
    { label: 'PILOTO',   valor: dados.pilotoNome   },
    { label: 'ANALISTA', valor: dados.autor        },
  ];
  const colW = INNER / metaCols.length;

  metaCols.forEach((m, i) => {
    const gap = 14 * SCALE;
    const mx  = PAD + i * colW + (i > 0 ? gap : 0);
    if (i > 0) {
      ctx.fillStyle = C.divider;
      ctx.fillRect(PAD + i * colW - 1, y + 10 * SCALE, 1, S.metaRow - 20 * SCALE);
    }
    ctx.fillStyle = C.textMuted;
    ctx.font = `bold ${9 * SCALE}px ${F}`;
    ctx.fillText(m.label, mx, y + 22 * SCALE);

    ctx.fillStyle = C.white;
    ctx.font = `${13 * SCALE}px ${F}`;
    ctx.fillText(m.valor || '—', mx, y + 42 * SCALE);
  });

  y += S.metaRow;

  // Divider
  ctx.fillStyle = C.divider;
  ctx.fillRect(0, y, W, S.divider);
  y += S.divider + S.secGap;

  // Seções
  if (!secoes.length) {
    ctx.fillStyle = C.textDim;
    ctx.font = `${13 * SCALE}px ${F}`;
    ctx.fillText('Nenhum ponto preenchido.', PAD, y + 30 * SCALE);
    y += 50 * SCALE;
  }

  for (const sec of secoes) {
    const ix = PAD + 16 * SCALE;
    ctx.fillStyle = sec.bg;
    roundRect(ctx, PAD, y, INNER, sec.h, 4 * SCALE);
    ctx.fill();

    // Barra lateral
    ctx.fillStyle = sec.bar;
    roundRect(ctx, PAD, y, 3 * SCALE, sec.h, 2 * SCALE);
    ctx.fill();

    const padV = 14 * SCALE;

    // Label
    ctx.fillStyle = sec.labelColor;
    ctx.font = `bold ${10 * SCALE}px ${F}`;
    ctx.fillText(sec.label.toUpperCase(), ix, y + padV + 11 * SCALE);

    // Separador
    const sepY = y + padV + 11 * SCALE + 10 * SCALE;
    ctx.strokeStyle = sec.bar + '33';
    ctx.lineWidth = 1 * SCALE;
    ctx.beginPath();
    ctx.moveTo(ix, sepY);
    ctx.lineTo(PAD + INNER - 14 * SCALE, sepY);
    ctx.stroke();

    // Texto
    ctx.fillStyle = C.text;
    ctx.font = `${14 * SCALE}px ${F}`;
    const textStartY = sepY + 10 * SCALE;
    sec.lines.forEach((l, li) => {
      ctx.fillText(l, ix, textStartY + li * LINE_H + LINE_H - 4 * SCALE);
    });

    y += sec.h + S.secGap;
  }

  // Footer
  ctx.fillStyle = C.divider;
  ctx.fillRect(0, y, W, S.divider);
  y += S.divider;

  ctx.fillStyle = C.headerBg;
  ctx.fillRect(0, y, W, S.footer);

  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  ctx.fillStyle = C.textMuted;
  ctx.font = `${11 * SCALE}px ${F}`;
  ctx.fillText(`Gerado em ${agora}`, PAD, y + 26 * SCALE);

  const outPath = path.join(os.tmpdir(), `relatorio_${Date.now()}.png`);
  fs.writeFileSync(outPath, await canvas.encode('png'));
  return outPath;
}

module.exports = { generateReportImage };
