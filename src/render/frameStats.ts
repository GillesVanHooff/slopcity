/**
 * Rolling frame-rate measurement. Accumulates frame times and reports averages at a
 * fixed interval so the HUD updates a couple of times per second, not every frame.
 */

export interface FrameSample {
  fps: number;
  /** Average frame time in milliseconds over the window. */
  frameMs: number;
}

export class FrameStats {
  private readonly intervalSec: number;
  private elapsed = 0;
  private frames = 0;
  private readonly sample: FrameSample = { fps: 0, frameMs: 0 };

  constructor(intervalSec = 0.5) {
    this.intervalSec = intervalSec;
  }

  /** Records one frame; returns the (reused) sample object when a new average is ready. */
  frame(dt: number): FrameSample | null {
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < this.intervalSec) return null;
    this.sample.fps = Math.round(this.frames / this.elapsed);
    this.sample.frameMs = (this.elapsed / this.frames) * 1000;
    this.elapsed = 0;
    this.frames = 0;
    return this.sample;
  }
}
