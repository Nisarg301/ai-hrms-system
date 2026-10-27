import { Form, Input } from 'antd';
import { useMemo } from 'react';
import { MODULES } from '../../constants/modules';
import { useAppSelector } from '../../hooks/store';
import { selectPlanModules } from '../../store/auth/authSelectors';
import type { AiRoleFormValues } from '../../types/ai';
import { PermissionMatrix } from '../PermissionMatrix/PermissionMatrix';
import { entriesToMatrix, matrixToEntries } from '../PermissionMatrix/permissionMatrix.logic';

/** The same rule as the Roles page form: a name is required. */
export function validateRoleValues(values: AiRoleFormValues): Record<string, string> {
  return values.name.trim() ? {} : { name: 'Role name is required' };
}

interface AiRoleFormProps {
  values: AiRoleFormValues;
  errors: Record<string, string>;
  onChange: (values: AiRoleFormValues) => void;
}

/** The confirm card's editable role: its name and the page's permission matrix, for the plan's modules. */
export function AiRoleForm({ values, errors, onChange }: AiRoleFormProps) {
  const planModules = useAppSelector(selectPlanModules) ?? MODULES;
  const matrix = useMemo(() => entriesToMatrix(values.permissions), [values.permissions]);

  return (
    <Form layout="vertical" size="small" component="div">
      <Form.Item label="Role name" htmlFor="ai-role-name" validateStatus={errors.name ? 'error' : undefined} help={errors.name} className="!mb-2">
        <Input id="ai-role-name" value={values.name} onChange={(e) => onChange({ ...values, name: e.target.value })} />
      </Form.Item>
      <Form.Item label="Permissions" className="!mb-2">
        {/* Six columns don't fit a narrow drawer: the matrix scrolls on its own. */}
        <div className="overflow-x-auto">
          <PermissionMatrix value={matrix} onChange={(next) => onChange({ ...values, permissions: matrixToEntries(next, planModules) })} modules={planModules} />
        </div>
      </Form.Item>
    </Form>
  );
}
