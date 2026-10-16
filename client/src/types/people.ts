import type { UserRoleName } from './auth';
import type { PraiseBadge } from './post';

/** A colleague as the Home, Me and Team screens show them. */
export interface Person {
  id: string;
  name: string;
  jobTitle: string | null;
  departmentName: string | null;
  avatarUrl: string | null;
  role: UserRoleName;
  reportsTo: string | null;
  /** YYYY-MM-DD */
  joiningDate: string;
}

export interface Introduction {
  about: string;
  hobbies: string;
  lovesAboutJob: string;
}

/** A card on the Welcome tab. New joiners come first, whether or not they've written anything. */
export interface IntroductionCard extends Person {
  introduction: Introduction;
  isNewJoiner: boolean;
  hasIntroduction: boolean;
}

/** Where someone is right now. */
export type Presence = 'in' | 'out' | 'on_leave' | 'off' | 'not_in';

/** A header-search result. */
export interface PersonSearchResult extends Person {
  email: string;
  presence: Presence;
  wfh: boolean;
}

/** The profile panel opened from the search. */
export interface PersonProfile extends PersonSearchResult {
  manager: Person | null;
  directReports: Person[];
  introduction: Introduction;
  /** "MM-DD" (day and month only), or null. */
  birthday: string | null;
  praiseCount: number;
  /** The latest few. */
  recentPraise: { id: string; badge: PraiseBadge; fromName: string; message: string; createdAt: string }[];
}

export interface MyDetails {
  /** YYYY-MM-DD, or null. Mine only: colleagues only ever see day and month. */
  dateOfBirth: string | null;
}
