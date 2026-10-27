import { confirmAction } from '../../src/ai/agent.service';
import { documentModule } from '../../src/ai/modules/document.module';
import { allowedTools } from '../../src/ai/registry';
import { roleRepository } from '../../src/repositories/role.repository';
import { ApiError } from '../../src/utils/apiResponse';
import { admin, documentRow, employeeUser, FakeDocumentApi, pdf, scriptedModel, stubPersistence, toolCall, turn, TurnOptions } from './support';

stubPersistence();

const run = (opts: TurnOptions) => turn({ module: documentModule, ...opts });

function grantDocuments(rights: { read?: boolean; create?: boolean; update?: boolean; delete?: boolean }) {
  jest.spyOn(roleRepository, 'findById').mockResolvedValue({
    permissions: [{ module: 'documents', read: false, create: false, update: false, delete: false, ...rights }],
  } as never);
}

const library = () => new FakeDocumentApi([documentRow('Travel policy', 'Policy'), documentRow('Payroll guide', 'Finance')]);

describe('create_document (4.1)', () => {
  it('asks for the title, description and category, then confirms with the file as a multipart upload', async () => {
    const api = library();
    const first = await run({ api, message: 'Upload a document', model: scriptedModel(toolCall('create_document', {})) });
    expect(first.last.result!.text).toBe("I'll add a new document. I still need the **title**, a short **description** and the **category** (Finance or Policy).");
    expect(first.last.result!.buttons!.map((b) => b.label)).toEqual(['Finance', 'Policy', 'Fill in the form instead']);

    const second = await run({
      api,
      conversationId: first.conversationId,
      message: 'Employee handbook, the rules for everyone, under policy',
      model: scriptedModel(toolCall('create_document', { title: 'Employee handbook', description: 'the rules for everyone', category: 'policy' })),
    });
    const card = second.last.action!.card;
    expect(card.rows).toEqual([
      { label: 'Title', value: 'Employee handbook' },
      { label: 'Description', value: 'the rules for everyone' },
      // The existing spelling is kept: "policy" is filed under "Policy".
      { label: 'Category', value: 'Policy' },
      { label: 'Status', value: 'Active' },
    ]);
    expect(card).toMatchObject({ confirmLabel: 'Upload document', file: { required: true } });
    expect(api.writes()).toEqual([]);

    const done = await confirmAction({ user: admin, token: 't', actionId: second.last.action!.id, api, file: pdf('handbook.pdf') });
    expect(api.writes()).toEqual([
      {
        method: 'POST',
        path: '/documents',
        body: { title: 'Employee handbook', description: 'the rules for everyone', category: 'Policy', status: 'active' },
        attachFile: true,
        file: 'handbook.pdf',
      },
    ]);
    expect(done.message.result!.text).toBe('✅ **Document uploaded:** Employee handbook · Policy · handbook.pdf (1.2 MB).');
  });

  it('refuses Confirm without a file', async () => {
    const api = library();
    const { last } = await run({
      api,
      message: 'Upload the employee handbook under Policy: the rules for everyone',
      model: scriptedModel(toolCall('create_document', { title: 'Employee handbook', category: 'Policy' })),
    });
    // The description came from after the colon.
    expect(last.action!.card.rows.find((r) => r.label === 'Description')!.value).toBe('the rules for everyone');
    await expect(confirmAction({ user: admin, token: 't', actionId: last.action!.id, api })).rejects.toThrow(new ApiError(400, 'Choose a file first.'));
    expect(api.writes()).toEqual([]);
  });

  it('takes the one missing detail from a plain reply, and notes a new category', async () => {
    const api = library();
    const first = await run({
      api,
      message: 'Upload the employee handbook: the rules for everyone',
      model: scriptedModel(toolCall('create_document', { title: 'Employee handbook', description: 'the rules for everyone' })),
    });
    expect(first.last.result!.text).toBe("I'll add **Employee handbook**. I still need the **category** (Finance or Policy).");
    const second = await run({ api, conversationId: first.conversationId, message: 'Legal', model: scriptedModel() });
    expect(second.last.action!.card.rows.find((r) => r.label === 'Category')!.value).toBe('Legal');
    expect(second.last.action!.card.notes).toEqual(['"Legal" is a new category.']);
  });

  it('turns "Upload a new version of …" into a file replacement', async () => {
    const api = library();
    const { last } = await run({
      api,
      message: 'Upload a new version of the travel policy',
      model: scriptedModel(toolCall('create_document', { title: 'travel policy' })),
    });
    expect(last.action!.tool).toBe('update_document');
    expect(last.action!.card).toMatchObject({ title: 'Update Travel policy', confirmLabel: 'Upload new file', file: { required: true, current: 'travel-policy.pdf' } });
  });
});

