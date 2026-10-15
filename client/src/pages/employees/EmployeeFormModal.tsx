import { zodResolver } from '@hookform/resolvers/zod';
import { SaveOutlined } from '@ant-design/icons';
import { Alert, DatePicker, Divider, Form, Input, Modal, Select, Switch } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectRoles } from '../../store/roles/rolesSelectors';
import { fetchRoles } from '../../store/roles/rolesThunks';
import { createEmployee, fetchEmployees, updateEmployee } from '../../store/employees/employeesThunks';
import { ApiError } from '../../types/api';
import type { EmployeeRow } from '../../types/employee';
import { applyServerFieldErrors } from '../../utils/applyServerFieldErrors';
import { employeeSchema, type EmployeeFormValues } from '../../validation/employee.schemas';
import { fetchAllDepartments } from '../../store/departments/departmentsThunks';
import { selectAllDepartments } from '../../store/departments/departmentsSelectors';
import { selectPeople } from '../../store/team/teamSelectors';
import { fetchPeople } from '../../store/team/teamThunks';
import { selectLifecycleAdmin } from '../../store/lifecycleAdmin/lifecycleAdminSelectors';
import { fetchTemplates } from '../../store/lifecycleAdmin/lifecycleAdminThunks';
import { ONBOARDING_WINDOW_DAYS } from '../../utils/lifecycleFormat';

interface EmployeeFormModalProps {
  open: boolean;
  /** null means create. */
  employee: EmployeeRow | null;
  onClose: () => void;
}

const EMPTY: EmployeeFormValues = { name: '', email: '', jobTitle: '', department: '', roleId: '', status: undefined, reportsTo: '', joiningDate: '', dateOfBirth: '' };

