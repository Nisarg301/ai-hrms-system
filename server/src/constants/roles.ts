export const USER_ROLES = ['SUPER_ADMIN', 'ORG_ADMIN', 'ORG_USER'] as const;
export type UserRoleName = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
