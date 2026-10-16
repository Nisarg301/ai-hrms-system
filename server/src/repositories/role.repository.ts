import { RoleModel, IRole } from '../models/role.model';
import { BaseRepository } from './base.repository';

export class RoleRepository extends BaseRepository<IRole> {
  constructor() {
    super(RoleModel);
  }
}

export const roleRepository = new RoleRepository();
