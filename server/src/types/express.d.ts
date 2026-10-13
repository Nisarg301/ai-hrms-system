import { UserRoleName } from '../constants/roles';

export interface AuthenticatedUser {
    id: string;
    organizationId: string | null;
    role: UserRoleName;
    roleId: string | null;
    /** Display name, used for audit records. Optional so hand-built test users stay valid. */
    name?: string;
}

declare global {
    namespace Express {
        interface Request {
            user?: AuthenticatedUser;
        }
    }
}

export { };
