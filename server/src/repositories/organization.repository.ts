import { OrganizationModel, IOrganization } from '../models/organization.model';
import { BaseRepository } from './base.repository';

export class OrganizationRepository extends BaseRepository<IOrganization> {
  constructor() {
    super(OrganizationModel);
  }
}

export const organizationRepository = new OrganizationRepository();
