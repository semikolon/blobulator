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
    // Purple-tinted background matching page bg
    backgroundColor: 'hsla(275, 25%, 22%, 0.7)',
    borderRadius: 16,
    padding: 12,
    display: 'flex',
    gap: 8,
    backdropFilter: 'blur(8px)',
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
    // Colorless - white with higher opacity when active
    backgroundColor: 'hsla(0, 0%, 100%, 0.2)',
    color: 'hsla(0, 0%, 100%, 0.85)',
  },
  buttonInactive: {
    // Colorless - very subtle
    backgroundColor: 'hsla(0, 0%, 100%, 0.08)',
    color: 'hsla(0, 0%, 100%, 0.45)',
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
