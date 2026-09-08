import { existsSync } from 'node:fs';
import { join } from 'node:path';
import puppeteerCore from 'puppeteer-core';
let browserInstance = null;
const HEADLESS_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
function useBundledChromium() {
    return process.env.RENDER === 'true' || process.platform === 'linux';
}
function resolveSystemBrowserExecutable() {
    const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
    if (fromEnv && existsSync(fromEnv))
        return fromEnv;
    const candidates = [];
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
            candidates.push(join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'));
        }
        candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
    }
    else if (process.platform === 'darwin') {
        candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    }
    else {
        candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium');
    }
    return candidates.find((path) => existsSync(path));
}
async function launchWithExecutable(executablePath) {
    return puppeteerCore.launch({
        executablePath,
        headless: true,
        args: HEADLESS_ARGS,
    });
}
async function launchBrowser() {
    if (useBundledChromium()) {
        const chromium = await import('@sparticuz/chromium');
        chromium.default.setGraphicsMode = false;
        return puppeteerCore.launch({
            args: chromium.default.args,
            executablePath: await chromium.default.executablePath(),
            headless: true,
        });
    }
    const systemBrowser = resolveSystemBrowserExecutable();
    if (systemBrowser) {
        return launchWithExecutable(systemBrowser);
    }
    try {
        const puppeteer = await import('puppeteer');
        return puppeteer.default.launch({
            headless: true,
            args: HEADLESS_ARGS,
        });
    }
    catch (bundledErr) {
        const message = 'PDF generation requires a Chromium browser. Install Google Chrome / Microsoft Edge, set PUPPETEER_EXECUTABLE_PATH, or run `npx puppeteer browsers install chrome` in the server folder.';
        throw new Error(message, {
            cause: bundledErr instanceof Error ? bundledErr : undefined,
        });
    }
}
async function getBrowser() {
    if (browserInstance?.connected)
        return browserInstance;
    try {
        browserInstance = await launchBrowser();
        return browserInstance;
    }
    catch (err) {
        browserInstance = null;
        throw err;
    }
}
export async function renderHtmlToPdf(html) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setContent(html, { waitUntil: 'load' });
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });
        return Buffer.from(pdf);
    }
    finally {
        await page.close();
    }
}
export async function closePdfBrowser() {
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
    }
}
