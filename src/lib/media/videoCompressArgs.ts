export interface SoftwareVideoCompressOptions {
  videoCodec: string;
  videoCrf: number;
  videoPreset: string;
  constrained?: boolean;
  hasEncoder: (name: string) => Promise<boolean>;
}

/**
 * Builds FFmpeg software video encoder flags consistently across `/api/compress`
 * and `/api/compress/estimate`, selecting safe preset formats and low-memory
 * lookahead limits for constrained containers (e.g. 512 MB Render).
 */
export async function buildSoftwareVideoCompressArgs(opts: SoftwareVideoCompressOptions): Promise<string[]> {
  const { videoCodec, videoCrf, videoPreset, constrained = false, hasEncoder } = opts;

  if (videoCodec === 'av1') {
    if (await hasEncoder('libsvtav1')) {
      const svtPresetMap: Record<string, string> = { ultrafast: '10', fast: '8', medium: '6', slow: '4' };
      // eslint-disable-next-line security/detect-object-injection
      const svtPreset = svtPresetMap[videoPreset] || '6';
      const args = ['-c:v', 'libsvtav1', '-crf', String(videoCrf), '-preset', svtPreset, '-pix_fmt', 'yuv420p'];
      if (constrained) {
        args.push('-threads', '1', '-svtav1-params', 'lp=1:lookahead=0:enable-qm=0');
      }
      return args;
    }
    if (await hasEncoder('libaom-av1')) {
      const aomCpuUsedMap: Record<string, string> = { ultrafast: '8', fast: '7', medium: '6', slow: '4' };
      // eslint-disable-next-line security/detect-object-injection
      const cpuUsed = constrained ? '8' : (aomCpuUsedMap[videoPreset] || '6');
      const args: string[] = [];
      if (constrained) {
        args.push('-threads', '1');
      }
      args.push(
        '-c:v', 'libaom-av1',
        '-crf', String(videoCrf),
        '-b:v', '0',
        '-cpu-used', cpuUsed,
        '-lag-in-frames', '0',
        '-row-mt', constrained ? '0' : '1',
        '-pix_fmt', 'yuv420p',
      );
      return args;
    }
    return ['-c:v', 'libx264', '-crf', String(videoCrf), '-preset', videoPreset, '-pix_fmt', 'yuv420p'];
  }

  if (videoCodec === 'vp9') {
    const vp9CpuUsedMap: Record<string, string> = { ultrafast: '5', fast: '4', medium: '2', slow: '1' };
    // eslint-disable-next-line security/detect-object-injection
    const cpuUsed = vp9CpuUsedMap[videoPreset] || '2';
    return ['-c:v', 'libvpx-vp9', '-crf', String(videoCrf), '-b:v', '0', '-deadline', 'good', '-cpu-used', cpuUsed, '-pix_fmt', 'yuv420p'];
  }

  const codecMap: Record<string, string> = {
    hevc: 'libx265',
    h264: 'libx264',
  };
  // eslint-disable-next-line security/detect-object-injection
  const encoder = codecMap[videoCodec] || 'libx265';
  return ['-c:v', encoder, '-crf', String(videoCrf), '-preset', videoPreset];
}
