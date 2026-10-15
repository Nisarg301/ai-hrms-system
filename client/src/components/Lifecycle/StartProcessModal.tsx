import { Alert, DatePicker, Form, Input, message, Modal, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { getCandidatesRequest } from '../../services/endpoints/lifecycle.endpoints';
import { selectLifecycleAdmin } from '../../store/lifecycleAdmin/lifecycleAdminSelectors';
import { fetchTemplates, startOffboarding, startOnboarding } from '../../store/lifecycleAdmin/lifecycleAdminThunks';
import { selectPeople } from '../../store/team/teamSelectors';
import { fetchPeople } from '../../store/team/teamThunks';
import type { LifecycleKind, OffboardingReason, ProcessDetail } from '../../types/lifecycle';
import type { Person } from '../../types/people';
import { ONBOARDING_WINDOW_DAYS, REASON_LABEL } from '../../utils/lifecycleFormat';

const MAX_NOTICE_DAYS = 180;

interface StartProcessModalProps {
  kind: LifecycleKind;
  open: boolean;
  /** Starting it for a given person (from the Employees page): they can't be changed. */
  employeeId?: string | null;
  onClose: () => void;
  onStarted?: (process: ProcessDetail) => void;
}

/** Starts onboarding (template, buddy) or offboarding (last day, reason, notes, template) for someone. */
export function StartProcessModal({ kind, open, employeeId: preset = null, onClose, onStarted }: StartProcessModalProps) {
  const dispatch = useAppDispatch();
  const people = useAppSelector(selectPeople);
  const { templates } = useAppSelector(selectLifecycleAdmin);
  const ofKind = templates.filter((t) => t.kind === kind);
  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [buddyId, setBuddyId] = useState<string | undefined>();
  const [lastDay, setLastDay] = useState<string | null>(null);
  const [reason, setReason] = useState<OffboardingReason | undefined>();
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Who it can be started for (the server's rule): null while loading. */
  const [candidates, setCandidates] = useState<Person[] | null>(null);

  useEffect(() => {
    if (!open || preset) return;
    let cancelled = false;
    setCandidates(null);
    getCandidatesRequest(kind)
      .then(({ data }) => {
        if (!cancelled) setCandidates(data);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, preset, kind]);

  useEffect(() => {
    if (!open) return;
    void dispatch(fetchPeople());
    void dispatch(fetchTemplates());
    setEmployeeId(preset ?? undefined);
    setBuddyId(undefined);
    setLastDay(null);
    setReason(undefined);
    setNotes('');
    setErrors({});
    setServerError(null);
  }, [open, preset, dispatch]);

  // Preselect the default template once the templates are in.
  const defaultId = ofKind.find((t) => t.isDefault)?.id;
  useEffect(() => {
    if (open) setTemplateId((current) => current ?? defaultId);
  }, [open, defaultId]);
  useEffect(() => {
    if (!open) setTemplateId(undefined);
  }, [open]);

  const outOfRange = (d: Dayjs) => d.isBefore(dayjs(), 'day') || d.isAfter(dayjs().add(MAX_NOTICE_DAYS, 'day'), 'day');
  const person = people.find((p) => p.id === employeeId);
  const options = (list: Person[], exclude?: string) =>
    list.filter((p) => p.id !== exclude).map((p) => ({ value: p.id, label: p.jobTitle ? `${p.name} · ${p.jobTitle}` : p.name }));

  const onOk = async () => {
    const problems: Record<string, string> = {};
    if (!employeeId) problems.employeeId = 'Choose the person';
    if (!templateId) problems.templateId = 'Choose a template';
    if (kind === 'offboarding') {
      if (!lastDay) problems.lastWorkingDay = 'Choose the last working day';
      if (!reason) problems.reason = 'Choose a reason';
    }
    setErrors(problems);
    if (Object.keys(problems).length) return;

    setSaving(true);
    setServerError(null);
    const result =
      kind === 'onboarding'
        ? await dispatch(startOnboarding({ employeeId: employeeId!, templateId: templateId!, buddyId: buddyId ?? null }))
        : await dispatch(startOffboarding({ employeeId: employeeId!, templateId: templateId!, lastWorkingDay: lastDay!, reason: reason!, adminNotes: notes.trim() }));
    setSaving(false);
    if (startOnboarding.rejected.match(result) || startOffboarding.rejected.match(result)) {
      const fieldErrors = (result.payload?.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};
      const known = Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v[0]]));
      setErrors(known);
      if (!Object.keys(known).length) setServerError(result.payload?.message ?? `Could not start the ${kind}`);
      return;
    }
    void message.success(`${kind === 'onboarding' ? 'Onboarding' : 'Offboarding'} started for ${result.payload.employee?.name ?? 'them'}`);
    onStarted?.(result.payload);
    onClose();
  };

  const item = (name: string) => (errors[name] ? { validateStatus: 'error' as const, help: errors[name] } : {});

  return (
    <Modal
      open={open}
      title={kind === 'onboarding' ? 'Start onboarding' : `Start offboarding${preset && person ? ` for ${person.name}` : ''}`}
      okText="Start"
      onOk={onOk}
      confirmLoading={saving}
      onCancel={onClose}
      destroyOnHidden
    >
      {serverError ? <Alert className="mb-3" type="error" showIcon message={serverError} /> : null}
      <Form layout="vertical">
        {!preset ? (
          <Form.Item label={kind === 'onboarding' ? 'New joiner' : 'Who is leaving'} htmlFor="sp-employee" {...item('employeeId')}>
            <Select
              id="sp-employee"
              showSearch
              optionFilterProp="label"
              placeholder="Choose a person"
              loading={candidates === null}
              value={employeeId}
              onChange={setEmployeeId}
              options={options(candidates ?? [])}
              notFoundContent={
                candidates === null ? null : (
                  <div className="p-2 text-sm">
                    {kind === 'onboarding'
                      ? `Nobody to onboard. New joiners (joining soon, or in the last ${ONBOARDING_WINDOW_DAYS} days) who haven't been onboarded show up here. Add new people on the Employees page.`
                      : 'Nobody else to offboard.'}
                  </div>
                )
              }
            />
          </Form.Item>
        ) : null}
        {kind === 'offboarding' ? (
          <>
            <Form.Item label="Last working day" htmlFor="sp-last-day" {...item('lastWorkingDay')}>
              <DatePicker
                id="sp-last-day"
                className="w-full"
                format={['DD MMM YYYY', 'YYYY-MM-DD']}
                disabledDate={outOfRange}
                value={lastDay ? dayjs(lastDay) : null}
                // Typed dates get past disabledDate on Enter, so check here too.
                onChange={(d) => setLastDay(d && !outOfRange(d) ? d.format('YYYY-MM-DD') : null)}
              />
            </Form.Item>
            <Form.Item label="Reason" htmlFor="sp-reason" {...item('reason')}>
              <Select
                id="sp-reason"
                placeholder="Choose a reason"
                value={reason}
                onChange={setReason}
                options={(Object.keys(REASON_LABEL) as OffboardingReason[]).map((r) => ({ value: r, label: REASON_LABEL[r] }))}
              />
            </Form.Item>
          </>
        ) : null}
        <Form.Item label="Checklist template" htmlFor="sp-template" {...item('templateId')}>
          <Select
            id="sp-template"
            placeholder="Choose a template"
            value={templateId}
            onChange={setTemplateId}
            options={ofKind.map((t) => ({ value: t.id, label: `${t.name}${t.isDefault ? ' (default)' : ''} · ${t.tasks.length} tasks` }))}
          />
        </Form.Item>
        {kind === 'onboarding' ? (
          <Form.Item label="Buddy (optional)" htmlFor="sp-buddy" {...item('buddyId')} extra="A teammate who helps them settle in. They'll be told.">
            <Select id="sp-buddy" showSearch allowClear optionFilterProp="label" placeholder="No buddy" value={buddyId} onChange={setBuddyId} options={options(people, employeeId)} />
          </Form.Item>
        ) : (
          <Form.Item label="Notes (optional)" htmlFor="sp-notes" {...item('adminNotes')} extra="Only admins see the reason and notes.">
            <Input.TextArea id="sp-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
