import { EditOutlined, SmileOutlined } from '@ant-design/icons';
import { Button, Skeleton, theme } from 'antd';
import { useEffect, useState } from 'react';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import { useAppDispatch, useAppSelector } from '../../../hooks/store';
import { selectAuthUser } from '../../../store/auth/authSelectors';
import { selectMyIntroduction, selectMyIntroductionStatus } from '../../../store/people/peopleSelectors';
import { fetchMyIntroduction } from '../../../store/people/peopleThunks';
import { HomeCard } from './HomeCard';
import { IntroductionFormModal } from './IntroductionFormModal';
import { INTRODUCTION_QUESTIONS } from './introductionQuestions';

/** My own introduction with an Edit button; an invitation to write one when it's empty. */
export function MyIntroductionCard() {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const user = useAppSelector(selectAuthUser);
  const intro = useAppSelector(selectMyIntroduction);
  const status = useAppSelector(selectMyIntroductionStatus);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    void dispatch(fetchMyIntroduction());
  }, [dispatch]);

  const answered = intro ? INTRODUCTION_QUESTIONS.filter((q) => intro[q.key]) : [];

  return (
    <HomeCard
      title="My introduction"
      icon={<SmileOutlined />}
      extra={
        answered.length > 0 ? (
          <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null
      }
    >
      {status !== 'succeeded' && !intro ? (
        <Skeleton active paragraph={{ rows: 2 }} />
      ) : answered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <PersonAvatar name={user?.name ?? '?'} avatarUrl={user?.avatar?.url} size={56} />
          <div className="text-base font-medium">Say hello to your colleagues 👋</div>
          <div className="max-w-md text-sm" style={{ color: token.colorTextSecondary }}>
            Tell everyone a little about yourself, your hobbies and what you love about your job.
          </div>
          <Button type="primary" icon={<EditOutlined />} onClick={() => setEditing(true)}>
            Introduce yourself
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {answered.map((q) => (
            <div key={q.key}>
              <div className="text-xs font-medium uppercase tracking-wide" style={{ color: token.colorPrimary }}>
                {q.title}
              </div>
              <div className="whitespace-pre-line">{intro![q.key]}</div>
            </div>
          ))}
        </div>
      )}
      <IntroductionFormModal open={editing} initial={intro} onClose={() => setEditing(false)} />
    </HomeCard>
  );
}
