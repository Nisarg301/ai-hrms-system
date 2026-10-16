import { Alert, Form, Input, Modal } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { PermissionMatrix } from '../../components/PermissionMatrix/PermissionMatrix';
import {
  emptyMatrix,
  entriesToMatrix,
  matrixToEntries,
} from '../../components/PermissionMatrix/permissionMatrix.logic';
import { MODULES } from '../../constants/modules';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectPlanModules } from '../../store/auth/authSelectors';
import { createRole, fetchRoles, updateRole } from '../../store/roles/rolesThunks';
import type { PermissionMatrixValue, Role } from '../../types/role';

interface RoleFormModalProps {
  open: boolean;
  /** null means create. */
  role: Role | null;
  onClose: () => void;
}

export function RoleFormModal({ open, role, onClose }: RoleFormModalProps) {
  const dispatch = useAppDispatch();
  // Only modules in the organization's plan can be granted. Rows for modules the
  // plan hides (e.g. Exports after a downgrade) are kept by the backend on save.
  const planModules = useAppSelector(selectPlanModules) ?? MODULES;
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<PermissionMatrixValue>(emptyMatrix());
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? '');
    setMatrix(role ? entriesToMatrix(role.permissions) : emptyMatrix());
    setNameError(null);
    setServerError(null);
  }, [open, role]);

  const onSubmit = async () => {
    if (name.trim().length === 0) {
      setNameError('Role name is required');
      return;
    }
    setNameError(null);
    setServerError(null);
    setSubmitting(true);

    // Modules without read grant nothing, so they are omitted rather than sent
    // as all-false rows.
    const permissions = matrixToEntries(matrix, planModules);
    const result = role
      ? await dispatch(updateRole({ id: role.id, payload: { name, permissions } }))
      : await dispatch(createRole({ name, permissions }));
    setSubmitting(false);

    const failed = role ? updateRole.rejected.match(result) : createRole.rejected.match(result);
    if (failed) {
      const payload = (result as { payload?: string }).payload;
      setServerError(payload ?? 'Could not save the role');
      return;
    }

    await dispatch(fetchRoles());
    onClose();
  };

  return (
    <Modal
      open={open}
      title={role ? 'Edit role' : 'Create role'}
      okText="Save"
      onOk={onSubmit}
      okButtonProps={{ icon: <SaveOutlined /> }}
      confirmLoading={submitting}
      onCancel={onClose}
      width={760}
      destroyOnHidden
    >
      <Form layout="vertical">
        {serverError ? <Alert className="mb-4" type="error" message={serverError} showIcon /> : null}

        <Form.Item
          label="Role name"
          htmlFor="roleName"
          validateStatus={nameError ? 'error' : ''}
          help={nameError ?? undefined}
        >
          <Input id="roleName" value={name} onChange={(event) => setName(event.target.value)} />
        </Form.Item>

        <Form.Item label="Permissions">
          <PermissionMatrix value={matrix} onChange={setMatrix} modules={planModules} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
