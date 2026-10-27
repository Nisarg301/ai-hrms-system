import { DatePicker, Form, Input, Select } from 'antd';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectAllDepartments } from '../../store/departments/departmentsSelectors';
import { fetchAllDepartments } from '../../store/departments/departmentsThunks';
import { selectRoles } from '../../store/roles/rolesSelectors';
import { fetchRoles } from '../../store/roles/rolesThunks';
import { selectPeople } from '../../store/team/teamSelectors';
import { fetchPeople } from '../../store/team/teamThunks';
import type { AiEmployeeFormValues } from '../../types/ai';
import { employeeSchema } from '../../validation/employee.schemas';

/** The same rules as the Employees page form; returns the first error per field. */
export function validateEmployeeValues(values: AiEmployeeFormValues): Record<string, string> {
  const parsed = employeeSchema.safeParse(values);
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0]);
    errors[key] ??= issue.message;
  }
  return errors;
}

interface AiEmployeeFormProps {
  mode: 'create' | 'update';
  values: AiEmployeeFormValues;
  errors: Record<string, string>;
  onChange: (values: AiEmployeeFormValues) => void;
}

/** The confirm card's editable employee fields: department, role and manager are real records. */
export function AiEmployeeForm({ mode, values, errors, onChange }: AiEmployeeFormProps) {
  const dispatch = useAppDispatch();
  const departments = useAppSelector(selectAllDepartments);
  const roles = useAppSelector(selectRoles);
  const people = useAppSelector(selectPeople);

  useEffect(() => {
    void dispatch(fetchAllDepartments());
    void dispatch(fetchRoles());
    void dispatch(fetchPeople());
  }, [dispatch]);

  const set = <K extends keyof AiEmployeeFormValues>(key: K, value: AiEmployeeFormValues[K]) => onChange({ ...values, [key]: value });
  const item = (key: keyof AiEmployeeFormValues, label: string) => ({
    label,
    htmlFor: `ai-${key}`,
    validateStatus: errors[key] ? ('error' as const) : undefined,
    help: errors[key],
    className: '!mb-2',
  });

  return (
    <Form layout="vertical" size="small" component="div">
      <Form.Item {...item('name', 'Name')}>
        <Input id="ai-name" value={values.name} onChange={(e) => set('name', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('email', 'Email')}>
        <Input id="ai-email" type="email" value={values.email} onChange={(e) => set('email', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('jobTitle', 'Job title')}>
        <Input id="ai-jobTitle" value={values.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
      </Form.Item>
      <Form.Item {...item('department', 'Department')}>
        <Select
          id="ai-department"
          showSearch
          optionFilterProp="label"
          placeholder="Select a department"
          value={values.department || undefined}
          onChange={(v) => set('department', v ?? '')}
          options={departments.map((d) => ({ value: d.id, label: d.title }))}
        />
      </Form.Item>
      <Form.Item {...item('roleId', 'Role')}>
        <Select
          id="ai-roleId"
          showSearch
          optionFilterProp="label"
          placeholder="Select a role"
          value={values.roleId || undefined}
          onChange={(v) => set('roleId', v ?? '')}
          options={roles.map((r) => ({ value: r.id, label: r.name }))}
        />
      </Form.Item>
      <Form.Item {...item('reportsTo', 'Reports to')}>
        <Select
          id="ai-reportsTo"
          showSearch
          allowClear
          optionFilterProp="label"
          placeholder="No manager"
          value={values.reportsTo || undefined}
          onChange={(v) => set('reportsTo', v ?? '')}
          options={people.map((p) => ({ value: p.id, label: p.jobTitle ? `${p.name} · ${p.jobTitle}` : p.name }))}
        />
      </Form.Item>
      <Form.Item {...item('joiningDate', 'Date of joining')} help={errors.joiningDate ?? (mode === 'create' ? 'Leave empty to use today.' : undefined)}>
        <DatePicker
          id="ai-joiningDate"
          className="w-full"
          format={['DD MMM YYYY', 'YYYY-MM-DD']}
          value={values.joiningDate ? dayjs(values.joiningDate) : null}
          onChange={(d) => set('joiningDate', d ? d.format('YYYY-MM-DD') : '')}
        />
      </Form.Item>
      <Form.Item {...item('dateOfBirth', 'Date of birth (optional)')}>
        <DatePicker
          id="ai-dateOfBirth"
          className="w-full"
          format={['DD MMM YYYY', 'YYYY-MM-DD']}
          disabledDate={(d) => d.isAfter(dayjs(), 'day')}
          value={values.dateOfBirth ? dayjs(values.dateOfBirth) : null}
          onChange={(d) => set('dateOfBirth', d ? d.format('YYYY-MM-DD') : '')}
        />
      </Form.Item>
      {mode === 'update' ? (
        <Form.Item {...item('status', 'Status')}>
          <Select
            id="ai-status"
            value={values.status}
            onChange={(v) => set('status', v)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'disabled', label: 'Disabled (cannot sign in)' },
            ]}
          />
        </Form.Item>
      ) : null}
    </Form>
  );
}
