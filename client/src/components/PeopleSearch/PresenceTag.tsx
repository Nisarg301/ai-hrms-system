import { Tag } from 'antd';
import type { Presence } from '../../types/people';

const META: Record<Presence, { label: string; color: string }> = {
  in: { label: 'In', color: 'green' },
  out: { label: 'Out', color: 'default' },
  on_leave: { label: 'On leave', color: 'purple' },
  off: { label: 'Day off', color: 'default' },
  not_in: { label: 'Not in yet', color: 'default' },
};

export function PresenceTag({ presence, wfh }: { presence: Presence; wfh: boolean }) {
  return (
    <span className="inline-flex gap-1">
      <Tag color={META[presence].color} className="!mr-0">
        {META[presence].label}
      </Tag>
      {wfh && presence !== 'on_leave' ? (
        <Tag color="blue" className="!mr-0">
          WFH
        </Tag>
      ) : null}
    </span>
  );
}
