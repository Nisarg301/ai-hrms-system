import { Card, Col, Row, Tag, theme } from 'antd';
import { PersonAvatar } from '../../../components/PersonAvatar/PersonAvatar';
import type { IntroductionCard } from '../../../types/people';
import { EmptyNote } from './HomeCard';
import { INTRODUCTION_QUESTIONS } from './introductionQuestions';

export function IntroductionsGrid({ people, myId }: { people: IntroductionCard[]; myId: string }) {
  const { token } = theme.useToken();
  // New joiners who haven't written anything yet are in the strip above, not here.
  const cards = people.filter((p) => p.hasIntroduction);
  if (cards.length === 0) {
    return (
      <Card>
        <EmptyNote>No introductions yet. Yours could be the first!</EmptyNote>
      </Card>
    );
  }
  return (
    <Row gutter={[16, 16]}>
      {cards.map((p) => (
        <Col key={p.id} xs={24} md={12} xl={8}>
          <Card className="h-full" data-testid="introduction-card">
            <div className="mb-3 flex items-center gap-3">
              <PersonAvatar name={p.name} avatarUrl={p.avatarUrl} size={48} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{p.name}</span>
                  {p.id === myId ? <Tag className="!mr-0">You</Tag> : null}
                  {p.isNewJoiner ? (
                    <Tag color="green" className="!mr-0">
                      New
                    </Tag>
                  ) : null}
                </div>
                <div className="truncate text-xs" style={{ color: token.colorTextSecondary }}>
                  {[p.jobTitle, p.departmentName].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {INTRODUCTION_QUESTIONS.filter((q) => p.introduction[q.key]).map((q) => (
                <div key={q.key}>
                  <div className="text-xs font-medium uppercase tracking-wide" style={{ color: token.colorPrimary }}>
                    {q.title}
                  </div>
                  <div className="whitespace-pre-line text-sm">{p.introduction[q.key]}</div>
                </div>
              ))}
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
}
