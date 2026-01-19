import { useState } from 'react';
import { Blobulator } from './components/wavefront';
import { Voidulator } from './components/voidulator';
import { ModeSwitcher } from './components/ModeSwitcher';
import { useAdaptiveAudio } from './shared';
import type { VisualizationMode } from './shared/types';
import './index.css';

function App() {
  const [mode, setMode] = useState<VisualizationMode>('blobulator');
  const audio = useAdaptiveAudio();

  return (
    <>
      <ModeSwitcher mode={mode} onModeChange={setMode} />
      {mode === 'blobulator' ? (
        <Blobulator audio={audio} />
      ) : (
        <Voidulator audio={audio} />
      )}
    </>
  );
}

export default App;
