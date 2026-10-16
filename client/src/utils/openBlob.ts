import { message } from 'antd';

/**
 * Opens a file fetched with the login token (so it can't be a plain link) in a new tab. The tab is
 * opened during the click, before the file loads, or pop-up blockers (Safari) would stop it.
 */
export async function openBlobInNewTab(fetchBlob: () => Promise<Blob>, failure = 'Could not open the file'): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await fetchBlob());
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    tab?.close();
    void message.error(failure);
  }
}
