import { NextRequest, NextResponse } from 'next/server';
import { InspectInputSchema, InspectOutputSchema } from '../../../schemas/inspect';
import { writeInputFile, cleanupJobDir } from '../../../lib/temp';
import { randomUUID } from 'crypto';
import { spawn } from 'node:child_process';
import { env } from '../../../lib/env';

export async function POST(req: NextRequest) {
  const jobId = randomUUID();
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    const payload = {
      file: {
        filename: file.name,
        size: file.size,
        mimetype: file.type
      }
    };

    const validation = InspectInputSchema.safeParse(payload);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.format() }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const inputPath = await writeInputFile(jobId, file.name, buffer);

    const ffprobePath = env.FFMPEG_PATH.replace('ffmpeg', 'ffprobe');
    const output = await new Promise<string>((resolve, reject) => {
      let data = '';
      const proc = spawn(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', inputPath]);
      proc.stdout.on('data', chunk => data += chunk.toString());
      proc.on('close', code => code === 0 ? resolve(data) : reject(new Error('ffprobe failed')));
      proc.on('error', err => reject(err));
    });

    const parsed = JSON.parse(output);
    const videoStream = parsed.streams?.find((s: any) => s.codec_type === 'video');
    const audioStream = parsed.streams?.find((s: any) => s.codec_type === 'audio');

    let frameRate;
    if (videoStream?.r_frame_rate) {
        const parts = videoStream.r_frame_rate.split('/');
        frameRate = parseFloat(parts[0]) / parseFloat(parts[1] || '1');
    }

    const result = {
      filename: file.name,
      filesize: file.size,
      duration: parsed.format?.duration ? parseFloat(parsed.format.duration) : undefined,
      format: parsed.format?.format_name || 'unknown',
      videoCodec: videoStream?.codec_name,
      audioCodec: audioStream?.codec_name,
      resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : undefined,
      frameRate,
      bitrate: parsed.format?.bit_rate ? parseFloat(parsed.format.bit_rate) : undefined,
      audioChannels: audioStream?.channels,
      audioSampleRate: audioStream?.sample_rate ? parseFloat(audioStream.sample_rate) : undefined,
      createdAt: new Date().toISOString()
    };
    
    return NextResponse.json(result);
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    cleanupJobDir(jobId);
  }
}
