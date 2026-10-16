import { callApiServices } from '../callApiServices';

export const EXPORTABLE_MODULES = ['employees', 'documents', 'projects', 'tasks'] as const;
export type ExportableModule = (typeof EXPORTABLE_MODULES)[number];

/** CSV of all the organization's records in a module; the filename comes back in Content-Disposition. */
export function exportModuleRequest(module: ExportableModule) {
  return callApiServices<Blob>(`/exports/${module}`, 'get', true, undefined, 'blob');
}
