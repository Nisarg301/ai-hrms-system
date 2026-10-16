import { FileOutlined, FilePdfOutlined } from '@ant-design/icons';
import { Tag, Timeline } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { getReceiptRequest } from '../../services/endpoints/expenses.endpoints';
import type { ExpenseClaim, Receipt } from '../../types/expense';
import { openBlobInNewTab } from '../../utils/openBlob';

/** Opens a receipt in a new tab. */
export function openReceipt(claimId: string, itemId: string, receipt: Receipt) {
  return openBlobInNewTab(async () => (await getReceiptRequest(claimId, itemId, receipt.id)).data, 'Could not open the receipt');
}

/** created → submitted → approved/rejected (who, when, the note) → paid (date, reference). */
export function ClaimTimeline({ claim }: { claim: ExpenseClaim }) {
  const when = (iso: string | null) => (iso ? dayjs(iso).format('D MMM YYYY, HH:mm') : '');
  const items = [
    { color: 'gray', children: `Created ${when(claim.createdAt)}` },
    ...(claim.submittedAt ? [{ color: 'blue', children: `Submitted ${when(claim.submittedAt)}` }] : []),
    ...(claim.decidedAt
      ? [
          {
            color: claim.status === 'rejected' ? 'red' : 'green',
            children: (
              <>
                {claim.status === 'rejected' ? 'Rejected' : 'Approved'} by {claim.decidedByName ?? 'an admin'} · {when(claim.decidedAt)}
                {claim.decisionNote ? <div className="italic opacity-80">“{claim.decisionNote}”</div> : null}
              </>
            ),
          },
        ]
      : []),
    ...(claim.status === 'paid'
      ? [{ color: 'green', children: `Paid on ${dayjs(claim.paidOn).format('D MMM YYYY')} · reference ${claim.paymentReference}` }]
      : []),
  ];
  return <Timeline items={items} />;
}

/** An image receipt as a thumbnail (fetched with the login token); anything else as a link. Both open in a new tab. */
export function ReceiptPreview({ claimId, itemId, receipt }: { claimId: string; itemId: string; receipt: Receipt }) {
  const isImage = receipt.mimeType.startsWith('image/');
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    let url: string | null = null;
    let cancelled = false;
    getReceiptRequest(claimId, itemId, receipt.id)
      .then(({ data }) => {
        if (cancelled) return;
        url = URL.createObjectURL(data);
        setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [claimId, itemId, receipt.id, isImage]);

  const open = () => void openReceipt(claimId, itemId, receipt);
  if (isImage && src) {
    return (
      <button type="button" className="cursor-pointer rounded border-0 bg-transparent p-0" onClick={open} title={`Open ${receipt.originalName}`}>
        <img src={src} alt={receipt.originalName} className="h-24 max-w-[160px] rounded border object-cover" />
      </button>
    );
  }
  return (
    <Tag icon={isImage ? <FileOutlined /> : <FilePdfOutlined />} className="!mr-0">
      <button type="button" className="cursor-pointer border-0 bg-transparent p-0 underline" onClick={open}>
        {receipt.originalName}
      </button>
    </Tag>
  );
}
