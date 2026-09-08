import crypto from 'crypto';
import { prisma } from './prisma.js';
import { env } from '../config/env.js';
import { sendPasswordResetEmail } from '../services/email.js';
export async function issuePasswordResetLink(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: token, passwordResetExpires: expires },
    });
    const loginPath = user.role === 'CANDIDATE' ? '/candidate/login' : '/login';
    const resetUrl = `${env.clientOrigin.replace(/\/$/, '')}${loginPath}?reset=${token}`;
    await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl });
}
