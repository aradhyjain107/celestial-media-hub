import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../../lib/env';
import { cleanupJobDir } from '../../../lib/temp';
import { verifyAuth, verifyJobOwnership, unregisterJobOwner } from '../../../lib/auth';
import { sanitizeError } from '../../../lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = verifyAuth(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  const file = searchParams.get('file');

  if (!jobId || !file) {
    return NextResponse.json({ error: 'Missing jobId or file' }, { status: 400 });
  }

  // BOLA Guard: Ensure request caller owns the job resource
  if (!verifyJobOwnership(jobId, session)) {
    return NextResponse.json(
      { error: 'Forbidden', message: 'You do not have permission to access this job' },
      { status: 403 }
    );
  }

  // Prevent directory traversal using path.basename & containment checks
  const safeFile = path.basename(file.replace(/\\/g, '/'));
  const safeJobId = path.basename(jobId.replace(/\\/g, '/'));

  if (
    file.includes('\\') || file.includes('/') || file.includes('..') ||
    jobId.includes('\\') || jobId.includes('/') || jobId.includes('..') ||
    safeFile !== file || safeJobId !== jobId || !safeFile || !safeJobId
  ) {
    return NextResponse.json({ error: 'Invalid filename or jobId' }, { status: 400 });
  }

  const tempBaseDir = path.resolve(env.TEMP_DIR);
  const masterDir = path.resolve(tempBaseDir, safeJobId);
  const filePath = path.resolve(masterDir, safeFile);

  if (!masterDir.startsWith(tempBaseDir + path.sep)) {
    return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
  }

  if (!filePath.startsWith(masterDir + path.sep)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'File not found or expired' }, { status: 404 });
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const stats = fs.statSync(filePath);

  // Create stream
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileStream = fs.createReadStream(filePath);
  
  let cleanupScheduled = false;
  const scheduleCleanup = () => {
    if (cleanupScheduled) return;
    cleanupScheduled = true;
    setTimeout(() => {
      cleanupJobDir(jobId);
      unregisterJobOwner(jobId);
    }, 1000);
  };

  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

  // Wrap standard Node.js ReadStream in Web ReadableStream with backpressure flow control
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      fileStream.on('data', (chunk) => {
        const u8 = new Uint8Array(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
        try {
          controller.enqueue(u8);
        } catch {
          if (typeof fileStream.destroy === 'function') {
            fileStream.destroy();
          }
          return;
        }
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          if (typeof fileStream.pause === 'function') {
            fileStream.pause();
          }
        }
      });
      fileStream.on('end', () => {
        try {
          controller.close();
        } catch {}
        scheduleCleanup();
      });
      fileStream.on('close', () => {
        try {
          controller.close();
        } catch {}
        scheduleCleanup();
      });
      fileStream.on('error', (error) => {
        try {
          controller.error(error);
        } catch {}
        scheduleCleanup();
      });
    },
    pull() {
      if (typeof fileStream.isPaused === 'function' && fileStream.isPaused()) {
        fileStream.resume();
      } else if (typeof fileStream.resume === 'function') {
        fileStream.resume();
      }
    },
    cancel() {
      if (typeof fileStream.destroy === 'function') {
        fileStream.destroy();
      }
      scheduleCleanup();
    }
  });

  const handleAbort = () => {
    if (typeof fileStream.destroy === 'function') {
      fileStream.destroy();
    }
    if (streamController) {
      try {
        streamController.close();
      } catch {}
    }
    scheduleCleanup();
  };

  if (req.signal) {
    if (req.signal.aborted) {
      handleAbort();
    } else {
      req.signal.addEventListener('abort', handleAbort, { once: true });
    }
  }

  return new NextResponse(stream, {
    headers: {
      // RFC 6266: use filename* with percent-encoding to prevent header injection
      'Content-Disposition': `attachment; filename="${safeFile.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(safeFile)}`,
      'Content-Length': stats.size.toString(),
      'Content-Type': 'application/octet-stream'
    }
  });
}
