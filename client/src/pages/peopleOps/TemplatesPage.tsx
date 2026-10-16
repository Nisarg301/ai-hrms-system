import { DeleteOutlined, EditOutlined, PlusOutlined, StarOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, message, Row, Skeleton, Space, Tabs, Tag, theme, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { confirmAction } from '../../components/ConfirmDialog/confirmDialog';
import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { selectLifecycleAdmin } from '../../store/lifecycleAdmin/lifecycleAdminSelectors';
import { deleteTemplate, fetchTemplates, makeDefaultTemplate } from '../../store/lifecycleAdmin/lifecycleAdminThunks';
import type { ChecklistTemplate, LifecycleKind } from '../../types/lifecycle';
import { offsetText } from '../../utils/lifecycleFormat';
import { TemplateEditorDrawer } from './TemplateEditorDrawer';

type Editor = { open: false } | { open: true; template: ChecklistTemplate | null };

const PREVIEW = 4;

function TemplateCard({ template, onEdit }: { template: ChecklistTemplate; onEdit: () => void }) {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();

  const onMakeDefault = async () => {
    const result = await dispatch(makeDefaultTemplate(template.id));
    if (makeDefaultTemplate.rejected.match(result)) void message.error(result.payload ?? 'Could not make it the default');
    else void message.success(`${template.name} is now the default`);
  };
  const onDelete = () =>
    confirmAction({
      title: `Delete ${template.name}?`,
      content: 'Processes already started from it keep their tasks.',
      okText: 'Delete',
      onConfirm: async () => {
        const result = await dispatch(deleteTemplate(template.id));
        if (deleteTemplate.rejected.match(result)) void message.error(result.payload ?? 'Could not delete the template');
      },
    });

  return (
    <Card
      className="h-full"
      data-testid="template-card"
      title={
        <span className="flex items-center gap-2">
          {template.name}
          {template.isDefault ? <Tag color="blue">Default</Tag> : null}
        </span>
      }
      actions={[
        <Button key="edit" type="link" icon={<EditOutlined />} onClick={onEdit} aria-label={`Edit ${template.name}`}>
          Edit
        </Button>,
        ...(template.isDefault
          ? []
          : [
              <Button key="default" type="link" icon={<StarOutlined />} onClick={onMakeDefault} aria-label={`Make ${template.name} the default`}>
                Make default
              </Button>,
              <Button key="delete" type="link" danger icon={<DeleteOutlined />} onClick={onDelete} aria-label={`Delete ${template.name}`}>
                Delete
              </Button>,
            ]),
      ]}
    >
      <div className="mb-2 text-xs" style={{ color: token.colorTextSecondary }}>
        {template.tasks.length} task{template.tasks.length === 1 ? '' : 's'} · updated {dayjs(template.updatedAt).format('D MMM YYYY')}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {template.tasks.slice(0, PREVIEW).map((t) => (
          <li key={t.key} className="flex justify-between gap-2">
            <span className="truncate">{t.title}</span>
            <span className="shrink-0 text-xs" style={{ color: token.colorTextSecondary }}>
              {offsetText(t.dueOffsetDays, template.kind)}
            </span>
          </li>
        ))}
        {template.tasks.length > PREVIEW ? <li style={{ color: token.colorTextSecondary }}>and {template.tasks.length - PREVIEW} more…</li> : null}
      </ul>
    </Card>
  );
}

/** ORG_ADMIN: the onboarding and offboarding checklists processes start from. */
export default function TemplatesPage() {
  const dispatch = useAppDispatch();
  const { templates, templatesStatus, templatesError } = useAppSelector(selectLifecycleAdmin);
  const [params, setParams] = useSearchParams();
  const kind: LifecycleKind = params.get('kind') === 'offboarding' ? 'offboarding' : 'onboarding';
  const [editor, setEditor] = useState<Editor>({ open: false });

  useEffect(() => {
    void dispatch(fetchTemplates());
  }, [dispatch]);

  const list = (k: LifecycleKind) => {
    const ofKind = templates.filter((t) => t.kind === k).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
    if (templatesStatus !== 'succeeded' && !ofKind.length) return <Skeleton active />;
    return (
      <Row gutter={[16, 16]}>
        {ofKind.map((t) => (
          <Col key={t.id} xs={24} md={12} xl={8}>
            <TemplateCard template={t} onEdit={() => setEditor({ open: true, template: t })} />
          </Col>
        ))}
      </Row>
    );
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Typography.Title level={4} className="!mb-0">
          Checklist templates
        </Typography.Title>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ open: true, template: null })}>
            New {kind} template
          </Button>
        </Space>
      </div>
      {templatesError ? <Alert className="mb-4" type="error" showIcon message={templatesError} /> : null}
      <Card>
        <Tabs
          activeKey={kind}
          onChange={(k) => setParams(k === 'onboarding' ? {} : { kind: k }, { replace: true })}
          items={[
            { key: 'onboarding', label: 'Onboarding', children: list('onboarding') },
            { key: 'offboarding', label: 'Offboarding', children: list('offboarding') },
          ]}
        />
      </Card>
      <TemplateEditorDrawer open={editor.open} kind={editor.open && editor.template ? editor.template.kind : kind} template={editor.open ? editor.template : null} onClose={() => setEditor({ open: false })} />
    </div>
  );
}
