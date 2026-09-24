import '@fontsource/big-shoulders-display/700';
import '@fontsource/big-shoulders-display/800';
import '@fontsource/big-shoulders-display/900';
import '@fontsource/instrument-serif/400';
import '@fontsource/instrument-serif/400-italic';
import '@fontsource/martian-mono/400';
import '@fontsource/martian-mono/500';
import '@fontsource/martian-mono/600';
import '@fontsource/geist/400';
import '@fontsource/geist/500';
import '@fontsource/geist/600';
import './styles/main.css';

import { App } from './ui/app';
import './ui/screens/home';
import './ui/screens/calibrate';
import './ui/screens/manual';
import './ui/screens/range';
import './ui/screens/tools';
import './ui/screens/settings';
import { fontsReady } from './world/text';

// Canvas textures (bearing numerals on the monoliths) need the fonts before the arena is built.
await fontsReady();
const app = new App(document.getElementById('app')!);
app.go('home');

// Debug/automation hook (used by the headless smoke test).
(window as unknown as { azimuth: App }).azimuth = app;
