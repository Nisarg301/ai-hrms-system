import { createApiClient, multipartBody } from '../../src/ai/apiClient';
import {
  asksForNewFile,
  asksToDelete,
  asksToUpload,
  cleanDocumentArgs,
  cleanDocumentTitle,
  documentQuery,
  documentWords,
  fileSize,
  fillDocumentFromText,
  matchCategory,
  statusesIn,
  statusFromWords,
} from '../../src/ai/modules/document.helpers';

describe('statuses', () => {
  it.each([
    ['archive it', 'archived'],
    ['archived', 'archived'],
    ['obsolete', 'archived'],
    ['restore it', 'active'],
    ['unarchive', 'active'],
    ['active', 'active'],
  ])('%s -> %s', (words, status) => {
    expect(statusFromWords(words)).toBe(status);
  });

  it('does not count "unarchive" as archive too', () => {
    expect(statusesIn('Unarchive the travel policy')).toEqual(['active']);
    expect(statusesIn('Rename the handbook')).toEqual([]);
  });
});

describe('categories', () => {
  it('reuses the existing spelling, and finds none for a new one', () => {
    expect(matchCategory(['HR', 'Policy'], 'hr')).toBe('HR');
    expect(matchCategory(['HR', 'Policy'], 'Legal')).toBeNull();
  });
});

describe('finding a document', () => {
  it('keeps the words that name it', () => {
    expect(documentQuery('Download the handbook document')).toBe('Download handbook');
    expect(documentQuery('the travel policy')).toBe('travel policy');
    expect(documentWords('the old travel policy pdf')).toEqual(['old', 'travel', 'policy']);
  });

  it('tells the tool from the words', () => {
    expect(asksToUpload('Upload the employee handbook')).toBe(true);
    expect(asksToUpload('Archive the travel policy')).toBe(false);
    expect(asksToDelete('Delete the old travel policy')).toBe(true);
    expect(asksToDelete('Rename the handbook')).toBe(false);
    expect(asksForNewFile('Upload a new version of the handbook')).toBe(true);
    expect(asksForNewFile("Replace the handbook's file")).toBe(true);
    expect(asksForNewFile('Upload the employee handbook')).toBe(false);
  });
});

describe('cleaning the model values', () => {
  it('drops what the user never said, and a description that repeats the title', () => {
    expect(cleanDocumentArgs({ title: 'Employee handbook', description: 'Employee handbook', category: 'HR' }, 'Upload the employee handbook under HR', false)).toEqual({
      title: 'Employee handbook',
      category: 'HR',
    });
    expect(cleanDocumentArgs({ title: 'Leave policy', category: 'Finance' }, 'Upload the employee handbook', false)).toEqual({});
  });

  it('takes the title out of the request around it', () => {
    expect(cleanDocumentTitle('upload document called Employee handbook under HR', ['HR'])).toBe('Employee handbook');
    expect(cleanDocumentTitle('the travel policy', [])).toBe('The travel policy');
  });
});

describe('fillDocumentFromText', () => {
  it('fills the one missing detail from a plain reply', () => {
    expect(fillDocumentFromText(['category'], 'Under HR')).toEqual({ category: 'HR' });
    expect(fillDocumentFromText(['description'], 'The rules for everyone.')).toEqual({ description: 'The rules for everyone' });
    expect(fillDocumentFromText(['title'], 'Call it Travel policy')).toEqual({ title: 'Travel policy' });
  });

  it('leaves a new request, or several missing details, to the model', () => {
    expect(fillDocumentFromText(['category'], 'show all documents')).toBeNull();
    expect(fillDocumentFromText(['title', 'category'], 'Handbook')).toBeNull();
  });
});

describe('multipartBody', () => {
  it("sends the body's fields and the file, as the page's form does", async () => {
    const form = multipartBody(
      { title: 'Employee handbook', description: 'Rules', category: 'HR', status: 'active', skipped: undefined },
      { buffer: Buffer.from('%PDF-1.4'), originalname: 'handbook.pdf', mimetype: 'application/pdf', size: 8 }
    );
    expect([...form.keys()]).toEqual(['title', 'description', 'category', 'status', 'file']);
    const file = form.get('file') as File;
    expect(file.name).toBe('handbook.pdf');
    expect(file.type).toBe('application/pdf');
    expect(await file.text()).toBe('%PDF-1.4');
  });

  it('formats file sizes', () => {
    expect(fileSize(1258291)).toBe('1.2 MB');
    expect(fileSize(2048)).toBe('2 KB');
  });
});

describe('createApiClient with a file', () => {
  const ok = () => new Response(JSON.stringify({ success: true, data: { id: 'd1' } }), { status: 201, headers: { 'Content-Type': 'application/json' } });

  it('sends a call marked attachFile as multipart, letting fetch set the boundary', async () => {
    const fetchImpl = jest.fn(async () => ok()) as unknown as typeof fetch;
    const api = createApiClient('token', fetchImpl);
    const file = { buffer: Buffer.from('%PDF-1.4'), originalname: 'handbook.pdf', mimetype: 'application/pdf', size: 8 };
    await api.send({ method: 'POST', path: '/documents', body: { title: 'Handbook' }, attachFile: true }, file);
    const [, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
  });

  it('keeps every other call JSON', async () => {
    const fetchImpl = jest.fn(async () => ok()) as unknown as typeof fetch;
    await createApiClient('token', fetchImpl).send({ method: 'PUT', path: '/documents/d1', body: { title: 'Handbook' }, attachFile: true });
    const [, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ title: 'Handbook' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});
