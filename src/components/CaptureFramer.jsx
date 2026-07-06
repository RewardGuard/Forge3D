// Mounted inside a Canvas: registers this viewport so captures can auto-frame
// the whole design (see src/lib/viewportFit.js). Renders nothing.
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { registerFitter, frameScene } from '../lib/viewportFit.js';

export default function CaptureFramer() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  useEffect(() => registerFitter(() => frameScene(camera, controls)), [camera, controls]);
  return null;
}
