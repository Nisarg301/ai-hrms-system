import { Alert, Button, Card, Col, Row, Skeleton } from 'antd';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectAuthUser } from '../../store/auth/authSelectors';
import { selectIntroductions, selectIntroductionsError, selectIntroductionsStatus } from '../../store/people/peopleSelectors';
import { fetchIntroductions } from '../../store/people/peopleThunks';
import { IntroductionsGrid } from './components/IntroductionsGrid';
import { MyIntroductionCard } from './components/MyIntroductionCard';
import { NewJoinersStrip } from './components/NewJoinersStrip';

export function WelcomeTab() {
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectAuthUser)!;
  const people = useAppSelector(selectIntroductions);
  const status = useAppSelector(selectIntroductionsStatus);
  const error = useAppSelector(selectIntroductionsError);

  useEffect(() => {
    void dispatch(fetchIntroductions());
  }, [dispatch]);

  const newJoiners = people.filter((p) => p.isNewJoiner);

  return (
    <Row gutter={16}>
      <Col xs={24} xl={8}>
        <MyIntroductionCard />
      </Col>
      <Col xs={24} xl={16}>
        {error ? (
          <Alert
            type="error"
            showIcon
            message={error}
            action={
              <Button size="small" onClick={() => dispatch(fetchIntroductions())}>
                Retry
              </Button>
            }
          />
        ) : status !== 'succeeded' && people.length === 0 ? (
          <Card>
            <Skeleton active avatar />
          </Card>
        ) : (
          <>
            <NewJoinersStrip people={newJoiners} today={dayjs().format('YYYY-MM-DD')} />
            <IntroductionsGrid people={people} myId={user.id} />
          </>
        )}
      </Col>
    </Row>
  );
}
