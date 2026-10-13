import { UserModel, IUser } from '../models/user.model';
import { BaseRepository } from './base.repository';
import { QueryFilter } from 'mongoose';

export class UserRepository extends BaseRepository<IUser> {
  constructor() {
    super(UserModel);
  }

  async findByEmail(email: string): Promise<IUser | null> {
    return this.findOne({ email: email.toLowerCase() } as QueryFilter<IUser>);
  }
}

export const userRepository = new UserRepository();
