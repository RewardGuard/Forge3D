import { useEffect, useRef, useState } from 'react';

// Popover open/close that doesn't fight the user.
//
// These panels used to close on `onMouseLeave`, and the panel sits 8px below its
// button — so the pointer had to cross a dead gap to reach it, and any small
// movement outside the 340px panel slammed it shut. Upgrading was effectively
// impossible: the plan buttons vanished the moment you moved toward them.
//
// Instead: stay open until the user clicks outside or presses Escape.
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    // `mousedown` (not click) so it closes before the click lands elsewhere
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return { open, setOpen, ref };
}
