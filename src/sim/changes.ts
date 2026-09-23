/**
 * Change sets: what a command modified, so the renderer can rebuild only affected chunks
 * instead of scanning the map (plan.md §3, rule 2).
 */

export interface ChangeSet {
  /** Sim chunk indices whose tiles changed (unique, unordered). */
  dirtyChunks: number[];
  /** Tiles whose road layer or road mask changed (unique, unordered). */
  roadTiles: number[];
}

/** Accumulates unique tiles/chunks while a command runs. */
export class ChangeSetBuilder {
  private readonly chunks = new Set<number>();
  private readonly roads = new Set<number>();
  private readonly chunkOfIndex: (i: number) => number;

  constructor(chunkOfIndex: (i: number) => number) {
    this.chunkOfIndex = chunkOfIndex;
  }

  road(i: number): void {
    this.roads.add(i);
    this.chunks.add(this.chunkOfIndex(i));
  }

  /** Marks the chunk of tile i for a rebuild without reporting the tile as changed. */
  dirty(i: number): void {
    this.chunks.add(this.chunkOfIndex(i));
  }

  get isEmpty(): boolean {
    return this.chunks.size === 0;
  }

  build(): ChangeSet {
    return { dirtyChunks: [...this.chunks], roadTiles: [...this.roads] };
  }
}
