import bcrypt from 'bcrypt';
import crypto from 'crypto';

const SALT_ROUNDS = 10;
const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';

export async function hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
}

export function generateTempPassword(length = 12): string {
    const bytes = crypto.randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i += 1) {
        result += TEMP_PASSWORD_CHARS[bytes[i] % TEMP_PASSWORD_CHARS.length];
    }
    return result;
}

export function generateRawToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}
