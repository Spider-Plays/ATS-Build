/** Dev / demo accounts. Seeded via `npm run db:seed` and `npm run db:seed-demo`. */
import registry from './devUsers.registry.json' with { type: 'json' };
export const STITCH_EMAIL_DOMAIN = 'stitch-ats.in';
export const DEV_PASSWORD = 'password';
export const DEV_USERS = registry.map((u) => ({
    email: u.email,
    password: DEV_PASSWORD,
    name: u.name,
    role: u.role,
    ...('department' in u && u.department ? { department: u.department } : {}),
    ...(u.primary ? { primary: true } : {}),
}));
export function devUsersForRole(role) {
    return DEV_USERS.filter((u) => u.role === role);
}
export function devUserEmail(role) {
    const user = DEV_USERS.find((u) => u.role === role && u.primary) ?? DEV_USERS.find((u) => u.role === role);
    if (!user)
        throw new Error(`Unknown dev role: ${role}`);
    return user.email.toLowerCase();
}
export function devUserName(role) {
    const user = DEV_USERS.find((u) => u.role === role && u.primary) ?? DEV_USERS.find((u) => u.role === role);
    if (!user)
        throw new Error(`Unknown dev role: ${role}`);
    return user.name;
}
