import { MailOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Drawer, Empty, Skeleton, theme } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { getPersonProfileRequest } from '../../services/endpoints/people.endpoints';
import { ApiError } from '../../types/api';
import type { Person, PersonProfile } from '../../types/people';
import { INTRODUCTION_QUESTIONS } from '../../pages/home/components/introductionQuestions';
import { PersonAvatar } from '../PersonAvatar/PersonAvatar';
import { PresenceTag } from './PresenceTag';
import { PRAISE_BADGES } from '../../utils/praise';
import { fromNow } from '../../utils/dates';

interface PersonProfileDrawerProps {
  /** Whose profile to show; null closes the drawer. */
  personId: string | null;
  onClose: () => void;
  /** Opens someone else (the manager or a direct report). */
  onOpenPerson: (id: string) => void;
}

function PersonLink({ person, onOpen }: { person: Person; onOpen: (id: string) => void }) {
  const { token } = theme.useToken();
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent p-1 text-left hover:bg-black/5"
      onClick={() => onOpen(person.id)}
      aria-label={`Open ${person.name}`}
    >
      <PersonAvatar name={person.name} avatarUrl={person.avatarUrl} size="small" />
      <span className="min-w-0">
        <span className="block truncate">{person.name}</span>
        <span className="block truncate text-xs" style={{ color: token.colorTextSecondary }}>
          {person.jobTitle ?? ''}
        </span>
      </span>
    </button>
  );
}

/** A colleague's profile: details, where they are today, their manager and direct reports, and their introduction. */
export function PersonProfileDrawer({ personId, onClose, onOpenPerson }: PersonProfileDrawerProps) {
  const { token } = theme.useToken();
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!personId) return;
    let current = true;
    setProfile(null);
    setError(null);
    getPersonProfileRequest(personId)
      .then(({ data }) => current && setProfile(data))
      .catch((err) => current && setError(err instanceof ApiError ? err.message : 'Could not load this profile'));
    return () => {
      current = false;
    };
  }, [personId]);

  const intro = profile ? INTRODUCTION_QUESTIONS.filter((q) => profile.introduction[q.key]) : [];

  return (
    <Drawer open={Boolean(personId)} onClose={onClose} width={420} title="Profile" destroyOnHidden>
      {error ? (
        <Alert type="error" showIcon message={error} />
      ) : !profile ? (
        <Skeleton active avatar paragraph={{ rows: 5 }} />
      ) : (
        <div data-testid="person-profile">
          <div className="mb-4 flex items-center gap-4">
            <PersonAvatar name={profile.name} avatarUrl={profile.avatarUrl} size={72} />
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold">{profile.name}</div>
              <div style={{ color: token.colorTextSecondary }}>{[profile.jobTitle, profile.departmentName].filter(Boolean).join(' · ')}</div>
              <div className="mt-1">
                <PresenceTag presence={profile.presence} wfh={profile.wfh} />
              </div>
            </div>
          </div>
          <Button className="mb-4" icon={<MailOutlined />} href={`mailto:${profile.email}`}>
            {profile.email}
          </Button>
          <Descriptions column={1} size="small" colon={false} styles={{ label: { width: 120, color: token.colorTextSecondary } }}>
            <Descriptions.Item label="Joined">{dayjs(profile.joiningDate).format('DD MMM YYYY')}</Descriptions.Item>
            {profile.birthday ? (
              // Day and month only: the year is never shared.
              <Descriptions.Item label="Birthday">{dayjs(`2000-${profile.birthday}`).format('D MMMM')}</Descriptions.Item>
            ) : null}
          </Descriptions>

          <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide" style={{ color: token.colorTextSecondary }}>
            Reports to
          </h4>
          {profile.manager ? <PersonLink person={profile.manager} onOpen={onOpenPerson} /> : <div className="text-sm">No manager set</div>}

          <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide" style={{ color: token.colorTextSecondary }}>
            Direct reports{profile.directReports.length ? ` · ${profile.directReports.length}` : ''}
          </h4>
          {profile.directReports.length ? (
            <div className="flex flex-col gap-1">
              {profile.directReports.map((p) => (
                <PersonLink key={p.id} person={p} onOpen={onOpenPerson} />
              ))}
            </div>
          ) : (
            <div className="text-sm">None</div>
          )}

          <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide" style={{ color: token.colorTextSecondary }}>
            Praise received{profile.praiseCount ? ` · ${profile.praiseCount}` : ''}
          </h4>
          {profile.recentPraise.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Praise received">
              {profile.recentPraise.map((p) => {
                const badge = PRAISE_BADGES[p.badge];
                return (
                  <li key={p.id} className="rounded-lg p-2" style={{ background: `${badge.color}12` }}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium" style={{ color: badge.color }}>
                        {badge.emoji} {badge.label}
                      </span>
                      <span className="text-xs" style={{ color: token.colorTextSecondary }}>
                        from {p.fromName} · {fromNow(p.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1 text-sm">{p.message}</div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-sm">No praise yet</div>
          )}

          <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide" style={{ color: token.colorTextSecondary }}>
            Introduction
          </h4>
          {intro.length ? (
            <div className="flex flex-col gap-3">
              {intro.map((q) => (
                <div key={q.key}>
                  <div className="text-xs font-medium" style={{ color: token.colorPrimary }}>
                    {q.title}
                  </div>
                  <div className="whitespace-pre-line text-sm">{profile.introduction[q.key]}</div>
                </div>
              ))}
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${profile.name.split(' ')[0]} hasn't written an introduction yet.`} />
          )}
        </div>
      )}
    </Drawer>
  );
}