describe('update_document and delete_document (4.2, 4.4)', () => {
  it('renames and archives, showing old → new', async () => {
    const api = library();
    const travel = api.documents[0];
    const { last } = await run({
      api,
      message: 'Rename the travel policy to Travel policy 2026 and archive it',
      model: scriptedModel(toolCall('update_document', { document: 'travel policy', newTitle: 'Travel policy 2026', status: 'archive' })),
    });
    expect(last.action!.card.rows).toEqual([
      { label: 'Title', value: 'Travel policy 2026', previous: 'Travel policy' },
      { label: 'Status', value: 'Archived', previous: 'Active' },
    ]);
    const done = await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'PUT', path: `/documents/${travel.id}`, body: { title: 'Travel policy 2026', status: 'archived' }, attachFile: false }]);
    expect(done.message.result!.text).toBe('✅ Updated **Travel policy 2026**: title is now Travel policy 2026 and status is now Archived.');
  });

  it('replaces the file with the one chosen on the card', async () => {
    const api = library();
    const travel = api.documents[0];
    const { last } = await run({ api, message: "Replace the travel policy's file", model: scriptedModel(toolCall('update_document', { document: 'travel policy' })) });
    expect(last.action!.card.rows).toEqual([{ label: 'File', value: 'The new file you choose', previous: 'travel-policy.pdf' }]);
    const done = await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api, file: pdf('travel-2026.pdf') });
    expect(api.writes()).toEqual([{ method: 'PUT', path: `/documents/${travel.id}`, body: {}, attachFile: true, file: 'travel-2026.pdf' }]);
    expect(done.message.result!.text).toBe('✅ Updated **Travel policy**: the file is now travel-2026.pdf (1.2 MB).');
  });

  it('turns a delete the user never asked for into the change they did', async () => {
    const api = library();
    const { last } = await run({ api, message: 'Archive the travel policy', model: scriptedModel(toolCall('delete_document', { document: 'travel policy' })) });
    expect(last.action!.tool).toBe('update_document');
    expect(last.action!.card.rows).toEqual([{ label: 'Status', value: 'Archived', previous: 'Active' }]);
  });

  it('deletes after a red card', async () => {
    const api = library();
    const payroll = api.documents[1];
    const { last } = await run({ api, message: 'Delete the payroll guide', model: scriptedModel(toolCall('delete_document', { document: 'payroll guide' })) });
    expect(last.action!.card).toMatchObject({ title: 'Delete Payroll guide?', tone: 'danger', confirmLabel: 'Delete document' });
    await confirmAction({ user: admin, token: 't', actionId: last.action!.id, api });
    expect(api.writes()).toEqual([{ method: 'DELETE', path: `/documents/${payroll.id}` }]);
  });

  it('asks which document when several match', async () => {
    const api = new FakeDocumentApi([documentRow('Leave policy', 'Policy'), documentRow('Travel policy', 'Policy')]);
    const { last } = await run({ api, message: 'Archive the policy', model: scriptedModel(toolCall('update_document', { document: 'policy', status: 'archived' })) });
    expect(last.result!.text).toBe('2 documents match "policy". Which one?');
    expect(last.result!.buttons![0].toolCall.args).toMatchObject({ status: 'archived' });
  });
});

