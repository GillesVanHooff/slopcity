/**
 * Global constants. Anything tunable lives here instead of as magic numbers in systems.
 * Must stay free of DOM/three imports: it's shared by sim, render and UI.
 */

/** Map width/height in tiles. */
export const MAP_SIZE = 256;

/** Chunk width/height in tiles; the unit of mesh rebuilds, culling and dirty tracking. */
export const CHUNK_SIZE = 16;

// One tile is exactly one world unit (≈ 16 m in game terms); tile (x, z) spans
// [x, x+1] × [z, z+1] in world space. Code relies on this, so there is no TILE_SIZE knob.

/** Default world seed until map generation options exist. */
export const DEFAULT_SEED = 0x51_0b_c1_7e;

export const CAMERA = {
  /** Vertical field of view in degrees; narrow to approximate the isometric look. */
  fov: 30,
  minDistance: 6,
  // Far enough to fit the whole 256² map on screen at the default pitch.
  maxDistance: 650,
  defaultDistance: 70,
  /** Pitch limits in degrees above the horizon. */
  minPitch: 25,
  maxPitch: 75,
  defaultPitch: 45,
  /** Yaw in degrees; 45° gives the classic diagonal isometric view. */
  defaultYaw: 45,
  /** Exponential smoothing rate (1/s) for zoom, pan and rotation. */
  damping: 12,
  /** Keyboard pan speed as a fraction of camera distance per second. */
  keyPanSpeed: 0.9,
  keyPanFastMultiplier: 2.5,
  /** Zoom factor per wheel pixel (after deltaMode normalisation). */
  wheelZoomSpeed: 0.0015,
  /** Zoom factor per second while holding a zoom key. */
  keyZoomSpeed: 2.2,
  /** Degrees of rotation per pixel of middle-mouse drag. */
  dragRotateSpeed: 0.3,
  /** Extra tiles the camera target may travel beyond the map edge. */
  boundsMargin: 8,
} as const;

export const RENDER = {
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  /** Shadow frustum half-size relative to camera distance, clamped. */
  shadowCoverage: 0.9,
  shadowMinHalfSize: 12,
  shadowMaxHalfSize: 220,
  /**
   * Terrain is drawn in blocks of this many tiles per side (a multiple of CHUNK_SIZE).
   * Bigger blocks mean fewer draw calls (64 for a 256² map) at the cost of rebuilding more
   * tiles when one chunk changes.
   */
  terrainBlockSize: 32,
  /** Depth of the dirt "slab" drawn around the map edge. */
  mapSkirtDepth: 3,
} as const;

/** Palette used by procedural geometry and the scene. Linear-ish sRGB hex values. */
export const COLORS = {
  sky: 0xbfd6e6,
  grass: 0x6f9a4a,
  dirt: 0x7a5c3e,
  hover: 0xffffff,
  sunLight: 0xfff3dd,
  hemiSky: 0xdcebff,
  hemiGround: 0x5b6a3c,
} as const;
