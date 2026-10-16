import { Document, Model, QueryFilter, UpdateQuery, Types } from 'mongoose';

export interface PaginateOptions {
  filter: QueryFilter<any>;
  skip: number;
  limit: number;
  sortBy: string;
  sortDir: 1 | -1;
}

export interface PaginateResult<T> {
  items: T[];
  total: number;
}

export class BaseRepository<T extends Document> {
  protected model: Model<T>;

  constructor(model: Model<T>) {
    this.model = model;
  }

  private withNotDeleted(filter: QueryFilter<T> = {}): QueryFilter<T> {
    return { ...filter, isDeleted: false } as QueryFilter<T>;
  }

  async findById(id: string | Types.ObjectId, extraFilter: QueryFilter<T> = {}): Promise<T | null> {
    return this.model.findOne(this.withNotDeleted({ _id: id, ...extraFilter } as QueryFilter<T>));
  }

  async findOne(filter: QueryFilter<T>): Promise<T | null> {
    return this.model.findOne(this.withNotDeleted(filter));
  }

  async find(filter: QueryFilter<T> = {}): Promise<T[]> {
    return this.model.find(this.withNotDeleted(filter));
  }

  async paginate(options: PaginateOptions): Promise<PaginateResult<T>> {
    const filter = this.withNotDeleted(options.filter);
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ [options.sortBy]: options.sortDir })
        .skip(options.skip)
        .limit(options.limit),
      this.model.countDocuments(filter),
    ]);
    return { items, total };
  }

  async create(data: Partial<T>, actorId?: string): Promise<T> {
    const payload = actorId ? { ...data, createdBy: actorId, updatedBy: actorId } : data;
    const doc = new this.model(payload);
    return doc.save();
  }

  async updateById(id: string | Types.ObjectId, data: UpdateQuery<T>, actorId?: string): Promise<T | null> {
    const update = actorId ? { ...data, updatedBy: actorId } : data;
    return this.model.findOneAndUpdate(this.withNotDeleted({ _id: id } as QueryFilter<T>), update, { returnDocument: 'after' });
  }

  async softDelete(id: string | Types.ObjectId, actorId?: string): Promise<T | null> {
    return this.model.findOneAndUpdate(
      this.withNotDeleted({ _id: id } as QueryFilter<T>),
      { isDeleted: true, deletedAt: new Date(), deletedBy: actorId ?? null } as UpdateQuery<T>,
      { returnDocument: 'after' }
    );
  }

  async count(filter: QueryFilter<T> = {}): Promise<number> {
    return this.model.countDocuments(this.withNotDeleted(filter));
  }
}
