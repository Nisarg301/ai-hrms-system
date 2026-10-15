import type { Introduction } from '../../../types/people';

/** The three Welcome-tab prompts, in display order. */
export const INTRODUCTION_QUESTIONS: { key: keyof Introduction; title: string; placeholder: string }[] = [
  { key: 'about', title: 'About me', placeholder: 'Where you are from, what you do, a fun fact…' },
  { key: 'hobbies', title: 'My hobbies', placeholder: 'Books, sports, music, cooking…' },
  { key: 'lovesAboutJob', title: 'What I love about my job', placeholder: 'The people, the problems, the craft…' },
];
