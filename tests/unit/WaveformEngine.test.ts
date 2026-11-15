/**
 * WaveformEngine.test.ts
 * Unit tests for generateWaveform() — runs in jsdom via Vitest.
 * AudioContext is mocked so tests never touch a real audio decode.
 *
 * User reminder: the mock must satisfy the real AudioBuffer interface:
 *   - getChannelData(n) returns a Float32Array
 *   - numberOfChannels is a number
 */

import { describe, it, expect, vi } from 'vitest';
import { generateWaveform } from '../../src/app/components/waveform/WaveformEngine';

// ─── Helpers to build mock AudioBuffers ───────────────────────────────────────

/**
 * Build a mock AudioBuffer that has the minimal properties and methods needed.
 * Each channel is represented as a Float32Array of PCM samples in [-1, 1].
 */
function makeMockAudioBuffer(channels: Float32Array[]): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    sampleRate: 44100,
    duration: (channels[0]?.length ?? 0) / 44100,
    getChannelData(n: number): Float32Array {
      return channels[n] ?? new Float32Array(0);
    },
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

/**
 * Build a mock AudioContext whose decodeAudioData always resolves with `buf`.
 */
function makeMockContext(buf: AudioBuffer) {
  return {
    decodeAudioData: (_data: ArrayBuffer) => Promise.resolve(buf),
  } as unknown as AudioContext;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WaveformEngine.generateWaveform', () => {
  it('returns a Float32Array of correct length (= windowSize windows)', async () => {
    const sampleCount = 400; // 400 PCM samples
    const windowSize = 4;    // 100 windows → output length should be 100
    const channelData = new Float32Array(sampleCount).fill(0.5);
    const buf = makeMockAudioBuffer([channelData]);
    const ctx = makeMockContext(buf);

    const result = await generateWaveform(new ArrayBuffer(1), windowSize, ctx);

    expect(result.left).toBeInstanceOf(Float32Array);
    expect(result.left.length).toBe(Math.ceil(sampleCount / windowSize)); // 100
    // validate values are in range
    Array.from(result.left).forEach(v => expect(v).toBeGreaterThanOrEqual(0));
  });

  it('RMS of constant 1.0 signal → every normalised value equals 1.0', async () => {
    const channelData = new Float32Array(8).fill(1.0);
    const buf = makeMockAudioBuffer([channelData]);
    const ctx = makeMockContext(buf);

    const result = await generateWaveform(new ArrayBuffer(1), 4, ctx);

    Array.from(result.left).forEach(v => expect(v).toBeCloseTo(1.0, 5));
  });

  it('normalises correctly: smaller amplitude becomes fraction of max', async () => {
    // Window 0: all 1.0s → RMS = 1.0
    // Window 1: all 0.5s → RMS = 0.5
    // After normalisation: [1.0, 0.5]
    const channelData = new Float32Array([1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5]);
    const buf = makeMockAudioBuffer([channelData]);
    const ctx = makeMockContext(buf);

    const result = await generateWaveform(new ArrayBuffer(1), 4, ctx);

    expect(result.left.length).toBe(2);
    expect(result.left[0]).toBeCloseTo(1.0, 5);
    expect(result.left[1]).toBeCloseTo(0.5, 5);
  });

  it('handles silent audio without dividing by zero', async () => {
    const channelData = new Float32Array(8).fill(0.0);
    const buf = makeMockAudioBuffer([channelData]);
    const ctx = makeMockContext(buf);

    const result = await generateWaveform(new ArrayBuffer(1), 4, ctx);

    Array.from(result.left).forEach(v => {
      expect(isNaN(v)).toBe(false);
      expect(v).toBe(0);
    });
  });

  it('stereo: returns right channel that is not null/undefined', async () => {
    const left = new Float32Array(8).fill(0.8);
    const right = new Float32Array(8).fill(0.4);
    const buf = makeMockAudioBuffer([left, right]);
    const ctx = makeMockContext(buf);

    const result = await generateWaveform(new ArrayBuffer(1), 4, ctx);

    expect(result.right).toBeDefined();
    expect(result.right).toBeInstanceOf(Float32Array);
    expect(result.right!.length).toBe(2);
  });

  it('mono: right channel is undefined', async () => {
    const channelData = new Float32Array(8).fill(0.5);
    const buf = makeMockAudioBuffer([channelData]);
    const ctx = makeMockContext(buf);

    const result = await generateWaveform(new ArrayBuffer(1), 4, ctx);

    expect(result.right).toBeUndefined();
  });

  it('stereo: right channel RMS values normalised against left max', async () => {
    // left max RMS = 1.0, right RMS = 0.5 → right normalised = 0.5
    const left  = new Float32Array(4).fill(1.0);
    const right = new Float32Array(4).fill(0.5);
    const buf = makeMockAudioBuffer([left, right]);
    const ctx = makeMockContext(buf);

    const result = await generateWaveform(new ArrayBuffer(1), 4, ctx);

    expect(result.left[0]).toBeCloseTo(1.0, 5);
    expect(result.right![0]).toBeCloseTo(0.5, 5);
  });
});