describe('reads (4.3)', () => {
  it('downloads a file, and says when there is none', async () => {
    const api = new FakeDocumentApi([documentRow('Travel policy', 'Policy'), documentRow('Draft notes', 'HR', { file: null })]);
    const travel = api.documents[0];
    const got = await run({ api, message: 'Download the travel policy', model: scriptedModel(toolCall('download_document', { document: 'travel policy' })) });
    expect(got.last.result).toEqual({
      text: '**Travel policy**: travel-policy.pdf (1.2 MB).',
      downloads: [{ label: 'travel-policy.pdf', path: `/documents/${travel.id}/file` }],
      autoDownload: true,
    });
    const none = await run({ api, message: 'Download the draft notes', model: scriptedModel(toolCall('download_document', { document: 'draft notes' })) });
    expect(none.last.result!.text).toBe('**Draft notes** has no file yet. To add one, say "Upload a new version of Draft notes".');
  });

  it('only offers a file when the message does not ask for it now', async () => {
    const api = new FakeDocumentApi([documentRow('Travel policy', 'Policy')]);
    const { last } = await run({ api, message: 'The travel policy looks fine', model: scriptedModel(toolCall('download_document', { document: 'travel policy' })) });
    expect(last.result).toMatchObject({ downloads: [{ label: 'travel-policy.pdf' }], autoDownload: false });
  });

  it('lists by category and status, and reads a category that is not one as search words', async () => {
    const api = new FakeDocumentApi([documentRow('Travel policy', 'Policy'), documentRow('Leave rules', 'Policy', { status: 'archived' }), documentRow('Payroll guide', 'Finance')]);
    const policy = await run({ api, message: 'Show policy documents', model: scriptedModel(toolCall('list_documents', { category: 'policy' })) });
    expect(policy.last.result!.text).toBe('**2 documents** in Policy.');
    const archived = await run({ api, toolCall: { name: 'list_documents', args: { status: 'archived' } } });
    expect(archived.last.result!.text).toMatch(/^\*\*Leave rules\*\* · Policy · Archived/);
    const payroll = await run({ api, message: 'Show payroll documents', model: scriptedModel(toolCall('list_documents', { category: 'payroll' })) });
    expect(payroll.last.result!.text).toMatch(/^\*\*Payroll guide\*\*/);
  });

  it('counts per category', async () => {
    const api = new FakeDocumentApi([documentRow('A', 'Policy'), documentRow('B', 'policy'), documentRow('C', 'Finance')]);
    const { last } = await run({ api, toolCall: { name: 'count_documents', args: {} } });
    expect(last.result!.text).toBe('**3 documents** in total.');
    expect(last.result!.table!.rows).toEqual([
      { category: 'Policy', count: '2' },
      { category: 'Finance', count: '1' },
    ]);
  });
});

describe('what the first eval run showed (verbatim model calls)', () => {
  const eval1 = () =>
    new FakeDocumentApi([documentRow('Employee handbook', 'HR'), documentRow('Travel policy', 'Policy'), documentRow('Leave policy 2024', 'Policy', { status: 'archived' }), documentRow('Payroll guide', 'Finance')]);
  const labels = (last: { action: { card: { rows: { label: string }[] } } | null }) => last.action!.card.rows.map((r) => r.label);

  it('changes only what the message asks for, though the model copied the name into other fields', async () => {
    const archive = await run({ api: eval1(), message: 'Archive the travel policy', model: scriptedModel(toolCall('update_document', { category: 'Travel Policy', document: 'travel policy', newTitle: '', status: 'Archived' })) });
    expect(labels(archive.last)).toEqual(['Status']);
    const restore = await run({
      api: eval1(),
      message: 'Restore the leave policy',
      model: scriptedModel(toolCall('update_document', { newTitle: 'Leave Policy', status: 'Active', category: 'Leave Policy', document: 'leave policy' })),
    });
    expect(labels(restore.last)).toEqual(['Status']);
  });

  it('files an upload under the category the message names, with the description after the colon', async () => {
    const call = { category: 'HR: steps for new joiners', description: 'onboarding checklist', status: '', title: 'onboarding checklist' };
    const { last } = await run({ api: eval1(), message: 'Upload the onboarding checklist under HR: steps for new joiners', model: scriptedModel(toolCall('create_document', call)) });
    expect(last.action!.card.rows).toEqual([
      { label: 'Title', value: 'Onboarding checklist' },
      { label: 'Description', value: 'steps for new joiners' },
      { label: 'Category', value: 'HR' },
      { label: 'Status', value: 'Active' },
    ]);
    expect(last.action!.card.notes).toEqual([]);
  });

  it('turns an "upload" of an existing document, with no word for uploading, into a change', async () => {
    const call = { status: '', title: 'Payroll guide', category: 'HR', description: '' };
    const { last } = await run({ api: eval1(), message: 'Move the payroll guide to the HR category', model: scriptedModel(toolCall('create_document', call)) });
    expect(last.action!.tool).toBe('update_document');
    expect(last.action!.card.rows).toEqual([{ label: 'Category', value: 'HR', previous: 'Finance' }]);
  });

  it('lists the documents for a "which" question sent to count_documents', async () => {
    const { last } = await run({ api: eval1(), message: 'Which documents are archived?', model: scriptedModel(toolCall('count_documents', { status: 'archived' })) });
    expect(last.result!.text).toMatch(/^\*\*Leave policy 2024\*\* · Policy · Archived/);
  });
});

describe('permissions follow the role matrix', () => {
  it('gives a read-only user the read tools only', async () => {
    grantDocuments({ read: true });
    expect((await allowedTools(documentModule, employeeUser)).map((t) => t.name)).toEqual(['list_documents', 'count_documents', 'download_document']);
    const { last } = await run({ user: employeeUser, api: library(), toolCall: { name: 'create_document', args: {} } });
    expect(last.result!.text).toBe('That action is not available to you.');
  });
});
