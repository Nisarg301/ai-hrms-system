import { Alert, Badge, Card, Col, Empty, Row, Skeleton, theme } from 'antd';
import { useEffect } from 'react';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import { useAppDispatch, useAppSelector } from '../../../hooks/store';
import { selectMyTeam, selectMyTeamError, selectMyTeamStatus } from '../../../store/team/teamSelectors';
import { fetchMyTeam } from '../../../store/team/teamThunks';
import type { TeamMember } from '../../../types/team';
import { shortDate } from '../../../utils/dates';

type Availability = { status: 'error' | 'warning' | 'success'; text: string };

export function availability(m: TeamMember): Availability {
  if (m.leaveToday) {
    const half = m.leaveToday.halfDay ? ` (${m.leaveToday.halfDay} half)` : '';
    return { status: 'error', text: `On leave today${half}` };
  }
  if (m.leaveThisWeek.length) {
    return { status: 'warning', text: `On leave ${m.leaveThisWeek.map(shortDate).join(', ')}` };
  }
  return { status: 'success', text: 'Available' };
}

function MemberCard({ member, highlight = false }: { member: TeamMember; highlight?: boolean }) {
  const { token } = theme.useToken();
  const a = availability(member);
  return (
    <Card
      className="h-full"
      data-testid="team-member"
      style={highlight ? { borderColor: token.colorPrimaryBorder, background: token.colorPrimaryBg } : undefined}
    >
      <div className="flex items-center gap-3">
        <PersonAvatar name={member.name} avatarUrl={member.avatarUrl} size={48} />
        <div className="min-w-0">
          <div className="truncate font-medium">{member.name}</div>
          <div className="truncate text-xs" style={{ color: token.colorTextSecondary }}>
            {[member.jobTitle, member.departmentName].filter(Boolean).join(' · ') || '—'}
          </div>
          <Badge status={a.status} text={<span className="text-xs">{a.text}</span>} />
        </div>
      </div>
    </Card>
  );
}

function Section({ title, members }: { title: string; members: TeamMember[] }) {
  if (members.length === 0) return null;
  return (
    <>
      <h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide opacity-70">
        {title} · {members.length}
      </h3>
      <Row gutter={[16, 16]}>
        {members.map((m) => (
          <Col key={m.id} xs={24} md={12} xl={8}>
            <MemberCard member={m} />
          </Col>
        ))}
      </Row>
    </>
  );
}

export function TeamTab() {
  const dispatch = useAppDispatch();
  const team = useAppSelector(selectMyTeam);
  const status = useAppSelector(selectMyTeamStatus);
  const error = useAppSelector(selectMyTeamError);

  useEffect(() => {
    void dispatch(fetchMyTeam());
  }, [dispatch]);

  if (error) return <Alert type="error" showIcon message={error} />;
  if (!team) return <Skeleton active avatar paragraph={{ rows: 3 }} />;

  const empty = !team.manager && team.peers.length === 0 && team.directReports.length === 0;
  if (empty && status === 'succeeded') {
    return (
      <Card>
        <Empty description="You're not in a team yet. Ask your admin to set your manager." />
      </Card>
    );
  }
  return (
    <div>
      {team.manager ? (
        <>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide opacity-70">My manager</h3>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12} xl={8}>
              <MemberCard member={team.manager} highlight />
            </Col>
          </Row>
        </>
      ) : null}
      <Section title="Teammates" members={team.peers} />
      <Section title="Reporting to me" members={team.directReports} />
    </div>
  );
}
