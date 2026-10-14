import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  createDocumentRequest,
  deleteDocumentRequest,
  listDocumentsRequest,
  updateDocumentRequest,
  downloadDocumentFileRequest
} from '../../services/endpoints/documents.endpoints';
import { toPaginationMeta, type PaginationMeta } from '../../types/api';
import type { DocumentRow } from '../../types/document';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';
import { filenameFromDisposition, saveBlob } from '../../utils/saveBlob';
import type { RootState } from '../index';

export const fetchDocuments = createAsyncThunk<
  { items: DocumentRow[]; meta: PaginationMeta },
  void,
  { state: RootState; rejectValue: string }
>('documents/fetch', async (_, { getState, rejectWithValue }) => {
  const { page, limit, search } = getState().documents;
  try {
    const { data, meta } = await listDocumentsRequest({ page, limit, search: search || undefined });
    return { items: data, meta: toPaginationMeta(meta, { page, limit, total: data.length }) };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const createDocument = createAsyncThunk<
  DocumentRow,
  FormData,
  { rejectValue: FieldAwareError }
>(
  'documents/create',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await createDocumentRequest(payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const updateDocument = createAsyncThunk<
  DocumentRow,
  { id: string; payload: FormData },
  { rejectValue: FieldAwareError }
>(
  'documents/update',
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      const { data } = await updateDocumentRequest(id, payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const deleteDocument = createAsyncThunk<void, string, { rejectValue: string }>(
  'documents/delete',
  async (id, { rejectWithValue }) => {
    try {
      await deleteDocumentRequest(id);
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const downloadDocumentFile = createAsyncThunk<
  void,
  string,
  { rejectValue: string }
>(
  'documents/download',

  async (id, { rejectWithValue }) => {
    try {
      const response = await downloadDocumentFileRequest(id);
      saveBlob(response.data, filenameFromDisposition(response.headers['content-disposition'], 'document'));
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);