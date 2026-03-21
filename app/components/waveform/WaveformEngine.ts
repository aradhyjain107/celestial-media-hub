// WaveformEngine.ts – Pure TypeScript, no DOM dependencies
// ---------------------------------------------------------------
// This module provides a function to decode raw audio bytes (ArrayBuffer)
// using the Web Audio API and compute RMS amplitude values per window.
// It returns normalised amplitude arrays for left and (if present) right channels.
// The implementation is deliberately pure – it does not touch the DOM, making
// it straightforward to unit‑test by mocking `AudioContext` and `AudioBuffer`.

export interface WaveformResult {
  /** Normalised RMS values for the left channel (0‑1 range) */
  left: Float32Array;
  /** Normalised RMS values for the right channel, if the source is stereo */
  right?: Float32Array;
}

/**
 * Compute RMS amplitude per window.
 * @param channelData Float32Array of PCM samples for a single channel.
 * @param windowSize Number of samples per window (e.g. canvas width in pixels).
 * @returns Float32Array of RMS values, one per window.
 */
function computeRMS(channelData: Float32Array, windowSize: number): Float32Array {
  const totalSamples = channelData.length;
  const windows = Math.ceil(totalSamples / windowSize);
  const rms = new Float32Array(windows);

  for (let w = 0; w < windows; w++) {
    const start = w * windowSize;
    const end = Math.min(start + windowSize, totalSamples);
    let sumSq = 0;
    const length = end - start;
    for (let i = start; i < end; i++) {
      // eslint-disable-next-line security/detect-object-injection
      const sample = channelData[i];
      sumSq += sample * sample;
    }
    // eslint-disable-next-line security/detect-object-injection
    rms[w] = Math.sqrt(sumSq / length);
  }
  return rms;
}

/**
 * Decode an ArrayBuffer containing an audio file and compute normalised RMS
 * amplitudes for each channel.
 *
 * @param audioData Raw audio file bytes.
 * @param windowSize Number of samples that correspond to a single pixel column
 *   on the waveform canvas. The caller typically passes the canvas width.
 * @param injectedContext Optional AudioContext instance – useful for testing.
 * @returns Promise resolving to left/right amplitude arrays (0‑1 normalised).
 */
export async function generateWaveform(
  audioData: ArrayBuffer,
  windowSize: number,
  injectedContext?: AudioContext
): Promise<WaveformResult> {
  // Allow dependency injection for testability.
  const AudioCtx = injectedContext ?? (typeof AudioContext !== 'undefined' ? new AudioContext() : null);
  if (!AudioCtx) {
    throw new Error('AudioContext is not available in this environment');
  }

  // decodeAudioData returns a Promise<AudioBuffer>
  const audioBuffer: AudioBuffer = await AudioCtx.decodeAudioData(audioData);

  const { numberOfChannels, length } = audioBuffer;
  const leftData = audioBuffer.getChannelData(0);
  const leftRMS = computeRMS(leftData, windowSize);

  // Normalise based on the maximum RMS across all channels to keep the range 0‑1.
  let maxRMS = leftRMS.reduce((max, val) => Math.max(max, val), 0);
  let rightRMS: Float32Array | undefined;

  if (numberOfChannels > 1) {
    const rightData = audioBuffer.getChannelData(1);
    rightRMS = computeRMS(rightData, windowSize);
    const rightMax = rightRMS.reduce((max, val) => Math.max(max, val), 0);
    maxRMS = Math.max(maxRMS, rightMax);
  }

  // Guard against silent audio (maxRMS === 0)
  const normaliser = maxRMS === 0 ? 1 : maxRMS;
  const left = new Float32Array(leftRMS.map(v => v / normaliser));
  const right = rightRMS ? new Float32Array(rightRMS.map(v => v / normaliser)) : undefined;

  // Clean up the injected context if we created it ourselves.
  if (!injectedContext && AudioCtx instanceof AudioContext) {
    AudioCtx.close();
  }

  return { left, right };
}

// Export a minimal type for the injected AudioContext – this mirrors the real
// Web Audio API enough for the unit tests. In the browser the real AudioContext
// will be used.
export type InjectableAudioContext = {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  close?(): Promise<void>;
};

// The function is deliberately small (< 200 LOC) and pure, making it easy to
// mock in Vitest without a DOM.
