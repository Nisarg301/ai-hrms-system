import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { ChecklistTemplateModel, IChecklistTemplate } from '../models/checklistTemplate.model';
import { UserModel } from '../models/user.model';
import { auditCrud } from '../services/audit.service';
import { ensureDefaultTemplates, fieldError, prepareTemplateTasks } from '../services/lifecycle.service';
import { successResponse, ApiError } from '../utils/apiResponse';
import { templateListQuerySchema } from '../validators/lifecycle.validators';

/** Names of the people named as assignees, so the editor can show them. */
async function personNames(templates: IChecklistTemplate[]): Promise<Map<string, string>> {
  const ids = [...new Set(templates.flatMap((t) => t.tasks.map((task) => task.assignee.userId).filter(Boolean).map(String)))];
  const users = ids.length ? await UserModel.find({ _id: { $in: ids } }, { name: 1 }) : [];
  return new Map(users.map((u) => [String(u._id), u.name]));
}

function serialize(t: IChecklistTemplate, names: Map<string, string>) {
  return {
    id: String(t._id),
    name: t.name,
    kind: t.kind,
    isDefault: t.isDefault,
    tasks: t.tasks.map((task) => ({
      key: task.key,
      title: task.title,
      instructions: task.instructions,
      assignee: {
        kind: task.assignee.kind,
        userId: task.assignee.userId ? String(task.assignee.userId) : null,
        name: task.assignee.userId ? (names.get(String(task.assignee.userId)) ?? null) : null,
      },
      dueOffsetDays: task.dueOffsetDays,
      type: task.type,
      questions: task.questions,
      link: task.link,
    })),
    updatedAt: t.updatedAt,
  };
}

async function view(t: IChecklistTemplate) {
  return serialize(t, await personNames([t]));
}

const isDuplicateKey = (err: unknown) => (err as { code?: number }).code === 11000;
const auditLabel = (t: IChecklistTemplate, suffix = '') => `${t.kind === 'onboarding' ? 'Onboarding' : 'Offboarding'} template ${t.name}${suffix}`;
const nameTaken = () => fieldError('name', 'There is already a template with this name');

async function findTemplate(req: Request): Promise<IChecklistTemplate> {
  const template = await ChecklistTemplateModel.findOne({ _id: req.params.id, organizationId: req.orgFilter!.organizationId, isDeleted: false });
  if (!template) throw new ApiError(404, 'Template not found');
  return template;
}

/** Every template (the two standard ones are created on first use), defaults first within each kind. */
export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
  const parsed = templateListQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  const organizationId = req.orgFilter!.organizationId;
  await ensureDefaultTemplates(organizationId);
  const templates = await ChecklistTemplateModel.find({
    organizationId,
    isDeleted: false,
    ...(parsed.data.kind ? { kind: parsed.data.kind } : {}),
  }).sort({ kind: 1, isDefault: -1, nameKey: 1 });
  const names = await personNames(templates);
  res.status(200).json(successResponse(templates.map((t) => serialize(t, names))));
});

export const getTemplate = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(successResponse(await view(await findTemplate(req))));
});

/** A new template is never the default; "Make default" does that. */
export const createTemplate = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  await ensureDefaultTemplates(organizationId);
  const tasks = await prepareTemplateTasks(organizationId, req.body.tasks);
  try {
    const template = await ChecklistTemplateModel.create({
      organizationId,
      name: req.body.name,
      nameKey: req.body.name.toLowerCase(),
      kind: req.body.kind,
      tasks,
      createdBy: req.user!.id,
      updatedBy: req.user!.id,
    });
    await auditCrud(req, 'create', 'onboarding', { id: String(template._id), label: auditLabel(template) });
    res.status(201).json(successResponse(await view(template)));
  } catch (err) {
    if (isDuplicateKey(err)) throw nameTaken();
    throw err;
  }
});

/** Running processes keep the tasks they started with. */
export const updateTemplate = asyncHandler(async (req: Request, res: Response) => {
  const template = await findTemplate(req);
  const set: Record<string, unknown> = { updatedBy: req.user!.id };
  if (req.body.name !== undefined) {
    set.name = req.body.name;
    set.nameKey = req.body.name.toLowerCase();
  }
  if (req.body.tasks !== undefined) set.tasks = await prepareTemplateTasks(req.orgFilter!.organizationId, req.body.tasks);
  try {
    const updated = await ChecklistTemplateModel.findOneAndUpdate({ _id: template._id, isDeleted: false }, { $set: set }, { returnDocument: 'after' });
    if (!updated) throw new ApiError(404, 'Template not found');
    await auditCrud(req, 'update', 'onboarding', { id: String(updated._id), label: auditLabel(updated) });
    res.status(200).json(successResponse(await view(updated)));
  } catch (err) {
    if (isDuplicateKey(err)) throw nameTaken();
    throw err;
  }
});

/** The default can't go (a kind always has one to preselect); running processes are unaffected. */
export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
  const template = await findTemplate(req);
  if (template.isDefault) throw new ApiError(400, 'Make another template the default first');
  const deleted = await ChecklistTemplateModel.findOneAndUpdate(
    { _id: template._id, isDeleted: false, isDefault: false },
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user!.id } },
    { returnDocument: 'after' }
  );
  // Made the default in the meantime.
  if (!deleted) throw new ApiError(400, 'Make another template the default first');
  await auditCrud(req, 'delete', 'onboarding', { id: req.params.id, label: auditLabel(template) });
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});

/**
 * Makes this the kind's default: the old default is cleared first. Two admins doing it at
 * once can't leave two defaults (a unique index); the one that loses is asked to try again.
 */
export const makeDefault = asyncHandler(async (req: Request, res: Response) => {
  const template = await findTemplate(req);
  if (template.isDefault) {
    res.status(200).json(successResponse(await view(template)));
    return;
  }
  const organizationId = req.orgFilter!.organizationId;
  await ChecklistTemplateModel.updateMany(
    { organizationId, kind: template.kind, isDefault: true, _id: { $ne: template._id as Types.ObjectId } },
    { $set: { isDefault: false, updatedBy: req.user!.id } }
  );
  try {
    const updated = await ChecklistTemplateModel.findOneAndUpdate(
      { _id: template._id, isDeleted: false },
      { $set: { isDefault: true, updatedBy: req.user!.id } },
      { returnDocument: 'after' }
    );
    if (!updated) throw new ApiError(404, 'Template not found');
    await auditCrud(req, 'update', 'onboarding', { id: String(updated._id), label: auditLabel(updated, ' made the default') });
    res.status(200).json(successResponse(await view(updated)));
  } catch (err) {
    if (isDuplicateKey(err)) throw new ApiError(409, 'Another template was made the default at the same moment. Try again.');
    throw err;
  }
});
