import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UserRoleName } from '../constants/roles';

export interface AccessTokenPayload {
    userId: string;
    organizationId: string | null;
    role: UserRoleName;
    roleId: string | null;
}

export interface RefreshTokenPayload {
    userId: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
    const options: jwt.SignOptions = { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'] };
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
    const options: jwt.SignOptions = { expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'] };
    return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}
