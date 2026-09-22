# SlopCity

**SlopCity** is a city builder in the style of SimCity 4 that runs in the browser. It has a grid-based map and 3D low-poly graphics.

Build roads that join up automatically, zone land for residential, commercial and industrial use, and watch buildings grow along your streets. You can plant forests and shape the terrain, and zoom and rotate the camera freely. A background simulation drives the city: citizens commute to jobs, industry produces goods for shops, and services, utilities and the budget determine whether the city thrives or declines.

> 🚧 Early development.

## Tech stack

- **TypeScript**: strict, typed game and simulation code
- **Vite**: dev server and bundler
- **Three.js**: 3D rendering (instanced meshes, chunked terrain)
- **Preact**: HUD and menus
- **Web Workers + Comlink**: the simulation runs off the main thread
- **IndexedDB** (`idb`): saved games
- **Vitest**: tests

## Getting started

```bash
npm install
npm run dev
```
