import { getStitchMarkPng } from './emailBrandAssets.js';
const BRAND = {
    primary: '#1a5fb4',
    markChipBg: '#2e76cc',
    wordmarkSuffix: '#4a7ab8',
};
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
export function getStitchMarkBase64() {
    const buf = getStitchMarkPng();
    if (!buf)
        return null;
    return `data:image/png;base64,${buf.toString('base64')}`;
}
export function getOfferLetterLogoHtml(legalEntityName) {
    const src = getStitchMarkBase64();
    const markImg = src
        ? `<img src="${src}" alt="" width="32" height="32" style="display:block;border:0;width:32px;height:32px;" />`
        : '';
    const subtitle = legalEntityName
        ? `<div style="font-size:11px;color:#64748b;margin-top:4px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(legalEntityName)}</div>`
        : '';
    return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:24px;">
    <tr>
      <td style="vertical-align:middle;padding-right:12px;">
        <table cellpadding="0" cellspacing="0" border="0" role="presentation">
          <tr>
            <td width="48" height="48" align="center" valign="middle" style="background-color:${BRAND.markChipBg};border-radius:12px;">
              ${markImg}
            </td>
          </tr>
        </table>
      </td>
      <td style="vertical-align:middle;">
        <span style="font-size:22px;font-weight:800;color:${BRAND.primary};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:-0.02em;">Stitch</span><span style="font-size:16px;font-weight:600;color:${BRAND.wordmarkSuffix};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin-left:6px;">ATS</span>
        ${subtitle}
      </td>
    </tr>
  </table>`;
}