export function EmployeeFormModal({ open, employee, onClose }: EmployeeFormModalProps) {
  const dispatch = useAppDispatch();
  const roles = useAppSelector(selectRoles);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, reset, setError, formState, watch } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (open) {
      void dispatch(fetchRoles());
      void dispatch(fetchAllDepartments());
      void dispatch(fetchPeople());
      if (!employee) void dispatch(fetchTemplates());
    }
  }, [open, employee, dispatch]);

  // New employees: start onboarding with them (on by default, with the default template).
  const onboardingTemplates = useAppSelector(selectLifecycleAdmin).templates.filter((t) => t.kind === 'onboarding');
  const defaultTemplateId = onboardingTemplates.find((t) => t.isDefault)?.id;
  const [onboard, setOnboard] = useState(true);
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [buddyId, setBuddyId] = useState<string | undefined>();
  const [onboardingErrors, setOnboardingErrors] = useState<Record<string, string>>({});
  const offerOnboarding = !employee && onboardingTemplates.length > 0;
  // Onboarding is for new joiners: not for someone who joined more than a month ago.
  const joiningDate = watch('joiningDate');
  const tooLongAgo = Boolean(joiningDate) && dayjs(joiningDate).isBefore(dayjs().subtract(ONBOARDING_WINDOW_DAYS, 'day'), 'day');
  const willOnboard = offerOnboarding && onboard && !tooLongAgo;
  useEffect(() => {
    if (!open) return;
    setOnboard(true);
    setTemplateId(undefined);
    setBuddyId(undefined);
    setOnboardingErrors({});
  }, [open]);
  useEffect(() => {
    if (open) setTemplateId((current) => current ?? defaultTemplateId);
  }, [open, defaultTemplateId]);
  const departments = useAppSelector(selectAllDepartments);
  // Anyone active can be a manager, except the employee themselves.
  const people = useAppSelector(selectPeople);
  const managerOptions = people.filter((p) => p.id !== employee?.id).map((p) => ({ value: p.id, label: p.jobTitle ? `${p.name} · ${p.jobTitle}` : p.name }));
  // A current manager who has since been disabled isn't in the list; still show their name.
  if (employee?.reportsTo && !people.some((p) => p.id === employee.reportsTo)) {
    managerOptions.push({ value: employee.reportsTo, label: `${employee.reportsToName ?? 'Former member'} (inactive)` });
  }

  useEffect(() => {
    if (!open) return;
    reset(
      employee
        ? {
          name: employee.name,
          email: employee.email,
          jobTitle: employee.jobTitle,
          department: employee.department ?? '',
          roleId: employee.roleId ?? '',
          status: employee.status,
          reportsTo: employee.reportsTo ?? '',
          joiningDate: employee.joiningDate ?? '',
          dateOfBirth: employee.dateOfBirth ?? '',
        }
        : EMPTY
    );
    setServerError(null);
  }, [open, employee, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);
    const result = employee
      ? await dispatch(
        updateEmployee({
          id: employee.id,
          payload: {
            name: values.name,
            email: values.email,
            jobTitle: values.jobTitle,
            department: values.department,
            roleId: values.roleId,
            status: values.status,
            reportsTo: values.reportsTo || null,
            ...(values.joiningDate ? { joiningDate: values.joiningDate } : {}),
            dateOfBirth: values.dateOfBirth || null,
          },
        })
      )
      : await dispatch(
        createEmployee({
          name: values.name,
          email: values.email,
          jobTitle: values.jobTitle,
          department: values.department,
          roleId: values.roleId,
          ...(values.reportsTo ? { reportsTo: values.reportsTo } : {}),
          ...(values.joiningDate ? { joiningDate: values.joiningDate } : {}),
          ...(values.dateOfBirth ? { dateOfBirth: values.dateOfBirth } : {}),
          ...(willOnboard && templateId ? { onboarding: { templateId, buddyId: buddyId ?? null } } : {}),
        })
      );
    setSubmitting(false);

    const rejected = employee ? updateEmployee.rejected.match(result) : createEmployee.rejected.match(result);
    if (rejected) {
      const payload = (result as { payload?: { status: number; message: string; details?: unknown } }).payload;
      const reconstructed = payload ? new ApiError(payload.status, payload.message, payload.details) : new ApiError(0, 'Could not save the employee');
      const setFormFieldError = setError as (field: string, error: { type: string; message: string }) => void;
      const placed = applyServerFieldErrors(reconstructed, setFormFieldError, ['name', 'email', 'jobTitle', 'department', 'roleId', 'reportsTo', 'joiningDate', 'dateOfBirth']);
      // The onboarding fields live outside the form.
      const fieldErrors = (payload?.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};
      const onboardingProblems = Object.fromEntries(['templateId', 'buddyId'].filter((f) => fieldErrors[f]).map((f) => [f, fieldErrors[f][0]]));
      setOnboardingErrors(onboardingProblems);
      if (!placed && !Object.keys(onboardingProblems).length) {
        setServerError(reconstructed.message);
      }
      return;
    }

    await dispatch(fetchEmployees());
    reset(EMPTY);
    onClose();
  });

  return (
    <Modal
      open={open}
      title={employee ? 'Edit employee' : 'Add employee'}
      okText="Save"
      onOk={onSubmit}
      okButtonProps={{ icon: <SaveOutlined /> }}
      confirmLoading={submitting}
      onCancel={() => {
        setServerError(null);
        onClose();
      }}
      destroyOnHidden
    >
      <Form layout="vertical">
        {serverError ? <Alert className="mb-4" type="error" message={serverError} showIcon /> : null}

        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <Form.Item label="Name" htmlFor="name" validateStatus={formState.errors.name ? 'error' : ''} help={formState.errors.name?.message}>
              <Input {...field} id="name" />
            </Form.Item>
          )}
        />
        <Controller
          name="email"
          control={control}
          render={({ field }) => (
            <Form.Item label="Email" htmlFor="email" validateStatus={formState.errors.email ? 'error' : ''} help={formState.errors.email?.message}>
              <Input {...field} id="email" type="email" />
            </Form.Item>
          )}
        />
        <Controller
          name="jobTitle"
          control={control}
          render={({ field }) => (
            <Form.Item label="Job title" htmlFor="jobTitle" validateStatus={formState.errors.jobTitle ? 'error' : ''} help={formState.errors.jobTitle?.message}>
              <Input {...field} id="jobTitle" />
            </Form.Item>
          )}
        />

        <Controller
          name="roleId"
          control={control}
          render={({ field }) => (
            <Form.Item label="Role" htmlFor="roleId" validateStatus={formState.errors.roleId ? 'error' : ''} help={formState.errors.roleId?.message}>
              <Select
                {...field}
                id="roleId"
                showSearch
                optionFilterProp="label"
                placeholder="Select a role"
                options={roles.map((role) => ({ value: role.id, label: role.name }))}
              />
            </Form.Item>
          )}
        />

        <Controller
          name="department"
          control={control}
          render={({ field }) => (
            <Form.Item label="Department" htmlFor="department" validateStatus={formState.errors.department ? 'error' : ''} help={formState.errors.department?.message}>
              <Select
                {...field}
                id="department"
                placeholder="Select a department"
                options={departments.map((department) => ({ value: department.id, label: department.title }))}
              />
            </Form.Item>
          )}
        />

        <Controller
          name="reportsTo"
          control={control}
          render={({ field }) => (
            <Form.Item label="Reports to" htmlFor="reportsTo" validateStatus={formState.errors.reportsTo ? 'error' : ''} help={formState.errors.reportsTo?.message}>
              <Select
                id="reportsTo"
                showSearch
                allowClear
                optionFilterProp="label"
                placeholder="No manager"
                value={field.value || undefined}
                onChange={(v) => field.onChange(v ?? '')}
                options={managerOptions}
              />
            </Form.Item>
          )}
        />

        <Controller
          name="joiningDate"
          control={control}
          render={({ field }) => (
            <Form.Item
              label="Date of joining"
              htmlFor="joiningDate"
              validateStatus={formState.errors.joiningDate ? 'error' : ''}
              help={formState.errors.joiningDate?.message ?? (employee ? undefined : 'Leave empty to use today.')}
            >
              <DatePicker
                id="joiningDate"
                className="w-full"
                format={['DD MMM YYYY', 'YYYY-MM-DD']}
                value={field.value ? dayjs(field.value) : null}
                onChange={(d) => field.onChange(d ? d.format('YYYY-MM-DD') : '')}
              />
            </Form.Item>
          )}
        />

        <Controller
          name="dateOfBirth"
          control={control}
          render={({ field }) => (
            <Form.Item
              label="Date of birth (optional)"
              htmlFor="dateOfBirth"
              validateStatus={formState.errors.dateOfBirth ? 'error' : ''}
              help={formState.errors.dateOfBirth?.message ?? 'Colleagues only ever see the day and month.'}
            >
              <DatePicker
                id="dateOfBirth"
                className="w-full"
                format={['DD MMM YYYY', 'YYYY-MM-DD']}
                disabledDate={(d) => d.isAfter(dayjs(), 'day')}
                value={field.value ? dayjs(field.value) : null}
                onChange={(d) => field.onChange(d && !d.isAfter(dayjs(), 'day') ? d.format('YYYY-MM-DD') : '')}
              />
            </Form.Item>
          )}
        />

        {offerOnboarding ? (
          <>
            <Divider className="!my-3" />
            <Form.Item
              label="Start onboarding"
              htmlFor="startOnboarding"
              extra={
                tooLongAgo
                  ? `Onboarding is for new joiners. This joining date is more than ${ONBOARDING_WINDOW_DAYS} days ago.`
                  : 'Checklist tasks for them, their manager, their buddy and the admins.'
              }
            >
              <Switch id="startOnboarding" checked={willOnboard} disabled={tooLongAgo} onChange={setOnboard} />
            </Form.Item>
            {willOnboard ? (
              <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                <Form.Item
                  label="Onboarding template"
                  htmlFor="onboardingTemplate"
                  validateStatus={onboardingErrors.templateId ? 'error' : ''}
                  help={onboardingErrors.templateId}
                >
                  <Select
                    id="onboardingTemplate"
                    value={templateId}
                    onChange={setTemplateId}
                    options={onboardingTemplates.map((t) => ({ value: t.id, label: `${t.name}${t.isDefault ? ' (default)' : ''}` }))}
                  />
                </Form.Item>
                <Form.Item label="Buddy (optional)" htmlFor="onboardingBuddy" validateStatus={onboardingErrors.buddyId ? 'error' : ''} help={onboardingErrors.buddyId}>
                  <Select
                    id="onboardingBuddy"
                    showSearch
                    allowClear
                    optionFilterProp="label"
                    placeholder="No buddy"
                    value={buddyId}
                    onChange={setBuddyId}
                    options={people.map((p) => ({ value: p.id, label: p.jobTitle ? `${p.name} · ${p.jobTitle}` : p.name }))}
                  />
                </Form.Item>
              </div>
            ) : null}
          </>
        ) : null}

        {employee ? (
          <Controller
            name="status"
            control={control}
            render={({ field }) => (
              <Form.Item label="Status" htmlFor="status">
                <Select
                  {...field}
                  id="status"
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'disabled', label: 'Disabled' },
                  ]}
                />
              </Form.Item>
            )}
          />
        ) : null}
      </Form>
    </Modal>
  );
}
