import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const STITCH_MARK_CID = 'stitch-mark';
const moduleDir = dirname(fileURLToPath(import.meta.url));
function resolveStitchMarkPath() {
    const candidates = [
        join(process.cwd(), 'public/stitch-mark.png'),
        join(process.cwd(), '../public/stitch-mark.png'),
        join(moduleDir, '../../../public/stitch-mark.png'),
        join(moduleDir, '../../../../public/stitch-mark.png'),
    ];
    return candidates.find((path) => existsSync(path)) ?? null;
}
let cachedMark;
export function getStitchMarkPng() {
    if (cachedMark !== undefined)
        return cachedMark;
    const path = resolveStitchMarkPath();
    cachedMark = path ? readFileSync(path) : null;
    return cachedMark;
}
export function getStitchMarkInlineAttachment() {
    const content = getStitchMarkPng();
    if (!content)
        return null;
    return {
        cid: STITCH_MARK_CID,
        filename: 'stitch-mark.png',
        contentType: 'image/png',
        content,
    };
}
export function emailUsesStitchMark(html) {
    return html.includes(`cid:${STITCH_MARK_CID}`);
}
