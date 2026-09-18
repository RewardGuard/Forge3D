import React, { useState } from 'react';

// Collapsible block for stacked sidebars. Several tools share one column in
// the 3D Design tab; each gets a header it can fold under so the column never
// grows past what a user can reach. `summary` is the short status shown in the
// header (e.g. "3 bodies") and stays visible while folded.
export default function SideSection({ title, summary, defaultOpen = true, children, tut }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={'side-sec' + (open ? ' open' : '')} data-tut={tut}>
      <button type="button" className="side-sec-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="side-sec-chev">{open ? '▾' : '▸'}</span>
        <span className="side-sec-title">{title}</span>
        {summary && <span className="side-sec-sum">{summary}</span>}
      </button>
      {open && <div className="side-sec-body">{children}</div>}
    </section>
  );
}
