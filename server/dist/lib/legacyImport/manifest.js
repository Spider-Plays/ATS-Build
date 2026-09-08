import fs from 'fs';
import path from 'path';
export function defaultManifestPath(dataDir) {
    return path.join(dataDir, 'import-manifest.json');
}
export function loadManifest(manifestPath) {
    if (!fs.existsSync(manifestPath))
        return null;
    try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
    catch {
        return null;
    }
}
export function createEmptyManifest(dataDir) {
    return {
        version: 1,
        importedAt: new Date().toISOString(),
        dataDir,
        requirements: {},
        candidatesByEmail: {},
        candidatesByResumeId: {},
        skippedRows: [],
    };
}
export function saveManifest(manifestPath, manifest) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    manifest.importedAt = new Date().toISOString();
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
