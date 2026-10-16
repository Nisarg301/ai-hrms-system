import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Form, Input, Modal, Radio, Select } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectOrganizations } from '../../store/adminUsers/adminUsersSelectors';
import { fetchAdminUsers, fetchOrganizations, inviteOrgAdmin } from '../../store/adminUsers/adminUsersThunks';
import { ApiError } from '../../types/api';
import type { InviteOrgAdminPayload } from '../../types/adminUser';
import { applyServerFieldErrors } from '../../utils/applyServerFieldErrors';
import { inviteOrgAdminSchema, type InviteOrgAdminFormValues } from '../../validation/invite.schemas';

interface InviteOrgAdminModalProps {
  open: boolean;
  onClose: () => void;
}

export function InviteOrgAdminModal({ open, onClose }: InviteOrgAdminModalProps) {
  const dispatch = useAppDispatch();
  const organizations = useAppSelector(selectOrganizations);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, watch, reset, setError, formState } = useForm<InviteOrgAdminFormValues>({
    resolver: zodResolver(inviteOrgAdminSchema),
    defaultValues: { mode: 'new', name: '', email: '', organizationName: '' },
  });

  const mode = watch('mode');

  useEffect(() => {
    if (open) {
      void dispatch(fetchOrganizations());
    }
  }, [open, dispatch]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);

    const payload: InviteOrgAdminPayload =
      values.mode === 'new'
        ? { name: values.name, email: values.email, organizationName: values.organizationName }
        : { name: values.name, email: values.email, organizationId: values.organizationId };

    const result = await dispatch(inviteOrgAdmin(payload));
    setSubmitting(false);

    if (inviteOrgAdmin.rejected.match(result)) {
      // RTK's own `result.error` is always its generic serialized placeholder
      // (`{ message: 'Rejected' }`) — never the real thrown error — so the
      // only path back to the real status/details is `result.payload`, which
      // the thunk populates via `rejectWithValue(toFieldAwareError(err))`.
      // Rebuild a real ApiError from it so applyServerFieldErrors can do its
      // `instanceof ApiError` + `status === 400` check.
      const payload = result.payload;
      const reconstructed = payload
        ? new ApiError(payload.status, payload.message, payload.details)
        : new ApiError(0, 'Could not send the invite');

      // A 400 carries per-field messages; put them on the fields. Anything else
      // (409 duplicate email, 403, network) has no field to attach to.
      //
      // setError's type is narrowed by RHF to the discriminated union's field
      // names (mode-dependent), while applyServerFieldErrors is intentionally
      // generic (string field names) so it can be reused by any form (Task 19).
      // The cast is safe: knownFields below only ever names real fields of this form.
      const setFormFieldError = setError as (field: string, error: { type: string; message: string }) => void;
      const placedOnFields = applyServerFieldErrors(reconstructed, setFormFieldError, ['name', 'email', 'organizationName']);
      if (!placedOnFields) {
        setServerError(reconstructed.message);
      }
      return;
    }

    // The new admin must appear in the list right away.
    await dispatch(fetchAdminUsers());
    reset({ mode: 'new', name: '', email: '', organizationName: '' });
    onClose();
  });

  return (
    <Modal
      open={open}
      title="Invite Organization Admin"
      okText="Send invite"
      onOk={onSubmit}
      okButtonProps={{ icon: <SendOutlined /> }}
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
          name="mode"
          control={control}
          render={({ field }) => (
            <Form.Item>
              <Radio.Group {...field}>
                <Radio value="new">New organization</Radio>
                <Radio value="existing">Existing organization</Radio>
              </Radio.Group>
            </Form.Item>
          )}
        />

        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <Form.Item
              label="Name"
              htmlFor="name"
              validateStatus={formState.errors.name ? 'error' : ''}
              help={formState.errors.name?.message}
            >
              <Input {...field} id="name" />
            </Form.Item>
          )}
        />

        <Controller
          name="email"
          control={control}
          render={({ field }) => (
            <Form.Item
              label="Email"
              htmlFor="email"
              validateStatus={formState.errors.email ? 'error' : ''}
              help={formState.errors.email?.message}
            >
              <Input {...field} id="email" type="email" />
            </Form.Item>
          )}
        />

        {mode === 'new' ? (
          <Controller
            name="organizationName"
            control={control}
            render={({ field }) => (
              <Form.Item
                label="New organization name"
                htmlFor="organizationName"
                validateStatus={'organizationName' in formState.errors && formState.errors.organizationName ? 'error' : ''}
                help={'organizationName' in formState.errors ? formState.errors.organizationName?.message : undefined}
              >
                <Input {...field} id="organizationName" />
              </Form.Item>
            )}
          />
        ) : (
          <Controller
            name="organizationId"
            control={control}
            render={({ field }) => (
              <Form.Item
                label="Organization"
                htmlFor="organizationId"
                validateStatus={'organizationId' in formState.errors && formState.errors.organizationId ? 'error' : ''}
                help={'organizationId' in formState.errors ? formState.errors.organizationId?.message : undefined}
              >
                <Select
                  {...field}
                  id="organizationId"
                  showSearch
                  optionFilterProp="label"
                  placeholder="Select an organization"
                  options={organizations.map((org) => ({ value: org.id, label: org.name }))}
                />
              </Form.Item>
            )}
          />
        )}
      </Form>
    </Modal>
  );
}
