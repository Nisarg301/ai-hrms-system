import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { PostModel } from '../models/post.model';
import { IUser, UserModel } from '../models/user.model';
import { departmentRepository } from '../repositories/department.repository';
import { userRepository } from '../repositories/user.repository';
import { presenceFor } from '../services/attendance.service';
import { snippet } from '../services/notification.service';
import { activeMembers, departmentNameMap, teamOf, toPerson } from '../services/people.service';
import { peopleSearchQuerySchema } from '../validators/people.validators';
import { addDays, now, todayIso } from '../utils/dates';
import { successResponse, ApiError } from '../utils/apiResponse';
import { containsPattern } from '../utils/regex';

const NEW_JOINER_DAYS = 30;

/** Everyone active in the organization, admins included (they can be managers). */
export const listPeople = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const [members, departmentNames] = await Promise.all([activeMembers(organizationId), departmentNameMap(organizationId)]);
  const people = members.map((m) => toPerson(m, departmentNames)).sort((a, b) => a.name.localeCompare(b.name));
  res.status(200).json(successResponse(people));
});

/**
 * The Welcome tab: new joiners (joined in the last 30 days) first, newest first,
 * whether or not they've written anything yet; then everyone else who has.
 */
export const listIntroductions = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const [members, departmentNames] = await Promise.all([activeMembers(organizationId), departmentNameMap(organizationId)]);
  const today = todayIso();
  const since = addDays(today, -NEW_JOINER_DAYS);

  const cards = members.map((m) => {
    const person = toPerson(m, departmentNames);
    const introduction = {
      about: m.introduction?.about ?? '',
      hobbies: m.introduction?.hobbies ?? '',
      lovesAboutJob: m.introduction?.lovesAboutJob ?? '',
    };
    const isNewJoiner = person.joiningDate >= since && person.joiningDate <= today;
    const hasIntroduction = Boolean(introduction.about || introduction.hobbies || introduction.lovesAboutJob);
    return { ...person, introduction, isNewJoiner, hasIntroduction };
  });

  const newJoiners = cards.filter((c) => c.isNewJoiner).sort((a, b) => b.joiningDate.localeCompare(a.joiningDate));
  const others = cards.filter((c) => !c.isNewJoiner && c.hasIntroduction).sort((a, b) => a.name.localeCompare(b.name));
  res.status(200).json(successResponse([...newJoiners, ...others]));
});

const SEARCH_LIMIT = 8;
/** Praise shown on a profile; the count covers all of it. */
const RECENT_PRAISE = 3;
/** Candidates fetched (alphabetically) before ranking; plenty for 8 good results. */
const SEARCH_POOL = 200;

const ACTIVE_MEMBER = { role: { $in: ['ORG_ADMIN', 'ORG_USER'] as ('ORG_ADMIN' | 'ORG_USER')[] }, status: 'active' as const };

/**
 * The header search: active members of my organization matching a name, job
 * title, work email or department. Prefix matches on the name come first.
 */
export const searchPeople = asyncHandler(async (req: Request, res: Response) => {
  const parsed = peopleSearchQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  const organizationId = req.orgFilter!.organizationId;
  const q = parsed.data.q;
  const pattern = containsPattern(q);

  const [departments, departmentNames] = await Promise.all([
    departmentRepository.find({ organizationId, title: pattern }),
    departmentNameMap(organizationId),
  ]);
  const candidates = await UserModel.find({
    organizationId,
    ...ACTIVE_MEMBER,
    isDeleted: false,
    $or: [{ name: pattern }, { jobTitle: pattern }, { email: pattern }, { department: { $in: departments.map((d) => d._id) } }],
  })
    .sort({ name: 1 })
    .limit(SEARCH_POOL);

  const lower = q.toLowerCase();
  const rank = (u: IUser) => {
    const name = u.name.toLowerCase();
    if (name.startsWith(lower)) return 0;
    if (name.split(/\s+/).some((part) => part.startsWith(lower))) return 1;
    return 2;
  };
  const best = [...candidates]
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, SEARCH_LIMIT);

  const presence = await presenceFor(organizationId, best.map((u) => u._id as Types.ObjectId), now());
  res.status(200).json(
    successResponse(
      best.map((u) => ({
        ...toPerson(u, departmentNames),
        email: u.email,
        ...presence.get(String(u._id))!,
      }))
    )
  );
});

/** Someone's profile panel: details, where they are today, manager, direct reports and introduction. */
export const getPersonProfile = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const person = await userRepository.findById(req.params.id, { organizationId, ...ACTIVE_MEMBER });
  if (!person) throw new ApiError(404, 'Person not found');
  const [members, departmentNames] = await Promise.all([activeMembers(organizationId), departmentNameMap(organizationId)]);
  const team = teamOf(person, members);
  const praiseFilter = { organizationId, 'praise.recipientIds': person._id, isDeleted: false };
  const [presenceMap, praiseCount, recent] = await Promise.all([
    presenceFor(organizationId, [person._id as Types.ObjectId], now()),
    PostModel.countDocuments(praiseFilter),
    PostModel.find(praiseFilter).sort({ _id: -1 }).limit(RECENT_PRAISE),
  ]);
  const presence = presenceMap.get(String(person._id))!;
  // Straight from the model, so praise from someone since deleted still shows who.
  const fromIds = [...new Set(recent.map((p) => String(p.authorId)))];
  const fromUsers = fromIds.length ? await UserModel.find({ _id: { $in: fromIds } }, { name: 1 }) : [];
  const fromNames = new Map(fromUsers.map((u) => [String(u._id), u.name]));
  res.status(200).json(
    successResponse({
      ...toPerson(person, departmentNames),
      email: person.email,
      ...presence,
      manager: team.manager ? toPerson(team.manager, departmentNames) : null,
      directReports: team.directReports.map((m) => toPerson(m, departmentNames)),
      // Day and month only ("MM-DD"): colleagues never see a birth year.
      birthday: person.dateOfBirth ? person.dateOfBirth.slice(5) : null,
      praiseCount,
      recentPraise: recent.map((p) => ({
        id: String(p._id),
        badge: p.praise!.badge,
        fromName: fromNames.get(String(p.authorId)) ?? 'Former member',
        message: snippet(p.body, 160),
        createdAt: p.createdAt,
      })),
      introduction: {
        about: person.introduction?.about ?? '',
        hobbies: person.introduction?.hobbies ?? '',
        lovesAboutJob: person.introduction?.lovesAboutJob ?? '',
      },
    })
  );
});
