import { describe, expect, it } from 'vitest';
import { createPcm16Resampler } from './pcm';

const sine = (rate: number, seconds: number, hz: number, offset = 0) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => 0.5 * Math.sin(2 * Math.PI * hz * (i + offset) / rate));

describe('createPcm16Resampler', () => {
  it.each([48_000, 44_100, 16_000])('produces 16 kHz output from %i Hz without drift across chunks', (rate) => {
    const resample = createPcm16Resampler(rate);
    let total = 0;
    // Web Audio delivers small, uneven chunks; 10 s of audio must still yield 10 s at 16 kHz.
    for (let sent = 0; sent < rate * 10;) {
      const size = Math.min(2048 - (sent % 7), rate * 10 - sent);
      total += resample(new Float32Array(size)).length;
      sent += size;
    }
    expect(Math.abs(total - 160_000)).toBeLessThanOrEqual(1);
  });

  it('chunked output matches one-shot output, so block boundaries add no clicks', () => {
    const input = sine(48_000, 0.5, 440);
    const whole = createPcm16Resampler(48_000)(input);
    const chunked = createPcm16Resampler(48_000);
    const parts: number[] = [];
    for (let i = 0; i < input.length; i += 1000) parts.push(...chunked(input.subarray(i, i + 1000)));
    expect(parts).toEqual([...whole]);
  });

  it('preserves a speech-band tone and converts to signed 16-bit with clipping', () => {
    const out = createPcm16Resampler(48_000)(sine(48_000, 0.1, 300));
    const peak = Math.max(...out.map(Math.abs));
    expect(peak).toBeGreaterThan(0.45 * 0x7fff);
    expect(peak).toBeLessThan(0.51 * 0x7fff);
    expect([...createPcm16Resampler(16_000)(Float32Array.of(2, -2, 0))]).toEqual([0x7fff, -0x8000, 0]);
  });

  it('attenuates content above the 8 kHz Nyquist limit instead of aliasing it at full level', () => {
    const out = createPcm16Resampler(48_000)(sine(48_000, 0.1, 15_000));
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(0.25 * 0x7fff);
  });

  it('rejects upsampling and invalid rates', () => {
    expect(() => createPcm16Resampler(8000)).toThrow(RangeError);
    expect(() => createPcm16Resampler(0)).toThrow(RangeError);
  });
});
