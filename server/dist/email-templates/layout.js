import { brandLockupHtml } from './assets.js';
import { renderBlocks } from './blocks.js';
import { fixedShape, msoBottomCornersRow, notMso, pill, topRoundedPanel } from './outlook.js';
import { ACCENTS, C, FONT, FOOTER_REASON, SUPPORT_EMAIL, TABLE, escapeHtml as esc } from './tokens.js';
const spacer = (h) => `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>`;
function footerHtml(a, audience) {
    return `<p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.onSurfaceVariant};text-align:center;">
      <strong style="color:${C.onSurface};">Stitch ATS</strong> · Talent Acquisition, IGS<br/>
      Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:${a.primary};font-weight:600;text-decoration:none;">${SUPPORT_EMAIL}</a>
    </p>
    <p style="margin:8px 0 0;font-family:${FONT};font-size:11.5px;line-height:1.6;color:${C.outline};text-align:center;">${esc(FOOTER_REASON[audience])} This is an automated message.</p>`;
}
function documentHtml(spec, bodyBg, inner) {
    const preheader = spec.preheader
        ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(spec.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>`
        : '';
    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light" />
  <title>${esc(spec.title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&amp;family=JetBrains+Mono:wght@700&amp;display=swap" rel="stylesheet" />
  <style>
    :root { color-scheme: light only; }
    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
    a { text-decoration: none; }
    @media (max-width: 620px) {
      .wrap { padding: 16px 8px !important; }
      .px { padding-left: 22px !important; padding-right: 22px !important; }
      .h1 { font-size: 24px !important; }
      .stack { display: block !important; width: 100% !important; }
      .stack-pad { padding: 0 0 10px 0 !important; }
      .hide-sm { display: none !important; }
    }
  </style>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <style>
    /* Outlook can't load web fonts and would fall back to Times New Roman. */
    body, table, td, div, p, a, span, h1 { font-family: 'Segoe UI', Arial, sans-serif !important; }
    table { border-collapse: collapse; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${bodyBg};">
  ${preheader}
  ${inner}
</body>
</html>`;
}
const CARD_WIDTH = 600;
/** Portal: gradient hero in the audience colour, floating white card. For people outside IGS. */
function portalLayout(spec, a) {
    const r = 16;
    const style = { width: CARD_WIDTH - 80, panelRadius: 12, btnRadius: 10, details: 'panel', secondary: 'outline', buttonShadow: true };
    const bodyBg = '#EBF0F6';
    const eyebrow = pill({ label: spec.eyebrow, fill: a.chip, stroke: a.rule, color: a.soft, fontSize: 11, height: 26, padX: 12, uppercase: true, letterSpacingEm: 0.08 }, `<span style="display:inline-block;padding:5px 12px;border-radius:999px;background-color:${a.chip};border:1px solid ${a.rule};font-family:${FONT};font-size:11px;line-height:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${a.soft};"><font color="${a.soft}">${esc(spec.eyebrow)}</font></span>`);
    const hero = topRoundedPanel({
        width: CARD_WIDTH, radius: r, fill: a.heroFrom, gradientTo: a.heroTo, padding: [30, 40, 34, 40],
        estHeight: spec.subtitle ? 230 : 200, className: 'px',
        css: `background-color:${a.heroFrom};background-image:linear-gradient(135deg,${a.heroTo} 0%,${a.heroFrom} 100%);padding:30px 40px 34px;border-radius:${r}px ${r}px 0 0;`,
        html: `${brandLockupHtml(a, { onDark: true })}
        ${spacer(30)}
        ${eyebrow}
        <h1 class="h1" style="margin:14px 0 0;font-family:${FONT};font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:#FFFFFF;"><font color="#FFFFFF">${esc(spec.title)}</font></h1>
        ${spec.subtitle ? `<p style="margin:8px 0 0;font-family:${FONT};font-size:15px;line-height:1.5;color:${a.soft};"><font color="${a.soft}">${esc(spec.subtitle)}</font></p>` : ''}`,
    });
    const inner = `<table ${TABLE} width="100%" bgcolor="${bodyBg}" style="background-color:${bodyBg};"><tr><td class="wrap" align="center" style="padding:40px 16px;">
    <table ${TABLE} width="${CARD_WIDTH}" style="width:100%;max-width:${CARD_WIDTH}px;"><tr><td>
      ${notMso(`<div style="background-color:#FFFFFF;border-radius:${r}px;box-shadow:0 1px 2px rgba(16,24,40,0.06),0 18px 40px -18px rgba(11,53,107,0.30);">`)}
      <table ${TABLE} width="100%">
        <tr><td>${hero}</td></tr>
        <tr><td class="px" bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:34px 40px 34px;mso-padding-alt:34px 40px ${34 - r}px 40px;border-radius:0 0 ${r}px ${r}px;">
          ${renderBlocks(a, style, spec.blocks)}
        </td></tr>
        ${msoBottomCornersRow({ width: CARD_WIDTH, radius: r, fill: '#FFFFFF' })}
      </table>
      ${notMso('</div>')}
    </td></tr></table>
    <table ${TABLE} width="${CARD_WIDTH}" style="width:100%;max-width:${CARD_WIDTH}px;"><tr><td style="padding:24px 24px 0;">${footerHtml(a, spec.audience)}</td></tr></table>
  </td></tr></table>`;
    return documentHtml(spec, bodyBg, inner);
}
function tileHtml(a, tile) {
    const content = tile.top
        ? `<div style="font-size:9.5px;line-height:1;font-weight:800;letter-spacing:0.12em;color:${a.soft};">${esc(tile.top)}</div><div style="margin-top:5px;font-size:${tile.main.length > 3 ? 18 : 24}px;line-height:1;font-weight:800;letter-spacing:-0.02em;color:#FFFFFF;">${tile.main}</div>`
        : `<div style="font-size:28px;line-height:1;font-weight:800;color:#FFFFFF;">${tile.main}</div>`;
    return `<td valign="middle" width="64" style="width:64px;padding-right:18px;">
    ${fixedShape({ width: 64, height: 64, radius: 18, fill: a.primary, html: content }, `<table ${TABLE}><tr><td width="64" height="64" align="center" valign="middle" bgcolor="${a.primary}" style="width:64px;height:64px;background-color:${a.primary};border-radius:18px;font-family:${FONT};text-align:center;">${content}</td></tr></table>`)}
  </td>`;
}
/** Tonal: tinted header band with a data tile, soft list rows. For everyone inside IGS. */
function tonalLayout(spec, a) {
    const r = 24;
    const style = { width: CARD_WIDTH - 64, panelRadius: 14, btnRadius: 12, details: 'list', secondary: 'tonal' };
    const bodyBg = C.surfaceLow;
    const header = topRoundedPanel({
        width: CARD_WIDTH, radius: r, fill: a.container, padding: [24, 32, 28, 32], estHeight: 190, className: 'px',
        css: `background-color:${a.container};padding:24px 32px 28px;border-radius:${r - 1}px ${r - 1}px 0 0;`,
        html: `${brandLockupHtml(a, { onDark: false, scale: 0.8 })}
        ${spacer(26)}
        <table ${TABLE} width="100%"><tr>
          ${spec.tile ? tileHtml(a, spec.tile) : ''}
          <td valign="middle" style="font-family:${FONT};">
            <div style="font-size:12px;line-height:1.4;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${a.primary};">${esc(spec.eyebrow)}</div>
            <h1 class="h1" style="margin:4px 0 0;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-0.015em;color:${a.onContainer};">${esc(spec.title)}</h1>
            ${spec.subtitle ? `<div style="margin-top:4px;font-size:14px;line-height:1.45;color:${C.onSurfaceVariant};">${esc(spec.subtitle)}</div>` : ''}
          </td>
        </tr></table>`,
    });
    const inner = `<table ${TABLE} width="100%" bgcolor="${bodyBg}" style="background-color:${bodyBg};"><tr><td class="wrap" align="center" style="padding:40px 16px;">
    <table ${TABLE} width="${CARD_WIDTH}" style="width:100%;max-width:${CARD_WIDTH}px;"><tr><td>
      ${notMso(`<div style="background-color:#FFFFFF;border:1px solid ${C.hairline};border-radius:${r}px;">`)}
      <table ${TABLE} width="100%">
        <tr><td>${header}</td></tr>
        <tr><td class="px" bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:30px 32px 30px;">
          ${renderBlocks(a, style, spec.blocks)}
        </td></tr>
        <tr><td class="px" bgcolor="${C.surface}" style="background-color:${C.surface};padding:20px 32px 22px;mso-padding-alt:20px 32px ${22 - r < 0 ? 0 : 22 - r}px 32px;border-top:1px solid ${C.hairline};border-radius:0 0 ${r - 1}px ${r - 1}px;">
          ${footerHtml(a, spec.audience)}
        </td></tr>
        ${msoBottomCornersRow({ width: CARD_WIDTH, radius: r, fill: C.surface })}
      </table>
      ${notMso('</div>')}
    </td></tr></table>
  </td></tr></table>`;
    return documentHtml(spec, bodyBg, inner);
}
export function renderEmail(spec) {
    const accent = ACCENTS[spec.audience];
    return spec.audience === 'staff' ? tonalLayout(spec, accent) : portalLayout(spec, accent);
}
