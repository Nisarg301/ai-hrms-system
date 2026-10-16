import { EditOutlined } from '@ant-design/icons';
import { Button, DatePicker, message, Space, theme } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { getMyDetailsRequest, updateMyDetailsRequest } from '../../../services/endpoints/me.endpoints';
import { ApiError } from '../../../types/api';
import { leaveErrorMessage } from '../../../components/ApplyLeaveDrawer/ApplyLeaveDrawer';

/** My own date of birth, which I can set or clear. Colleagues only see the day and month. */
export function MyDateOfBirth() {
  const { token } = theme.useToken();
  const [value, setValue] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    getMyDetailsRequest()
      .then(({ data }) => current && setValue(data.dateOfBirth))
      .catch(() => current && setValue(null));
    return () => {
      current = false;
    };
  }, []);

  const save = async (next: string | null) => {
    setSaving(true);
    try {
      const { data } = await updateMyDetailsRequest({ dateOfBirth: next });
      setValue(data.dateOfBirth);
      setEditing(false);
      void message.success(next ? 'Date of birth saved' : 'Date of birth removed');
    } catch (err) {
      void message.error(leaveErrorMessage(err instanceof ApiError ? err : new ApiError(0, 'Could not save')));
    } finally {
      setSaving(false);
    }
  };

  if (value === undefined) return <span>…</span>;

  if (editing) {
    return (
      <Space wrap>
        <DatePicker
          aria-label="Date of birth"
          format={['DD MMM YYYY', 'YYYY-MM-DD']}
          disabledDate={(d) => d.isAfter(dayjs(), 'day')}
          value={draft ? dayjs(draft) : null}
          onChange={(d) => setDraft(d && !d.isAfter(dayjs(), 'day') ? d.format('YYYY-MM-DD') : null)}
        />
        <Button type="primary" size="small" loading={saving} disabled={!draft} onClick={() => save(draft)}>
          Save
        </Button>
        {value ? (
          <Button size="small" danger disabled={saving} onClick={() => save(null)}>
            Remove
          </Button>
        ) : null}
        <Button size="small" type="text" disabled={saving} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </Space>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>{value ? dayjs(value).format('DD MMM YYYY') : 'Not set'}</span>
      <Button
        size="small"
        type="link"
        icon={<EditOutlined />}
        aria-label={value ? 'Change date of birth' : 'Add date of birth'}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {value ? 'Change' : 'Add'}
      </Button>
      <span className="w-full text-xs" style={{ color: token.colorTextSecondary }}>
        Colleagues see only the day and month, to wish you on your birthday.
      </span>
    </span>
  );
}
