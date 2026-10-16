import { callApiServices } from '../callApiServices';
import type { ListParams } from '../../types/api';
import type { DocumentRow } from '../../types/document';

export function listDocumentsRequest(params: ListParams) {
  return callApiServices<DocumentRow[]>('/documents', 'get', true, params);
}

export function createDocumentRequest(payload: FormData) {
  return callApiServices<DocumentRow>(
    '/documents',
    'post',
    true,
    payload
  );
}

export function updateDocumentRequest(id: string, payload: FormData) {
  return callApiServices<DocumentRow>(
    `/documents/${id}`,
    'put',
    true,
    payload
  );
}

export function downloadDocumentFileRequest(id: string) {
  return callApiServices<Blob>(`/documents/${id}/file`, 'get', true, undefined, 'blob');
}

export function deleteDocumentRequest(id: string) {
  return callApiServices<{ id: string; deleted: boolean }>(`/documents/${id}`, 'delete', true);
}
