import { Types } from 'mongoose';
import { userRepository } from '../repositories/user.repository';
import { organizationRepository } from '../repositories/organization.repository';
import { roleRepository } from '../repositories/role.repository';
import { generateTempPassword, hashPassword } from '../utils/password';
import { ApiError } from '../utils/apiResponse';
import { mailerService } from './mailer.service';
import { IUser } from '../models/user.model';
import { UserRoleName } from '../constants/roles';

interface InviteOrgAdminInput {
  name: string;
  email: string;
  organizationId?: string;
  organizationName?: string;
  invitedBy: string;
}

interface InviteOrgUserInput {
  name: string;
  email: string;
  roleId: string;
  organizationId: string;
  jobTitle: string;
  departmentId: string;
  reportsTo?: string | null;
  joiningDate?: string;
  dateOfBirth?: string;
  invitedBy: string;
}

async function createInvitedUser(params: {
  name: string;
  email: string;
  role: UserRoleName;
  organizationId: Types.ObjectId | null;
  roleId: Types.ObjectId | null;
  jobTitle: string | null;
  department: Types.ObjectId | null;
  reportsTo?: Types.ObjectId | null;
  joiningDate?: string | null;
  dateOfBirth?: string | null;
  invitedBy: string;
}): Promise<{ user: IUser; tempPassword: string }> {
  const existing = await userRepository.findByEmail(params.email);
  if (existing) {
    throw new ApiError(409, 'A user with this email already exists');
  }
  const tempPassword = generateTempPassword();
  const user = await userRepository.create(
    {
      name: params.name,
      email: params.email,
      passwordHash: await hashPassword(tempPassword),
      role: params.role,
      organizationId: params.organizationId,
      roleId: params.roleId,
      jobTitle: params.jobTitle,
      department: params.department,
      reportsTo: params.reportsTo ?? null,
      joiningDate: params.joiningDate ?? null,
      dateOfBirth: params.dateOfBirth ?? null,
      mustChangePassword: true,
    },
    params.invitedBy
  );
  await mailerService.sendTempPasswordEmail(params.email, tempPassword);
  return { user, tempPassword };
}

export const inviteService = {
  async inviteOrgAdmin(input: InviteOrgAdminInput): Promise<{ user: IUser; tempPassword: string }> {
    let organizationId: Types.ObjectId;
    if (input.organizationId) {
      const org = await organizationRepository.findById(input.organizationId);
      if (!org) {
        throw new ApiError(404, 'Organization not found');
      }
      organizationId = org._id as Types.ObjectId;
    } else {
      if (!input.organizationName) {
        throw new ApiError(400, 'organizationName is required when organizationId is not provided');
      }
      const org = await organizationRepository.create({ name: input.organizationName }, input.invitedBy);
      organizationId = org._id as Types.ObjectId;
    }

    return createInvitedUser({
      name: input.name,
      email: input.email,
      role: 'ORG_ADMIN',
      organizationId,
      roleId: null,
      jobTitle: null,
      department: null,
      invitedBy: input.invitedBy,
    });
  },

  async inviteOrgUser(input: InviteOrgUserInput): Promise<{ user: IUser; tempPassword: string }> {
    const role = await roleRepository.findById(input.roleId, { organizationId: new Types.ObjectId(input.organizationId) });
    if (!role) {
      throw new ApiError(404, 'Role not found in your organization');
    }
    return createInvitedUser({
      name: input.name,
      email: input.email,
      role: 'ORG_USER',
      organizationId: new Types.ObjectId(input.organizationId),
      roleId: new Types.ObjectId(input.roleId),
      jobTitle: input.jobTitle,
      department: new Types.ObjectId(input.departmentId),
      reportsTo: input.reportsTo ? new Types.ObjectId(input.reportsTo) : null,
      joiningDate: input.joiningDate ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      invitedBy: input.invitedBy,
    });
  },
};
