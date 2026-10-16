/** The filename from a `Content-Disposition: attachment; filename="..."` header. */
export function filenameFromDisposition(contentDisposition: string | undefined | null, fallback: string): string {
  const match = contentDisposition?.match(/filename="([^"]+)"/);
  if (!match?.[1]) return fallback;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Hands a downloaded Blob to the browser as a file save. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
