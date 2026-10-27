import { fixedShape, ifMso, pill, roundedBox } from './outlook.js';
import { C, FONT, MONO, TABLE, escapeHtml as esc } from './tokens.js';
function tone(a, name) {
    switch (name) {
        case 'success': return { bg: C.successContainer, fg: C.onSuccessContainer, bar: C.success };
        case 'warning': return { bg: C.warningContainer, fg: C.onWarningContainer, bar: C.warning };
        case 'error': return { bg: C.errorContainer, fg: C.onErrorContainer, bar: C.error };
        case 'neutral': return { bg: C.surfaceContainer, fg: C.onSurfaceVariant, bar: C.outline };
        default: return { bg: a.container, fg: a.onContainer, bar: a.primary };
    }
}
function badge(a, toneName, label) {
    const t = tone(a, toneName);
    return pill({ label, fill: t.bg, color: t.fg, fontSize: 12, height: 24, padX: 10 }, `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:${t.bg};color:${t.fg};font-family:${FONT};font-size:12px;font-weight:700;line-height:16px;white-space:nowrap;">${esc(label)}</span>`);
}
function button(a, s, item) {
    const secondary = item.variant === 'secondary';
    const tonal = secondary && s.secondary === 'tonal';
    const bg = !secondary ? a.primary : tonal ? a.container : C.white;
    const fg = !secondary ? '#FFFFFF' : tonal ? a.onContainer : a.primary;
    const border = !secondary ? a.primary : tonal ? a.container : C.outlineVariant;
    const shadow = !secondary && s.buttonShadow ? `box-shadow:0 1px 2px rgba(16,24,40,0.12),0 6px 16px -6px ${a.primary}99;` : '';
    return pill({ label: item.label, href: item.href, fill: bg, color: fg, stroke: border, fontSize: 14, height: 46, padX: 22, radius: s.btnRadius }, `<table ${TABLE}><tr><td align="center" bgcolor="${bg}" style="background-color:${bg};border:1px solid ${border};border-radius:${s.btnRadius}px;${shadow}">
    <a href="${esc(item.href)}" target="_blank" style="display:inline-block;padding:13px 22px;font-family:${FONT};font-size:14px;font-weight:700;line-height:18px;color:${fg};text-decoration:none;border-radius:${s.btnRadius}px;white-space:nowrap;"><font color="${fg}">${esc(item.label)}</font></a>
  </td></tr></table>`);
}
/** Small filled circle or rounded square with optional centred text. */
function dot(size, fill, color = '#FFFFFF', fontSize = 12, text = '') {
    return fixedShape({
        width: size, height: size, radius: size / 2, fill,
        html: text ? `<span style="font-size:${fontSize}px;font-weight:800;color:${color};">${esc(text)}</span>` : '',
    }, `<table ${TABLE}><tr><td width="${size}" height="${size}" align="center" valign="middle" bgcolor="${fill}" style="width:${size}px;height:${size}px;border-radius:999px;background-color:${fill};font-family:${FONT};font-size:${text ? fontSize : 0}px;line-height:${size}px;font-weight:800;color:${color};">${text ? esc(text) : '&nbsp;'}</td></tr></table>`);
}
const label11 = `font-size:11px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.outline};`;
/** Outlined panel on the white card. */
function panel(s, html, padding, margin, estHeight) {
    return roundedBox({ html, width: s.width, radius: s.panelRadius, fill: 'none', stroke: C.hairline, padding, margin, estHeight });
}
const renderers = {
    greeting: (a, s, b) => `<p style="margin:0 0 12px;font-family:${FONT};font-size:16px;line-height:1.5;font-weight:600;color:${C.onSurface};">Hi ${esc(b.name)},</p>`,
    p: (a, s, b) => `<p style="margin:0 0 18px;font-family:${FONT};font-size:15px;line-height:1.65;color:${C.onSurfaceVariant};">${b.html.replace(/<strong>/g, `<strong style="color:${C.onSurface};font-weight:700;">`)}</p>`,
    note: (a, s, b) => `<p style="margin:24px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.outline};">${b.html}</p>`,
    details: (a, s, b) => {
        if (b.rows.length === 0)
            return '';
        if (s.details === 'list') {
            return b.rows
                .map(([label, value], i) => roundedBox({
                width: s.width, radius: 12, fill: C.surfaceLow, padding: [13, 16, 13, 16], estHeight: 46,
                margin: [i === 0 ? 4 : 0, i === b.rows.length - 1 ? 24 : 6],
                html: `<table ${TABLE} width="100%"><tr>
              <td valign="top" style="font-family:${FONT};font-size:13px;line-height:1.5;color:${C.onSurfaceVariant};padding-right:12px;white-space:nowrap;">${esc(label)}</td>
              <td valign="top" align="right" style="font-family:${FONT};font-size:14px;line-height:1.5;font-weight:700;color:${C.onSurface};text-align:right;">${esc(value) || '—'}</td>
            </tr></table>`,
            }))
                .join('');
        }
        const rows = b.rows.map(([label, value], i) => {
            const top = i ? `border-top:1px solid ${C.hairline};` : '';
            return `<tr>
        <td valign="top" width="34%" style="width:34%;padding:12px 12px 12px 0;${top}font-family:${FONT};font-size:13px;line-height:1.5;color:${C.onSurfaceVariant};">${esc(label)}</td>
        <td valign="top" style="padding:12px 0;${top}font-family:${FONT};font-size:14px;line-height:1.5;font-weight:600;color:${C.onSurface};">${esc(value) || '—'}</td>
      </tr>`;
        });
        return roundedBox({
            width: s.width, radius: s.panelRadius, fill: C.surfaceLow, stroke: C.hairline, padding: [4, 20, 4, 20],
            margin: [4, 24], estHeight: b.rows.length * 46 + 8,
            html: `<table ${TABLE} width="100%">${rows.join('')}</table>`,
        });
    },
    actions: (a, s, b) => {
        const items = b.items.filter((item) => item.href && item.label);
        if (items.length === 0)
            return '';
        return `<table ${TABLE} style="margin:6px 0 8px;"><tr>${items
            .map((item) => `<td class="stack stack-pad" valign="middle" style="padding:0 10px 10px 0;">${button(a, s, item)}</td>`)
            .join('')}</tr></table>`;
    },
    callout: (a, s, b) => {
        const t = tone(a, b.tone);
        return roundedBox({
            width: s.width, radius: s.panelRadius, fill: t.bg, padding: [14, 18, 14, 18], margin: [14, 8],
            estHeight: b.title ? 76 : 56, css: `border-left:3px solid ${t.bar};`,
            html: `${b.title ? `<p style="margin:0 0 3px;font-family:${FONT};font-size:14px;line-height:1.45;font-weight:700;color:${t.fg};">${esc(b.title)}</p>` : ''}
        <p style="margin:0;font-family:${FONT};font-size:13.5px;line-height:1.55;color:${t.fg};">${b.html}</p>`,
        });
    },
    credentials: (a, s, b) => {
        const rows = b.rows.map((row, i) => `<tr><td style="padding:${i ? '16px' : '2px'} 0 2px;font-family:${FONT};">
        <div style="${label11}">${esc(row.label)}</div>
        ${row.secret
            ? `<div style="margin-top:6px;">${pill({ label: row.value, fill: C.white, color: a.primary, stroke: a.primary, dashed: true, fontSize: 17, height: 40, padX: 14, radius: 8, letterSpacingEm: 0.08, fontFamily: 'Consolas,monospace' }, `<span style="display:inline-block;padding:9px 14px;background-color:${C.white};border:1px dashed ${a.primary};border-radius:8px;font-family:${MONO};font-size:17px;font-weight:700;letter-spacing:0.08em;color:${a.primary};-webkit-user-select:all;user-select:all;">${esc(row.value)}</span>`)}</div>
             <div style="margin-top:6px;font-size:12px;line-height:1.5;color:${C.outline};">Click the password to select it, then copy with Ctrl+C (⌘C on Mac).</div>`
            : `<div style="margin-top:4px;font-size:15px;line-height:1.45;font-weight:600;color:${C.onSurface};">${esc(row.value)}</div>`}
      </td></tr>`);
        return roundedBox({
            width: s.width, radius: s.panelRadius, fill: C.surfaceLow, stroke: C.hairline, padding: [18, 20, 18, 20],
            margin: [4, 24], estHeight: b.rows.length * 70,
            html: `<table ${TABLE} width="100%">${rows.join('')}</table>`,
        });
    },
    stepper: (a, s, b) => {
        const width = Math.floor(100 / b.steps.length);
        const bars = b.steps.map((_, i) => {
            const color = i <= b.current ? a.primary : C.surfaceContainer;
            return `<td width="${width}%" style="padding:0 3px;"><div style="height:6px;line-height:6px;font-size:0;border-radius:3px;background-color:${color};">&nbsp;</div></td>`;
        });
        const labels = b.steps.map((step, i) => {
            const color = i === b.current ? a.primary : i < b.current ? C.onSurfaceVariant : C.outline;
            return `<td width="${width}%" align="center" style="padding:8px 2px 0;font-family:${FONT};font-size:11.5px;line-height:1.3;font-weight:${i === b.current ? 800 : 500};color:${color};">${esc(step)}</td>`;
        });
        return panel(s, `<p style="margin:0 0 12px 3px;font-family:${FONT};font-size:12px;line-height:1.4;font-weight:700;color:${C.onSurfaceVariant};">Stage ${b.current + 1} of ${b.steps.length} · <span style="color:${a.primary};">${esc(b.steps[b.current] ?? '')}</span></p>
      <table ${TABLE} width="100%"><tr>${bars.join('')}</tr><tr>${labels.join('')}</tr></table>`, [16, 15, 14, 15], [6, 22], 90);
    },
    rsvp: (a, s, b) => {
        const pills = b.options
            .filter((o) => o.href)
            .map((o) => {
            const t = tone(a, o.tone);
            return pill({ label: o.label, href: o.href, fill: t.bg, color: t.fg, fontSize: 13, height: 32, padX: 14 }, `<a href="${esc(o.href)}" target="_blank" style="display:inline-block;margin:0 6px 8px 0;padding:8px 14px;border-radius:999px;background-color:${t.bg};color:${t.fg};font-family:${FONT};font-size:13px;font-weight:700;line-height:16px;text-decoration:none;white-space:nowrap;"><font color="${t.fg}">${esc(o.label)}</font></a>`);
        });
        if (pills.length === 0)
            return '';
        return panel(s, `<p style="margin:0 0 12px;font-family:${FONT};font-size:14px;line-height:1.4;font-weight:700;color:${C.onSurface};">${esc(b.question)}</p>${pills.join(ifMso('&nbsp;&nbsp;'))}`, [16, 18, 10, 18], [12, 4], 90);
    },
    stats: (a, s, b) => {
        const tileWidth = Math.floor((s.width - 8 * (b.items.length - 1)) / b.items.length);
        return `<table ${TABLE} width="100%" style="margin:4px 0 16px;"><tr>${b.items
            .map((item, i) => {
            const color = item.tone ? tone(a, item.tone).bar : C.onSurface;
            return `<td width="${Math.floor(100 / b.items.length)}%" valign="top" style="padding:0 ${i < b.items.length - 1 ? 8 : 0}px 0 0;">${roundedBox({
                width: tileWidth, radius: s.panelRadius, fill: C.surfaceLow, padding: [14, 16, 14, 16], estHeight: 76,
                html: `<div style="font-family:${FONT};font-size:26px;line-height:1.1;font-weight:800;letter-spacing:-0.02em;color:${color};">${esc(item.value)}</div>
            <div style="margin-top:4px;font-family:${FONT};font-size:12px;line-height:1.35;color:${C.onSurfaceVariant};">${esc(item.label)}</div>`,
            })}</td>`;
        })
            .join('')}</tr></table>`;
    },
    highlight: (a, s, b) => roundedBox({
        width: s.width, radius: s.panelRadius + 4, fill: a.container, stroke: a.line, padding: [22, 24, 14, 24],
        margin: [4, 24], estHeight: 150, css: `background-image:linear-gradient(135deg,${a.container} 0%,#FFFFFF 100%);`,
        html: `<div style="font-family:${FONT};font-size:11px;line-height:1.4;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:${a.primary};">${esc(b.label)}</div>
        <div style="margin:6px 0 16px;font-family:${FONT};font-size:20px;line-height:1.3;font-weight:800;letter-spacing:-0.01em;color:${C.onSurface};">${esc(b.title)}</div>
        <table ${TABLE} width="100%"><tr>${b.facts
            .map(([label, value]) => `<td class="stack stack-pad" valign="top" width="${Math.floor(100 / Math.max(1, b.facts.length))}%" style="padding:0 12px 8px 0;font-family:${FONT};">
            <div style="font-size:12px;line-height:1.4;color:${C.onSurfaceVariant};">${esc(label)}</div>
            <div style="margin-top:2px;font-size:15px;line-height:1.4;font-weight:700;color:${C.onSurface};">${esc(value)}</div>
          </td>`)
            .join('')}</tr></table>`,
    }),
    person: (a, s, b) => panel(s, `<table ${TABLE}><tr>
        <td valign="top" style="padding-right:14px;">${dot(48, a.container, a.onContainer, 16, b.initials)}</td>
        <td valign="middle" style="font-family:${FONT};">
          <div style="font-size:16px;line-height:1.3;font-weight:800;color:${C.onSurface};">${esc(b.name)}</div>
          ${b.meta ? `<div style="margin:3px 0 8px;font-size:13px;line-height:1.4;color:${C.onSurfaceVariant};">${esc(b.meta)}</div>` : '<div style="height:8px;"></div>'}
          ${b.chips.map((c) => `<span style="display:inline-block;margin:0 4px 4px 0;">${badge(a, c.tone, c.label)}</span>`).join(ifMso('&nbsp;'))}
        </td>
      </tr></table>`, [16, 18, 16, 18], [4, 18], 90),
    changes: (a, s, b) => panel(s, `<table ${TABLE} width="100%">${b.rows
        .map(([label, from, to], i) => `<tr><td style="padding:12px 0;${i ? `border-top:1px solid ${C.hairline};` : ''}font-family:${FONT};">
          <div style="${label11}">${esc(label)}</div>
          <div style="margin-top:5px;font-size:14px;line-height:1.5;">
            ${from ? `<span style="color:${C.outline};text-decoration:line-through;">${esc(from)}</span><span style="color:${C.outline};padding:0 6px;">&rarr;</span>` : ''}
            ${pill({ label: to, fill: a.container, color: a.onContainer, fontSize: 14, height: 24, padX: 8, radius: 6 }, `<span style="display:inline-block;padding:2px 8px;border-radius:6px;background-color:${a.container};color:${a.onContainer};font-weight:700;">${esc(to)}</span>`)}
          </div>
        </td></tr>`)
        .join('')}</table>`, [6, 18, 6, 18], [4, 22], b.rows.length * 64),
    document: (a, s, b) => panel(s, `<div style="${label11}margin-bottom:10px;font-family:${FONT};">${esc(b.label)}</div>
      <div style="font-family:${FONT};font-size:14px;line-height:1.65;color:${C.onSurface};white-space:pre-wrap;">${esc(b.text)}</div>`, [18, 20, 18, 20], [4, 22], 240),
    steps: (a, s, b) => `<p style="margin:14px 0 10px;font-family:${FONT};font-size:14px;line-height:1.4;font-weight:700;color:${C.onSurface};">${esc(b.title)}</p>
    <table ${TABLE} width="100%" style="margin:0 0 8px;">${b.items
        .map((item, i) => `<tr>
        <td valign="top" width="30" style="width:30px;padding:0 0 10px;">${dot(22, a.container, a.onContainer, 12, String(i + 1))}</td>
        <td valign="top" style="padding:2px 0 10px;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.onSurfaceVariant};">${item}</td>
      </tr>`)
        .join('')}</table>`,
    list: (a, s, b) => panel(s, `<table ${TABLE} width="100%">${b.items
        .map((item, i) => {
        const top = i ? `border-top:1px solid ${C.hairline};` : '';
        return `<tr>
            <td valign="middle" width="14" style="width:14px;padding:13px 0;${top}">${dot(8, a.primary)}</td>
            <td valign="middle" style="padding:13px 0;${top}font-family:${FONT};font-size:14px;line-height:1.4;font-weight:700;color:${C.onSurface};">${esc(item.text)}</td>
            <td valign="middle" align="right" style="padding:13px 0;${top}font-family:${MONO};font-size:12px;color:${C.outline};text-align:right;">${esc(item.sub ?? '')}</td>
          </tr>`;
    })
        .join('')}</table>`, [4, 18, 4, 18], [4, 22], b.items.length * 46),
    quote: (a, s, b) => roundedBox({
        width: s.width, radius: s.panelRadius, fill: C.surfaceLow, padding: [16, 20, 16, 20], margin: [4, 22],
        estHeight: 110, css: `border-left:3px solid ${a.primary};`,
        html: `<div style="font-family:${FONT};font-size:15px;line-height:1.65;color:${C.onSurface};white-space:pre-wrap;">${esc(b.text)}</div>
        ${b.by ? `<div style="margin-top:8px;font-family:${FONT};font-size:12.5px;line-height:1.4;font-weight:600;color:${C.onSurfaceVariant};">${esc(b.by)}</div>` : ''}`,
    }),
    fallback: (a, s, b) => `<p style="margin:18px 0 0;font-family:${FONT};font-size:12.5px;line-height:1.6;color:${C.outline};word-break:break-all;">Button not working? Paste this link into your browser:<br/><a href="${esc(b.url)}" target="_blank" style="color:${a.primary};font-weight:600;text-decoration:none;">${esc(b.url)}</a></p>`,
    raw: (a, s, b) => b.html,
};
export function renderBlocks(a, s, blocks) {
    return blocks
        .filter((b) => Boolean(b))
        .map((b) => renderers[b.type](a, s, b))
        .join('\n');
}
