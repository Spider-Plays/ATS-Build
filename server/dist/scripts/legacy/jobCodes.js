import { migrateRequirementJobCodes } from '../../lib/jobCode.js';
export async function run(_argv = []) {
    const result = await migrateRequirementJobCodes();
    console.log('Requirement job code migration complete:');
    console.log(`  Total: ${result.total}`);
    console.log(`  Updated: ${result.updated}`);
    console.log(`  Already standard: ${result.unchanged}`);
}
