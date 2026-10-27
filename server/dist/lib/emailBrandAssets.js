import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDED_IGS_LOGO_ON_DARK_PNG } from '../email-templates/logos.generated.js';
export const STITCH_MARK_CID = 'stitch-mark';
export const IGS_LOGO_CID = 'igs-logo';
/** 32×32 white mark on transparent, baked in so Docker/dist never miss the file. */
const EMBEDDED_STITCH_MARK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAACT0lEQVR4nO2XTUhVQRTHryX2AQVGkRhEQYt05yJsEy101yLIRRESBH0QBIHiTtA+FmFQUEhftGghahQIGZZGtJHSUlJQwY36JKKgoiAJS38ycG6cDvPIsXmu/MPA456Z+f/unDsz5yXJiiIJyAe2A9uAvOUyzQMqgFZgHJiSNghcADbFMtoPNAN9wFsxrAFalKmvOZBd/2O8FnhAds0Bn/8B0QsULMV8owxejL4CF4GDwBGg00AcDjUvAT4ak1ngKTAE/PZAXFLj10mqUoCmUIDnHoPXwBZgFMgAX4B5k44KNcddBXA7FOC7B+AbUGuWtslAOLh8maMMeCWtLBRg0AMwAPQr82eyDW+YftVBZj4BlcBPNan7fcq8/THpWyjpSNWbxBBQCjRIcx/lcQNQrPpeVQDzOhZNwGVl/sbE9kZPgxVwRwF0mNhq4IcCuJLEFnBfAbR74u8UQFsuAJoVQJcn/lIBdOUCoF4BjLllN3F3UaV6mAuAKrML/jpczNF9MxcARcCkAqhXsR1mF5yVbdworTQWRIcCGHY3pjw/ZwDOeA6yyhgAh0wa3NutAkaUWSbbUR5qVq6MylXd90I9dym5Zowasl1moQCP1OA/Bw+wD5gQgPdyDadyxlvlBrTqDgW4pwZ/ANarWJ2Y/zImfTInZkzMjd8dCnDC5hA4CRwFbkmFhPnQ9PcxDXwCngAbgsydgDWy1IvRrBjagvT6kgrSVLKXbW1o5QqT02L2WKro88CeJIaAzTK5y2OqGaAHOLDc/4KKgJ1p3beiJIIWAPljvmIBR/8eAAAAAElFTkSuQmCC', 'base64');
const moduleDir = dirname(fileURLToPath(import.meta.url));
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function firstExisting(candidates) {
    return candidates.find((path) => existsSync(path)) ?? null;
}
function resolveAsset(filename) {
    return firstExisting([
        join(process.cwd(), 'assets', filename),
        join(process.cwd(), '../assets', filename),
        join(moduleDir, '../assets', filename),
        join(moduleDir, '../../assets', filename),
        join(process.cwd(), 'public', filename),
        join(process.cwd(), '../public', filename),
        join(moduleDir, '../../../public', filename),
    ]);
}
let cachedMark;
let cachedIgs;
export function getStitchMarkPng() {
    if (cachedMark)
        return cachedMark;
    const path = resolveAsset('stitch-mark.png');
    cachedMark = path ? readFileSync(path) : EMBEDDED_STITCH_MARK_PNG;
    return cachedMark;
}
export function getIgsLogoPng() {
    if (cachedIgs)
        return cachedIgs;
    const path = resolveAsset('igs-logo-on-dark.png') ?? resolveAsset('igs-logo.png');
    cachedIgs = path ? readFileSync(path) : EMBEDDED_IGS_LOGO_ON_DARK_PNG;
    return cachedIgs;
}
export function getStitchMarkInlineAttachment() {
    return {
        cid: STITCH_MARK_CID,
        filename: 'stitch-mark.png',
        contentType: 'image/png',
        content: getStitchMarkPng(),
    };
}
export function getIgsLogoInlineAttachment() {
    const content = getIgsLogoPng();
    if (!content)
        return null;
    return {
        cid: IGS_LOGO_CID,
        filename: 'igs-logo.png',
        contentType: 'image/png',
        content,
    };
}
export function getEmailBrandInlineAttachments(html) {
    const attachments = [];
    if (html.includes(`cid:${STITCH_MARK_CID}`))
        attachments.push(getStitchMarkInlineAttachment());
    if (html.includes(`cid:${IGS_LOGO_CID}`)) {
        const igs = getIgsLogoInlineAttachment();
        if (igs)
            attachments.push(igs);
    }
    return attachments;
}
/** Login-hero lockup for dark email headers: Stitch + Creating Impact + IGS. */
export function emailBrandLockupHtml(options) {
    const subtitle = (options?.subtitle ?? 'Creating Impact').trim();
    const subtitleHtml = subtitle
        ? `<div style="margin-top:4px;font-size:12px;font-weight:500;color:rgba(255,255,255,0.70);font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.2;">${escapeHtml(subtitle)}</div>`
        : '';
    return `<table cellpadding="0" cellspacing="0" border="0" role="presentation">
    <tr>
      <td valign="middle" style="padding-right:12px;">
        <table cellpadding="0" cellspacing="0" border="0" role="presentation">
          <tr>
            <td width="48" height="48" align="center" valign="middle" bgcolor="#2e76cc" style="background-color:#2e76cc;border-radius:12px;">
              <img src="cid:${STITCH_MARK_CID}" alt="" width="28" height="28" style="display:block;border:0;outline:none;width:28px;height:28px;" />
            </td>
          </tr>
        </table>
      </td>
      <td valign="middle" style="padding-right:12px;">
        <span style="font-size:24px;font-weight:800;color:#ffffff;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:-0.02em;line-height:1;">Stitch</span><span style="font-size:18px;font-weight:600;color:rgba(255,255,255,0.75);font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.02em;line-height:1;margin-left:6px;">ATS</span>
        ${subtitleHtml}
      </td>
      <td valign="middle" style="padding:0 12px;font-size:28px;font-weight:300;color:rgba(255,255,255,0.35);font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1;">|</td>
      <td valign="middle">
        <img src="cid:${IGS_LOGO_CID}" alt="IGS" width="77" height="48" style="display:block;border:0;outline:none;width:77px;height:48px;" />
      </td>
    </tr>
  </table>`;
}
