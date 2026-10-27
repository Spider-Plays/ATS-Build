import { TABLE, escapeHtml as esc } from './tokens.js';
/**
 * Classic Outlook for Windows renders HTML with Word, which ignores border-radius.
 * These helpers draw the same rounded shapes with VML inside <!--[if mso]> comments,
 * while every other client keeps the CSS version. Content is always rendered once.
 *
 * Tall content never goes inside a single VML textbox (Outlook can cut it at page
 * breaks), so cards use a top-rounded header shape plus fixed bottom-corner pieces.
 */
export const ifMso = (html) => `<!--[if mso]>${html}<![endif]-->`;
export const notMso = (html) => `<!--[if !mso]><!-->${html}<!--<![endif]-->`;
const V = 'xmlns:v="urn:schemas-microsoft-com:vml"';
/** Outlook has no web fonts; VML text uses this. */
const MSO_FONT = `'Segoe UI',Arial,sans-serif`;
/** VML arcsize: corner radius as a percentage of the shape's shorter side. */
function arcsize(radius, width, height) {
    const pct = (radius / Math.max(1, Math.min(width, height))) * 100;
    return `${Math.min(50, Math.round(pct * 10) / 10)}%`;
}
/** Approximate label width in Outlook's fallback font — sizes VML pills and buttons. */
function labelWidth(text, fontSize, letterSpacingEm = 0) {
    return Math.ceil([...text].length * fontSize * (0.6 + letterSpacingEm));
}
/** Outlook ignores margins on most elements; spacer divs stand in for them. */
const msoGap = (h) => (h > 0 ? ifMso(`<div style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</div>`) : '');
const stroke = (color) => (color ? `strokecolor="${color}" strokeweight="1px"` : 'stroked="f"');
/** Rounded panel: a CSS div everywhere, a VML roundrect that grows with its content in Outlook. */
export function roundedBox(o) {
    const [t, r, b, l] = o.padding;
    const [mt, mb] = o.margin ?? [0, 0];
    const filled = o.fill !== 'none';
    const vml = `<v:roundrect ${V} arcsize="${arcsize(o.radius, o.width, o.estHeight)}" ${filled ? `fillcolor="${o.fill}"` : 'filled="f"'} ${stroke(o.stroke)} style="width:${o.width}px;">${o.dashed ? '<v:stroke dashstyle="dash" />' : ''}<v:textbox inset="${l}px,${t}px,${r}px,${b}px" style="mso-fit-shape-to-text:true;">`;
    const css = `${filled ? `background-color:${o.fill};` : ''}${o.stroke ? `border:1px ${o.dashed ? 'dashed' : 'solid'} ${o.stroke};` : ''}border-radius:${o.radius}px;padding:${t}px ${r}px ${b}px ${l}px;margin:${mt}px 0 ${mb}px;${o.css ?? ''}`;
    return `${msoGap(mt)}${ifMso(vml)}${notMso(`<div style="${css}">`)}${o.html}${notMso('</div>')}${ifMso('</v:textbox></v:roundrect>')}${msoGap(mb)}`;
}
/** Button / badge / chip: VML roundrect for Outlook, the given CSS markup for everyone else. */
export function pill(o, cssHtml) {
    const text = o.uppercase ? o.label.toUpperCase() : o.label;
    const width = labelWidth(text, o.fontSize, o.letterSpacingEm) + o.padX * 2;
    const radius = o.radius ?? o.height / 2;
    const spacing = o.letterSpacingEm ? `letter-spacing:${o.letterSpacingEm}em;` : '';
    const vml = `<v:roundrect ${V}${o.href ? ` href="${esc(o.href)}"` : ''} arcsize="${arcsize(radius, width, o.height)}" fillcolor="${o.fill}" ${stroke(o.stroke)} style="height:${o.height}px;v-text-anchor:middle;width:${width}px;">${o.dashed ? '<v:stroke dashstyle="dash" />' : ''}<w:anchorlock/><center style="color:${o.color};font-family:${o.fontFamily ?? MSO_FONT};font-size:${o.fontSize}px;font-weight:${o.fontWeight ?? 700};${spacing}">${esc(text)}</center></v:roundrect>`;
    return `${ifMso(vml)}${notMso(cssHtml)}`;
}
/** Fixed-size rounded shape (avatar, tile, number dot) with centred content. */
export function fixedShape(o, cssHtml) {
    const vml = `<v:roundrect ${V} arcsize="${arcsize(o.radius, o.width, o.height)}" fillcolor="${o.fill}" stroked="f" style="width:${o.width}px;height:${o.height}px;v-text-anchor:middle;"><w:anchorlock/><center style="font-family:${MSO_FONT};">${o.html ?? ''}</center></v:roundrect>`;
    return `${ifMso(vml)}${notMso(cssHtml)}`;
}
/** Card header with only its top corners rounded. Grows with its content in Outlook. */
export function topRoundedPanel(o) {
    const { width: w, radius: r } = o;
    const h = Math.max(o.estHeight, r * 2);
    const [t, right, b, l] = o.padding;
    const path = `m 0,${r} qy ${r},0 l ${w - r},0 qx ${w},${r} l ${w},${h} l 0,${h} x e`;
    const fill = o.gradientTo ? `<v:fill type="gradient" color="${o.fill}" color2="${o.gradientTo}" angle="135" />` : '';
    const vml = `<v:shape ${V} coordsize="${w},${h}" path="${path}" fillcolor="${o.fill}" stroked="f" style="width:${w}px;height:${h}px;">${fill}<v:textbox inset="${l}px,${t}px,${right}px,${b}px" style="mso-fit-shape-to-text:true;">`;
    return `${ifMso(vml)}${notMso(`<div${o.className ? ` class="${o.className}"` : ''} style="${o.css}">`)}${o.html}${notMso('</div>')}${ifMso('</v:textbox></v:shape>')}`;
}
/** Outlook-only table row that rounds the bottom corners of a card whose last row is `fill`. */
export function msoBottomCornersRow(o) {
    const r = o.radius;
    const corner = (path) => `<v:shape ${V} coordsize="${r},${r}" path="${path}" fillcolor="${o.fill}" stroked="f" style="width:${r}px;height:${r}px;"></v:shape>`;
    const cell = `width="${r}" height="${r}" valign="top" style="width:${r}px;height:${r}px;font-size:0;line-height:0;"`;
    return ifMso(`<tr><td style="font-size:0;line-height:0;"><table ${TABLE} width="${o.width}" style="width:${o.width}px;"><tr>
    <td ${cell}>${corner(`m 0,0 qy ${r},${r} l ${r},0 x e`)}</td>
    <td height="${r}" bgcolor="${o.fill}" style="height:${r}px;font-size:0;line-height:0;">&nbsp;</td>
    <td ${cell}>${corner(`m ${r},0 qy 0,${r} l 0,0 x e`)}</td>
  </tr></table></td></tr>`);
}
