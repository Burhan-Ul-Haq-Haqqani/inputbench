import { useEffect } from 'react';
import { useFirebase } from '../contexts/FirebaseContext';
import { detectExploitPayload } from '../utils/policyGuard';
import { isBenchmarkStoreTampered } from '../utils/storage';

export function SecurityShield() {
  const { banState, triggerBan } = useFirebase();

  useEffect(() => {
    if (banState?.banned) return;

    // 1. Check URL query/hash for PowerShell/script injection attempts
    try {
      const urlCheck = `${window.location.search}${decodeURIComponent(window.location.hash || '')}`;
      if (detectExploitPayload(urlCheck)) {
        void triggerBan('hacking/exploits', 'nice try');
        return;
      }
    } catch {
      // Ignore malformed URI hashes safely
    }

    // 2. Intercept DevTools / Inspect / View Source shortcuts
    const onKeyDown = (e: KeyboardEvent) => {
      const key = typeof e.key === 'string' ? e.key.toUpperCase() : '';
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      const isF12 = key === 'F12' || e.code === 'F12';
      const isDevShortcut =
        (ctrlOrCmd && e.shiftKey && (key === 'I' || key === 'J' || key === 'C')) ||
        (e.metaKey && e.altKey && (key === 'I' || key === 'J' || key === 'C')) ||
        (ctrlOrCmd && key === 'U');

      if (isF12 || isDevShortcut) {
        e.preventDefault();
        e.stopPropagation();
        void triggerBan('hacking/exploits', 'nice try');
      }
    };

    // 3. Block right-click Inspect context menu
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // 4. Detect PowerShell / XSS / Prototype exploit payloads pasted or entered
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') || '';
      if (detectExploitPayload(text)) {
        e.preventDefault();
        void triggerBan('hacking/exploits', 'nice try');
      }
    };

    const onInput = (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
      if (!target || typeof target.value !== 'string') return;
      if (detectExploitPayload(target.value)) {
        target.value = '';
        void triggerBan('hacking/exploits', 'nice try');
      }
    };

    // 5. Storage tampering check (catches editing scores in DevTools or external scripts)
    const onStorage = () => {
      if (isBenchmarkStoreTampered()) {
        void triggerBan('hacking/exploits', 'nice try');
      }
    };

    const intervalId = window.setInterval(() => {
      if (isBenchmarkStoreTampered()) {
        void triggerBan('hacking/exploits', 'nice try');
      }
    }, 2500);

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('paste', onPaste, true);
    window.addEventListener('input', onInput, true);
    window.addEventListener('storage', onStorage);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('paste', onPaste, true);
      window.removeEventListener('input', onInput, true);
      window.removeEventListener('storage', onStorage);
    };
  }, [banState?.banned, triggerBan]);

  return null;
}
