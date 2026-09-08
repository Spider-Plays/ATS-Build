/** Default profile image URL when the user has not uploaded one. */
export function defaultUserAvatarUrl(name) {
    const encoded = encodeURIComponent((name || 'User').trim());
    return `https://ui-avatars.com/api/?name=${encoded}&background=6366f1&color=fff&size=128&bold=true`;
}
