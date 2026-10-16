import { Modal } from 'antd';

interface ConfirmOptions {
  title: string;
  content: string;
  okText?: string;
  onConfirm: () => void | Promise<void>;
}

export function confirmAction({ title, content, okText = 'Confirm', onConfirm }: ConfirmOptions): void {
  Modal.confirm({
    title,
    content,
    okText,
    okButtonProps: { danger: true },
    cancelText: 'Cancel',
    onOk: onConfirm,
  });
}
