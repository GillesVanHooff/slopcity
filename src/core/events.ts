/**
 * Minimal strongly-typed event emitter.
 *
 * `Events` maps event names to payload types, e.g. `Emitter<{ tick: number }>`.
 */

type Listener<T> = (payload: T) => void;

export class Emitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  /** Subscribes to an event; returns an unsubscribe function. */
  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn as Listener<never>);
    return () => this.off(type, fn);
  }

  /** Subscribes for a single emission. */
  once<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, fn: Listener<Events[K]>): void {
    this.listeners.get(type)?.delete(fn as Listener<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    // Iterate a snapshot so listeners may unsubscribe themselves during dispatch.
    for (const fn of [...set]) (fn as Listener<Events[K]>)(payload);
  }

  /** Removes all listeners, optionally only for one event. */
  clear(type?: keyof Events): void {
    if (type === undefined) this.listeners.clear();
    else this.listeners.delete(type);
  }
}
