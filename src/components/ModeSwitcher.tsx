/**
 * ModeSwitcher - Overlay component to switch between visualization modes
 * Positioned in top-right corner, matching control panel styling (80% opacity, large rounded corners)
 */

import type { VisualizationMode } from '../shared/types';

interface ModeSwitcherProps {
  mode: VisualizationMode;
  onModeChange: (mode: VisualizationMode) => void;
}

const styles = {
  container: {
    position: 'absolute' as const,
    top: 16,
    right: 16,
    zIndex: 20,
    backgroundColor: 'rgba(39, 39, 42, 0.8)',
    borderRadius: 16,
    padding: 12,
    display: 'flex',
    gap: 8,
  },
  button: {
    padding: '8px 16px',
    borderRadius: 12,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    fontFamily: 'system-ui, sans-serif',
    transition: 'all 0.2s ease',
  },
  buttonActive: {
    backgroundColor: '#ec4899',
    color: 'white',
  },
  buttonInactive: {
    backgroundColor: 'rgba(63, 63, 70, 0.8)',
    color: '#a1a1aa',
  },
};

export function ModeSwitcher({ mode, onModeChange }: ModeSwitcherProps) {
  return (
    <div style={styles.container} onClick={(e) => e.stopPropagation()}>
      <button
        style={{
          ...styles.button,
          ...(mode === 'blobulator' ? styles.buttonActive : styles.buttonInactive),
        }}
        onClick={() => onModeChange('blobulator')}
      >
        Blobulator
      </button>
      <button
        style={{
          ...styles.button,
          ...(mode === 'voidulator' ? styles.buttonActive : styles.buttonInactive),
        }}
        onClick={() => onModeChange('voidulator')}
      >
        Voidulator
      </button>
    </div>
  );
}
