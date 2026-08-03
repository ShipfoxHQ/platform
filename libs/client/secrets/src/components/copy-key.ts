import {toast} from '@shipfox/react-ui/toast';

/**
 * Copies a bare key name (e.g. `MY_TOKEN`) to the clipboard. Guarded because
 * `navigator.clipboard` is undefined in insecure contexts and older browsers.
 * a missing API or a rejected write surfaces a toast instead of an unhandled
 * rejection.
 */
export async function copyKeyName(key: string): Promise<void> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clipboard?.writeText) {
    toast.error('Clipboard is not available in this browser.');
    return;
  }
  try {
    await clipboard.writeText(key);
    toast.success(`Copied ${key}`);
  } catch {
    toast.error('Could not copy to the clipboard.');
  }
}
