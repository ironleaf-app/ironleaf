// Quick capture's page (src/main/capture.ts): the box, or with #snip the screenshot's own window.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import '../styles/palettes.css';
import '../styles/capture.css';
import '../styles/kit.css';
import { CaptureBox } from './CaptureBox';
import { Snip } from './Snip';

const snip = location.hash === '#snip';
document.documentElement.classList.add(snip ? 'qc-snip-page' : 'qc-box-page');
createRoot(document.getElementById('root')!).render(<StrictMode>{snip ? <Snip /> : <CaptureBox />}</StrictMode>);
