import { userRepository } from '../repositories/user.repository';
import { hashPassword } from '../utils/password';
import { env } from '../config/env';

export async function seedSuperAdmin(): Promise<{ created: boolean }> {
    if (!env.SUPERADMIN_EMAIL || !env.SUPERADMIN_PASSWORD || !env.SUPERADMIN_NAME) {
        throw new Error('SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, and SUPERADMIN_NAME must be set in the environment');
    }
    const existing = await userRepository.findByEmail(env.SUPERADMIN_EMAIL);
    if (existing) {
        return { created: false };
    }
    await userRepository.create({
        name: env.SUPERADMIN_NAME,
        email: env.SUPERADMIN_EMAIL,
        passwordHash: await hashPassword(env.SUPERADMIN_PASSWORD),
        role: 'SUPER_ADMIN',
    });
    return { created: true };
}
