import { prisma } from './prisma.js';
import { PAGE_KEYS } from './pageAccess.js';
const SETTING_KEY = 'page_publication';
export function defaultPagePublication() {
    return Object.fromEntries(PAGE_KEYS.map((key) => [key, true]));
}
export async function getPagePublication() {
    const defaults = defaultPagePublication();
    const setting = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
    if (!setting)
        return defaults;
    try {
        const stored = JSON.parse(setting.value);
        return {
            ...defaults,
            ...Object.fromEntries(PAGE_KEYS.filter((key) => typeof stored[key] === 'boolean').map((key) => [key, stored[key]])),
        };
    }
    catch {
        return defaults;
    }
}
export async function savePagePublication(pages, updatedBy) {
    const current = await getPagePublication();
    const next = {
        ...current,
        ...Object.fromEntries(PAGE_KEYS.filter((key) => typeof pages[key] === 'boolean').map((key) => [key, pages[key]])),
    };
    await prisma.appSetting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value: JSON.stringify(next), updatedBy },
        update: { value: JSON.stringify(next), updatedBy },
    });
    return next;
}
/** Pages that are live for the workspace. Unpublished pages are omitted for every role except Developer. */
export async function filterPublishedPages(role, pages) {
    if (role === 'DEVELOPER')
        return pages;
    const publication = await getPagePublication();
    return pages.filter((page) => publication[page] !== false);
}
