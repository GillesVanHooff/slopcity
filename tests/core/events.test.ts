import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';

interface TestEvents {
  tick: number;
  name: string;
}

describe('Emitter', () => {
  it('delivers payloads to subscribers of the matching event only', () => {
    const e = new Emitter<TestEvents>();
    const onTick = vi.fn();
    const onName = vi.fn();
    e.on('tick', onTick);
    e.on('name', onName);
    e.emit('tick', 5);
    expect(onTick).toHaveBeenCalledWith(5);
    expect(onName).not.toHaveBeenCalled();
  });

  it('unsubscribes via the returned function and via off()', () => {
    const e = new Emitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    const offA = e.on('tick', a);
    e.on('tick', b);
    offA();
    e.off('tick', b);
    e.emit('tick', 1);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('once() fires a single time', () => {
    const e = new Emitter<TestEvents>();
    const fn = vi.fn();
    e.once('tick', fn);
    e.emit('tick', 1);
    e.emit('tick', 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('tolerates listeners unsubscribing during dispatch', () => {
    const e = new Emitter<TestEvents>();
    const calls: string[] = [];
    const offFirst = e.on('tick', () => {
      calls.push('first');
      offFirst();
    });
    e.on('tick', () => calls.push('second'));
    e.emit('tick', 0);
    e.emit('tick', 0);
    expect(calls).toEqual(['first', 'second', 'second']);
  });

  it('clear() removes listeners', () => {
    const e = new Emitter<TestEvents>();
    const fn = vi.fn();
    e.on('tick', fn);
    e.on('name', fn);
    e.clear('tick');
    e.emit('tick', 1);
    e.emit('name', 'x');
    expect(fn).toHaveBeenCalledTimes(1);
    e.clear();
    e.emit('name', 'y');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
