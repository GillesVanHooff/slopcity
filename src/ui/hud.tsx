/**
 * Heads-up display: title, view controls (compass, grid toggle), performance stats,
 * hovered tile readout and a controls cheat sheet. Pure presentation over `hud` signals;
 * actions that affect the game go through the `HudActions` callbacks.
 */

import { render, type ComponentChildren } from 'preact';
import { hud } from './state';
import { fallbackKeyLabel } from './keyLabels';

export interface HudActions {
  resetView(): void;
  toggleGrid(): void;
  toggleHelp(): void;
}

function key(code: string): string {
  return hud.keyLabels.value[code] ?? fallbackKeyLabel(code);
}

function Kbd({ children }: { children: string }) {
  return <kbd class="kbd">{children}</kbd>;
}

function Compass({ onClick }: { onClick(): void }) {
  // The needle points to world north (-z). Rotate opposite to the camera heading.
  const rotation = -hud.headingDeg.value;
  return (
    <button
      class="hud-button compass"
      type="button"
      title="Reset view (Home)"
      aria-label="Reset view"
      onClick={onClick}
    >
      <svg viewBox="-20 -20 40 40" width="34" height="34" aria-hidden="true">
        <circle r="18" class="compass-ring" />
        <g transform={`rotate(${rotation})`}>
          <path d="M0 -14 L5 0 L0 3 L-5 0 Z" class="compass-north" />
          <path d="M0 14 L5 0 L0 3 L-5 0 Z" class="compass-south" />
          <text y="-15.5" class="compass-label">
            N
          </text>
        </g>
      </svg>
    </button>
  );
}

function Stats() {
  const tile = hud.hoverTile.value;
  return (
    <div class="panel stats" aria-live="off">
      <div class="stat">
        <span class="stat-label">FPS</span>
        <span class="stat-value">{hud.fps.value}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Frame</span>
        <span class="stat-value">{hud.frameMs.value.toFixed(1)} ms</span>
      </div>
      <div class="stat">
        <span class="stat-label">Draws</span>
        <span class="stat-value">{hud.drawCalls.value}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Zoom</span>
        <span class="stat-value">{hud.zoomDistance.value.toFixed(0)}</span>
      </div>
      <div class="stat stat-wide">
        <span class="stat-label">Tile</span>
        <span class="stat-value">{tile ? `${tile.x}, ${tile.z}` : '—'}</span>
      </div>
    </div>
  );
}

function Help({ actions }: { actions: HudActions }) {
  if (!hud.helpVisible.value) {
    return (
      <button class="hud-button help-toggle" type="button" onClick={actions.toggleHelp}>
        Controls <Kbd>{key('KeyH')}</Kbd>
      </button>
    );
  }
  const rows: [string, ComponentChildren][] = [
    [
      'Pan',
      <>
        <Kbd>{key('KeyW')}</Kbd>
        <Kbd>{key('KeyA')}</Kbd>
        <Kbd>{key('KeyS')}</Kbd>
        <Kbd>{key('KeyD')}</Kbd> / arrows · right-drag
      </>,
    ],
    [
      'Zoom',
      <>
        wheel · <Kbd>+</Kbd>
        <Kbd>−</Kbd>
      </>,
    ],
    [
      'Rotate',
      <>
        <Kbd>{key('KeyQ')}</Kbd>
        <Kbd>{key('KeyE')}</Kbd> · middle-drag
      </>,
    ],
    ['Fast pan', <Kbd>Shift</Kbd>],
    ['Reset view', <Kbd>Home</Kbd>],
    ['Grid', <Kbd>{key('KeyG')}</Kbd>],
    ['Hide help', <Kbd>{key('KeyH')}</Kbd>],
  ];
  return (
    <div class="panel help">
      <div class="panel-title">Controls</div>
      <dl>
        {rows.map(([label, keys]) => (
          <div class="help-row" key={label}>
            <dt>{label}</dt>
            <dd>{keys}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Hud({ actions }: { actions: HudActions }) {
  return (
    <div class="hud">
      <header class="hud-top">
        <div class="panel brand">
          <span class="brand-name">SlopCity</span>
          <span class="brand-tag">pre-alpha</span>
        </div>
        <div class="hud-top-right">
          <Stats />
          <div class="view-controls">
            <Compass onClick={actions.resetView} />
            <button
              class={`hud-button toggle ${hud.gridVisible.value ? 'is-on' : ''}`}
              type="button"
              aria-pressed={hud.gridVisible.value}
              title={`Toggle grid (${key('KeyG')})`}
              onClick={actions.toggleGrid}
            >
              Grid
            </button>
          </div>
        </div>
      </header>
      <footer class="hud-bottom">
        <Help actions={actions} />
      </footer>
    </div>
  );
}

export function mountHud(root: HTMLElement, actions: HudActions): () => void {
  render(<Hud actions={actions} />, root);
  return () => render(null, root);
}
