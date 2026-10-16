import { Alert, Modal, Typography } from 'antd';
import { CheckOutlined } from '@ant-design/icons';

interface TempPasswordModalProps {
  open: boolean;
  password: string | null;
  onClose: () => void;
}

/**
 * The invite endpoints return the temporary password exactly once and it is
 * unrecoverable afterward, so this is the only chance to hand it over. Never
 * logged, never persisted.
 */
export function TempPasswordModal({ open, password, onClose }: TempPasswordModalProps) {
  return (
    <Modal
      open={open && password !== null}
      title="Invitation sent"
      onOk={onClose}
      onCancel={onClose}
      okText="Done"
      okButtonProps={{ icon: <CheckOutlined /> }}
      cancelButtonProps={{ style: { display: 'none' } }}
      maskClosable={false}
    >
      <Alert
        className="mb-4"
        type="warning"
        showIcon
        message="Copy this temporary password now — it will not be shown again."
      />
      <Typography.Paragraph copyable={{ text: password ?? '' }} className="break-all">
        <code>{password}</code>
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        The invited user must sign in with this password and will be required to change it immediately.
      </Typography.Paragraph>
    </Modal>
  );
}
