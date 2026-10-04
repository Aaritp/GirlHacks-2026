/** Azure Speech push-stream format: 16 kHz, 16-bit signed, mono PCM. */
export const SPEECH_SAMPLE_RATE = 16_000;

/**
 * Returns a stateful converter from Float32 audio at `inputRate` to 16-bit PCM at
 * `outputRate`. Each output sample averages the input samples it covers (a box filter,
 * enough anti-aliasing for speech), and fractional positions carry across chunks so
 * consecutive Web Audio blocks join without clicks or drift.
 */
export function createPcm16Resampler(inputRate: number, outputRate = SPEECH_SAMPLE_RATE) {
  if (!(inputRate > 0) || !(outputRate > 0) || outputRate > inputRate) {
    throw new RangeError('Resampler only downsamples between positive rates');
  }
  const step = inputRate / outputRate;
  let carry = new Float32Array(0);
  let position = 0;

  return (chunk: Float32Array): Int16Array => {
    const input = new Float32Array(carry.length + chunk.length);
    input.set(carry);
    input.set(chunk, carry.length);
    const count = Math.max(0, Math.floor((input.length - position) / step));
    const output = new Int16Array(count);
    for (let i = 0; i < count; i += 1) {
      const start = position + i * step;
      const end = start + step;
      let sum = 0;
      let weight = 0;
      for (let j = Math.floor(start); j < Math.ceil(end); j += 1) {
        const overlap = Math.min(j + 1, end) - Math.max(j, start);
        sum += input[j] * overlap;
        weight += overlap;
      }
      const sample = Math.max(-1, Math.min(1, weight ? sum / weight : 0));
      output[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    }
    const consumed = position + count * step;
    const keepFrom = Math.floor(consumed);
    carry = input.slice(keepFrom);
    position = consumed - keepFrom;
    return output;
  };
}
