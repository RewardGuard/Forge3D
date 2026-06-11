import React, { useState } from 'react';
import { useStore } from '../lib/store.js';
import ProjectsModal from './ProjectsModal.jsx';

export default function ProjectButtons() {
  const serialize = useStore((s) => s.serialize);
  const loadProject = useStore((s) => s.loadProject);
  const [savedTick, setSavedTick] = useState(false);

  function flashSaved() {
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1400);
  }
  // Save = overwrite the current project file (no dialog after the first time)
  async function save() {
    const res = await window.forge.saveProject({ content: serialize() });
    if (res?.saved) flashSaved();
  }
  // Save As = always pick a new location
  async function saveAs() {
    const res = await window.forge.saveProject({ content: serialize(), forceDialog: true });
    if (res?.saved) flashSaved();
  }
  async function open() {
    const res = await window.forge.openFile({
      filters: [{ name: 'Forge3D Project', extensions: ['f3d', 'json'] }],
    });
    if (res?.opened) loadProject(res.content);
  }

  return (
    <div className="project-btns">
      <ProjectsModal />
      <button className="mini" onClick={open} title="Open a .f3d project">Open</button>
      <button className="mini" onClick={save} title="Save to the current project file">{savedTick ? '✓ Saved' : 'Save'}</button>
      <button className="mini" onClick={saveAs} title="Save the project to a new file">Save As…</button>
    </div>
  );
}
