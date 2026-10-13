import { DocumentModel, IDocumentRecord } from '../models/document.model';
import { BaseRepository } from './base.repository';

export class DocumentRepository extends BaseRepository<IDocumentRecord> {
  constructor() {
    super(DocumentModel);
  }
}

export const documentRepository = new DocumentRepository();
