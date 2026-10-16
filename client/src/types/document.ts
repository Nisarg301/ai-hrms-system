export type DocumentStatus = 'active' | 'archived';

export interface DocumentFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface DocumentRow {
  id: string;
  title: string;
  description: string;
  category: string;
  status: DocumentStatus;
  file: DocumentFile | null;
}

export interface DocumentPayload {
  title: string;
  description: string;
  category: string;
  status: DocumentStatus;
  file?: string | File;
}
