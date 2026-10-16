import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../../hooks/store';
import { selectAuthUser } from '../../store/auth/authSelectors';
import { landingPath } from '../../routes/landingPath';

// Every org member has Home, so reaching this page always means following a link
// to a screen the user's role or plan doesn't include.
export default function UnauthorizedPage() {
  const user = useAppSelector(selectAuthUser);
  const navigate = useNavigate();

  return (
    <Result
      status="403"
      title="Unauthorized"
      subTitle="You do not have permission to view this page."
      extra={
        user ? (
          <Button type="primary" onClick={() => navigate(landingPath(user), { replace: true })}>
            Back to your home page
          </Button>
        ) : null
      }
    />
  );
}
