import React, { useMemo } from 'react';
import { useStore } from '../lib/store.js';
import { circuitToSvg } from '../lib/circuitSvg.js';
import { amazonUrl, openExternal } from '../lib/links.js';

export default function ExportWorkspace() {
  const nodes = useStore((s) => s.nodes);
  const wires = useStore((s) => s.wires);
  const bom = useStore((s) => s.bom);
  const { rows, total } = bom();

  const svg = useMemo(() => circuitToSvg(nodes, wires), [nodes, wires]);

  async function saveSvg() {
    await window.forge.saveFile({
      defaultName: 'forge3d-circuit.svg',
      content: svg,
      filters: [{ name: 'SVG', extensions: ['svg'] }],
    });
  }

  async function saveBom() {
    const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const header = 'part_id,name,qty,unit_usd,total_usd,amazon_search';
    const lines = rows.map((r) =>
      [r.partId, esc(r.name), r.qty, r.unit.toFixed(2), r.total.toFixed(2), esc(amazonUrl(r.name))].join(',')
    );
    const count = rows.reduce((a, r) => a + r.qty, 0);
    const totalRow = ['TOTAL', esc(`${rows.length} unique / ${count} parts`), count, '', total.toFixed(2), ''].join(',');
    const csv = [header, ...lines, totalRow].join('\n');
    await window.forge.saveFile({
      defaultName: 'forge3d-bom.csv',
      content: csv,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
  }

  const itemCount = rows.reduce((a, r) => a + r.qty, 0);

  return (
    <div className="layout two-col export-layout">
      <section className="export-preview">
        <div className="toolbar">
          <span className="muted small">Sticker-circuit preview (cut along black) · {wires.length} traces</span>
          <div className="spacer" />
          <button className="btn primary" disabled={nodes.length === 0} onClick={saveSvg}>Save .svg</button>
        </div>
        <div className="svg-stage">
          {nodes.length === 0 ? (
            <p className="muted">Build a circuit first, then its cuttable sticker layout appears here.</p>
          ) : (
            <div className="svg-frame" dangerouslySetInnerHTML={{ __html: svg }} />
          )}
        </div>
      </section>

      <aside className="sidebar right">
        <div className="panel scroll">
          <h3>Bill of Materials</h3>
          {rows.length === 0 ? (
            <p className="muted">No parts yet — build a circuit and the parts list appears here.</p>
          ) : (
            <>
              <div className="bom-summary">
                <div className="bom-total">
                  <span>Estimated total</span>
                  <b>${total.toFixed(2)}</b>
                </div>
                <div className="bom-meta">
                  <span>{rows.length} unique</span>
                  <span>·</span>
                  <span>{itemCount} part{itemCount === 1 ? '' : 's'}</span>
                </div>
              </div>

              <table className="bom">
                <thead>
                  <tr><th>Part</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Total</th><th>Buy</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.partId}>
                      <td>{r.name}</td>
                      <td className="num">{r.qty}</td>
                      <td className="num">${r.unit.toFixed(2)}</td>
                      <td className="num">${r.total.toFixed(2)}</td>
                      <td>
                        <button className="amz-link" title={`Find "${r.name}" on Amazon`} onClick={() => openExternal(amazonUrl(r.name))}>
                          Amazon ↗
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={3}>Total</td><td className="num strong">${total.toFixed(2)}</td><td /></tr>
                </tfoot>
              </table>
              <p className="muted small">Unit prices are typical estimates; tap <b>Amazon ↗</b> for current live pricing (often sold in multi-packs).</p>
            </>
          )}
          <button className="btn primary full" disabled={rows.length === 0} onClick={saveBom}>Save BOM (.csv)</button>
        </div>
      </aside>
    </div>
  );
}
