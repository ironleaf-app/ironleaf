import { useRef, useState } from 'react';

export function useMeetingDraft() {
  const [value, setValue] = useState('');
  const pending = useRef(false);
  async function save(write: (text: string) => Promise<unknown>) {
    const text = value.trim();
    if (!text || pending.current) return;
    pending.current = true;
    try {
      if (await write(text) !== null) setValue((current) => current === value ? '' : current);
    } finally {
      pending.current = false;
    }
  }
  return { value, setValue, save };
}
