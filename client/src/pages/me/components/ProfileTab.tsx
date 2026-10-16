import { EditOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Descriptions, Row, Skeleton, Tag, theme } from 'antd';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import { ROUTES } from '../../../constants/routes';
import { useAppDispatch, useAppSelector } from '../../../hooks/store';
import { selectAuthUser } from '../../../store/auth/authSelectors';
import { selectPeople, selectPeopleError, selectPeopleStatus } from '../../../store/team/teamSelectors';
import { fetchPeople } from '../../../store/team/teamThunks';
import { MyIntroductionCard } from '../../home/components/MyIntroductionCard';
import { MyDateOfBirth } from './MyDateOfBirth';

const ROLE_LABELS = { ORG_ADMIN: 'Organization admin', ORG_USER: 'Member', SUPER_ADMIN: 'Super admin' } as const;

/** My job details (read-only; an admin maintains them) and my introduction. */
export function ProfileTab() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const user = useAppSelector(selectAuthUser)!;
  const people = useAppSelector(selectPeople);
  const status = useAppSelector(selectPeopleStatus);
  const error = useAppSelector(selectPeopleError);

  useEffect(() => {
    void dispatch(fetchPeople());
  }, [dispatch]);

  const me = people.find((p) => p.id === user.id);
  const manager = me?.reportsTo ? people.find((p) => p.id === me.reportsTo) : undefined;

  return (
    <Row gutter={16}>
      <Col xs={24} xl={10}>
        <Card className="mb-4">
          <div className="mb-4 flex items-center gap-4">
            <PersonAvatar name={user.name} avatarUrl={user.avatar?.url} size={72} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold">{user.name}</div>
              <div style={{ color: token.colorTextSecondary }}>{me?.jobTitle ?? ''}</div>
              <Tag className="mt-1">{ROLE_LABELS[user.role]}</Tag>
            </div>
            <Button icon={<EditOutlined />} onClick={() => navigate(ROUTES.profile)}>
              Photo & name
            </Button>
          </div>
          {error ? <Alert type="error" showIcon message={error} /> : null}
          {status === 'loading' && !me ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : (
            <Descriptions column={1} size="small" colon={false} styles={{ label: { width: 140, color: token.colorTextSecondary } }}>
              <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
              <Descriptions.Item label="Job title">{me?.jobTitle || '—'}</Descriptions.Item>
              <Descriptions.Item label="Department">{me?.departmentName || '—'}</Descriptions.Item>
              <Descriptions.Item label="Reports to">
                {manager ? (
                  <span className="flex items-center gap-2">
                    <PersonAvatar name={manager.name} avatarUrl={manager.avatarUrl} size="small" />
                    {manager.name}
                  </span>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Date of joining">{me ? dayjs(me.joiningDate).format('DD MMM YYYY') : '—'}</Descriptions.Item>
              <Descriptions.Item label="Date of birth">
                <MyDateOfBirth />
              </Descriptions.Item>
            </Descriptions>
          )}
          <div className="mt-3 text-xs" style={{ color: token.colorTextSecondary }}>
            Something wrong here? Your organization admin keeps these details up to date, except your date of birth, which you can set yourself.
          </div>
        </Card>
      </Col>
      <Col xs={24} xl={14}>
        <MyIntroductionCard />
      </Col>
    </Row>
  );
}
