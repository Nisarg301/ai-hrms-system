import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { ApplyLeaveDrawer } from '../../../components/ApplyLeaveDrawer/ApplyLeaveDrawer';
import { useAppDispatch, useAppSelector } from '../../../hooks/store';
import {
  selectMyBalances,
  selectMyBalancesError,
  selectMyBalancesStatus,
  selectMyLeaveRequests,
  selectMyLeaveRequestsError,
  selectMyLeaveRequestsStatus,
} from '../../../store/leave/leaveSelectors';
import { fetchMyBalances, fetchMyLeaveRequests } from '../../../store/leave/leaveThunks';
import { LeaveBalances } from './LeaveBalances';
import { MyLeaveRequests } from './MyLeaveRequests';

export function LeaveTab() {
  const dispatch = useAppDispatch();
  const balances = useAppSelector(selectMyBalances);
  const balancesStatus = useAppSelector(selectMyBalancesStatus);
  const balancesError = useAppSelector(selectMyBalancesError);
  const requests = useAppSelector(selectMyLeaveRequests);
  const requestsStatus = useAppSelector(selectMyLeaveRequestsStatus);
  const requestsError = useAppSelector(selectMyLeaveRequestsError);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    void dispatch(fetchMyBalances());
    void dispatch(fetchMyLeaveRequests());
  }, [dispatch]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Typography.Title level={5} className="!mb-0">
          My balances · {new Date().getFullYear()}
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setApplying(true)}>
          Apply leave
        </Button>
      </div>
      {balancesError ? <Alert className="mb-4" type="error" showIcon message={balancesError} /> : null}
      <LeaveBalances balances={balances} loading={balancesStatus === 'loading' || balancesStatus === 'idle'} />

      <Card title="My requests">
        {requestsError ? <Alert className="mb-4" type="error" showIcon message={requestsError} /> : null}
        <MyLeaveRequests rows={requests} loading={requestsStatus === 'loading'} />
      </Card>
      <ApplyLeaveDrawer open={applying} onClose={() => setApplying(false)} />
    </>
  );
}
