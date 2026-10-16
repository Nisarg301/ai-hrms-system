import { afterEach, describe, expect, it, vi } from 'vitest';
import { filenameFromDisposition, saveBlob } from './saveBlob';

afterEach(() => vi.restoreAllMocks());

describe('filenameFromDisposition', () => {
  it('reads the quoted filename, decoding it', () => {
    expect(filenameFromDisposition('attachment; filename="employees-2026-09-28.csv"', 'x')).toBe('employees-2026-09-28.csv');
    expect(filenameFromDisposition('attachment; filename="Q3%20report.pdf"', 'x')).toBe('Q3 report.pdf');
  });

  it('falls back when the header is missing or malformed', () => {
    expect(filenameFromDisposition(undefined, 'fallback.csv')).toBe('fallback.csv');
    expect(filenameFromDisposition('attachment', 'fallback.csv')).toBe('fallback.csv');
    expect(filenameFromDisposition('attachment; filename="100%.csv"', 'x')).toBe('100%.csv');
  });
});

describe('saveBlob', () => {
  it('clicks a temporary download link and releases the object URL', () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.assign(window.URL, { createObjectURL, revokeObjectURL });
    let clicked: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this;
    });

    saveBlob(new Blob(['a,b']), 'tasks.csv');

    expect(clicked!.download).toBe('tasks.csv');
    expect(clicked!.href).toBe('blob:mock');
    expect(document.body.contains(clicked)).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});
