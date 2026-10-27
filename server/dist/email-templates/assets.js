import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDED_IGS_LOGO_ON_DARK_PNG, EMBEDDED_IGS_LOGO_PNG, EMBEDDED_STITCH_MARK_PNG } from './logos.generated.js';
import { fixedShape } from './outlook.js';
import { C, FONT, TABLE } from './tokens.js';
/** Inline (CID) images referenced by email HTML; attached by sendHtmlEmail. */
export const STITCH_MARK_CID = 'stitch-mark';
export const IGS_LOGO_ON_DARK_CID = 'igs-logo.png';
export const IGS_LOGO_CID = 'igs-logo-light.png';
const moduleDir = dirname(fileURLToPath(import.meta.url));
function resolveAsset(filename) {
    const candidates = [
        join(process.cwd(), 'assets', filename),
        join(process.cwd(), '../assets', filename),
        join(moduleDir, '../assets', filename),
        join(moduleDir, '../../assets', filename),
    ];
    return candidates.find((path) => existsSync(path)) ?? null;
}
const cache = new Map();
function loadPng(filename, fallback) {
    const hit = cache.get(filename);
    if (hit)
        return hit;
    const path = resolveAsset(filename);
    const content = path ? readFileSync(path) : fallback;
    cache.set(filename, content);
    return content;
}
/** 32×32 white Stitch mark on transparent. Also used by offer letters. */
export function getStitchMarkPng() {
    return loadPng('stitch-mark.png', EMBEDDED_STITCH_MARK_PNG);
}
const INLINE_IMAGES = [
    { cid: STITCH_MARK_CID, load: getStitchMarkPng },
    { cid: IGS_LOGO_ON_DARK_CID, load: () => loadPng('igs-logo-on-dark.png', EMBEDDED_IGS_LOGO_ON_DARK_PNG) },
    { cid: IGS_LOGO_CID, load: () => loadPng('igs-logo.png', EMBEDDED_IGS_LOGO_PNG) },
];
/** CID attachments for every brand image the HTML references. */
export function getEmailBrandInlineAttachments(html) {
    return INLINE_IMAGES.filter((image) => html.includes(`cid:${image.cid}`)).map((image) => ({
        cid: image.cid,
        filename: image.cid.endsWith('.png') ? image.cid : `${image.cid}.png`,
        contentType: 'image/png',
        content: image.load(),
    }));
}
/** Swap CID references for data URIs so HTML renders in a browser (previews). */
export function inlineBrandImagesAsDataUris(html) {
    return INLINE_IMAGES.reduce((out, image) => out.split(`cid:${image.cid}`).join(`data:image/png;base64,${image.load().toString('base64')}`), html);
}
/** Stitch mark + wordmark + IGS, matching the staff sidebar lockup. */
export function brandLockupHtml(accent, options) {
    const { onDark } = options;
    const scale = options.scale ?? 1;
    const chip = onDark ? accent.chip : accent.primary;
    const word = onDark ? '#FFFFFF' : C.onSurface;
    const suffix = onDark ? accent.soft : accent.primary;
    const sub = onDark ? accent.soft : C.onSurfaceVariant;
    const rule = onDark ? accent.rule : C.outlineVariant;
    const igsCid = onDark ? IGS_LOGO_ON_DARK_CID : IGS_LOGO_CID;
    const box = Math.round(40 * scale);
    const mark = Math.round(24 * scale);
    const igsH = Math.round(38 * scale);
    const igsW = Math.round((igsH * 158) / 98);
    const radius = Math.round(11 * scale);
    const markImg = `<img src="cid:${STITCH_MARK_CID}" width="${mark}" height="${mark}" alt="" style="display:block;border:0;outline:none;width:${mark}px;height:${mark}px;" />`;
    return `<table ${TABLE}><tr>
    <td valign="middle" style="padding-right:10px;">
      ${fixedShape({ width: box, height: box, radius, fill: chip, html: markImg }, `<table ${TABLE}><tr><td width="${box}" height="${box}" align="center" valign="middle" bgcolor="${chip}" style="width:${box}px;height:${box}px;background-color:${chip};border-radius:${radius}px;">${markImg}</td></tr></table>`)}
    </td>
    <td valign="middle" style="padding-right:14px;font-family:${FONT};">
      <div style="font-size:${Math.round(20 * scale)}px;line-height:1;font-weight:800;color:${word};letter-spacing:-0.02em;white-space:nowrap;"><font color="${word}">Stitch</font><span style="font-size:${Math.round(15 * scale)}px;font-weight:600;color:${suffix};letter-spacing:0.02em;"><font color="${suffix}">&nbsp;ATS</font></span></div>
      <div style="margin-top:4px;font-size:11px;line-height:1.2;font-weight:500;color:${sub};white-space:nowrap;"><font color="${sub}">Creating Impact</font></div>
    </td>
    <td valign="middle" style="padding-right:14px;"><div style="width:1px;height:${Math.round(30 * scale)}px;background-color:${rule};font-size:0;line-height:0;">&nbsp;</div></td>
    <td valign="middle"><img src="cid:${igsCid}" width="${igsW}" height="${igsH}" alt="IGS" style="display:block;border:0;outline:none;width:${igsW}px;height:${igsH}px;" /></td>
  </tr></table>`;
}
