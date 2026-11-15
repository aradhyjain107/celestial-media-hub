/* eslint-disable security/detect-non-literal-fs-filename */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../system/env';

const ffmpegBin = env.FFMPEG_PATH || 'ffmpeg';

export function isPdfFile(filenameOrPath: string): boolean {
  const ext = path.extname(filenameOrPath).toLowerCase();
  return ext === '.pdf';
}

export interface PdfRasterizeOptions {
  quality?: number; // 1-100
  scale?: number; // e.g. 2.0 for high-res retina
}

const BIN_RASTERIZER = path.resolve(process.cwd(), 'bin', 'pdf-rasterizer');
const SWIFT_SCRIPT = path.resolve(process.cwd(), 'scripts', 'pdf-rasterizer.swift');

/**
 * Rasterizes a PDF file into all its constituent page images.
 * @param inputPath Path to the input .pdf file
 * @param outputBasePath Destination path for the converted image (e.g. /tmp/job/converted_1_doc.png)
 * @param targetFormat Target image format ('png' | 'jpg' | 'jpeg' | 'webp' | 'avif' | 'tiff' | 'bmp')
 * @param options Rasterization options (quality, scale)
 * @returns Array of absolute paths to all generated page image files
 */
export async function convertPdfToImage(
  inputPath: string,
  outputBasePath: string,
  targetFormat: string,
  options: PdfRasterizeOptions = {}
): Promise<string[]> {
  const fmt = targetFormat.toLowerCase();
  const quality = options.quality ?? 85;
  const scale = options.scale ?? 2.0;
  const outDir = path.dirname(outputBasePath);
  const parsed = path.parse(outputBasePath);
  const prefix = parsed.name;

  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch {}

  // Priority 1: High-Performance Native macOS PDFKit Engine (Extracts ALL Pages)
  if (process.platform === 'darwin') {
    const intermediateFmt = (fmt === 'webp' || fmt === 'avif') ? 'png' : (fmt === 'jpg' ? 'jpeg' : fmt);
    const qualityDecimal = (quality / 100).toFixed(2);
    
    let rawOutput: string | null = null;
    
    // Try compiled binary first
    if (fs.existsSync(BIN_RASTERIZER)) {
      try {
        rawOutput = execFileSync(
          BIN_RASTERIZER,
          [inputPath, outDir, prefix, intermediateFmt, String(scale), qualityDecimal],
          { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }
        );
      } catch (binErr: any) {
        rawOutput = null;
      }
    }
    
    // Fallback to swift interpreter with Swift script
    if (!rawOutput && fs.existsSync(SWIFT_SCRIPT)) {
      try {
        rawOutput = execFileSync(
          'swift',
          [SWIFT_SCRIPT, inputPath, outDir, prefix, intermediateFmt, String(scale), qualityDecimal],
          { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }
        );
      } catch (swiftErr: any) {
        rawOutput = null;
      }
    }

    if (rawOutput) {
      try {
        // Extract JSON array from output
        const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsedFiles: string[] = JSON.parse(jsonMatch[0]);
          const validFiles = parsedFiles.filter(f => fs.existsSync(f) && fs.statSync(f).size > 0);
          
          if (validFiles.length > 0) {
            // If target format is webp or avif, transcode each page
            if (fmt === 'webp' || fmt === 'avif') {
              const finalTranscoded: string[] = [];
              for (const pageFile of validFiles) {
                const pageParsed = path.parse(pageFile);
                const targetPagePath = path.join(outDir, `${pageParsed.name}.${fmt}`);
                
                if (fmt === 'webp') {
                  try {
                    execFileSync('cwebp', ['-q', String(quality), pageFile, '-o', targetPagePath], { stdio: 'pipe' });
                  } catch {
                    execFileSync(ffmpegBin, ['-y', '-i', pageFile, targetPagePath], { stdio: 'pipe' });
                  }
                } else {
                  execFileSync(ffmpegBin, ['-y', '-i', pageFile, targetPagePath], { stdio: 'pipe' });
                }

                if (fs.existsSync(targetPagePath)) {
                  try { fs.unlinkSync(pageFile); } catch {}
                  finalTranscoded.push(targetPagePath);
                } else {
                  finalTranscoded.push(pageFile);
                }
              }
              return finalTranscoded;
            }

            return validFiles;
          }
        }
      } catch (parseErr) {
        // Fall through to other strategies
      }
    }

    // Secondary macOS fallback: sips
    try {
      const sipsFormat = fmt === 'jpg' ? 'jpeg' : (fmt === 'webp' || fmt === 'avif' ? 'png' : fmt);
      const tempPath = (fmt === 'webp' || fmt === 'avif')
        ? path.join(outDir, `_temp_${Date.now()}_${prefix}.png`)
        : outputBasePath;

      execFileSync('sips', ['-s', 'format', sipsFormat, inputPath, '--out', tempPath], { stdio: 'pipe' });
      
      if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
        if (fmt === 'webp') {
          try {
            execFileSync('cwebp', ['-q', String(quality), tempPath, '-o', outputBasePath], { stdio: 'pipe' });
          } catch {
            execFileSync(ffmpegBin, ['-y', '-i', tempPath, outputBasePath], { stdio: 'pipe' });
          }
          try { fs.unlinkSync(tempPath); } catch {}
          return [outputBasePath];
        } else if (fmt === 'avif') {
          execFileSync(ffmpegBin, ['-y', '-i', tempPath, outputBasePath], { stdio: 'pipe' });
          try { fs.unlinkSync(tempPath); } catch {}
          return [outputBasePath];
        }
        return [outputBasePath];
      }
    } catch {}
  }

  // Priority 2: Linux / Cross-platform pdftoppm (poppler-utils)
  try {
    const pagePrefix = path.join(outDir, prefix);
    const useJpegIntermediate = fmt === 'jpg' || fmt === 'jpeg';
    const pdftoppmArgs = ['-r', '150'];
    if (useJpegIntermediate) {
      pdftoppmArgs.push('-jpeg', '-jpegopt', `quality=${quality}`);
    } else {
      pdftoppmArgs.push('-png');
    }
    pdftoppmArgs.push(inputPath, pagePrefix);

    execFileSync('pdftoppm', pdftoppmArgs, { stdio: 'pipe' });

    const dirFiles = fs.readdirSync(outDir);
    const matchedPages: { pageNum: number; filePath: string }[] = [];
    for (const file of dirFiles) {
      if (!file.startsWith(`${prefix}-`)) continue;
      const suffix = file.slice(prefix.length + 1);
      const dotIdx = suffix.lastIndexOf('.');
      if (dotIdx <= 0) continue;
      const numPart = suffix.slice(0, dotIdx);
      const extPart = suffix.slice(dotIdx + 1).toLowerCase();
      if (!/^\d+$/.test(numPart)) continue;
      if (extPart !== 'png' && extPart !== 'jpg' && extPart !== 'jpeg') continue;
      matchedPages.push({ pageNum: parseInt(numPart, 10), filePath: path.join(outDir, file) });
    }
    matchedPages.sort((a, b) => a.pageNum - b.pageNum);

    if (matchedPages.length > 0) {
      const targetExt = parsed.ext ? parsed.ext.slice(1) : fmt;
      const needsTranscode = !useJpegIntermediate && fmt !== 'png';
      const finalPages: string[] = [];

      for (let i = 0; i < matchedPages.length; i++) {
        // eslint-disable-next-line security/detect-object-injection
        const srcFile = matchedPages[i].filePath;
        const targetPg = matchedPages.length === 1
          ? outputBasePath
          : path.join(outDir, `${prefix}_page_${i + 1}.${targetExt}`);

        if (needsTranscode) {
          if (fmt === 'webp') {
            try {
              execFileSync('cwebp', ['-q', String(quality), srcFile, '-o', targetPg], { stdio: 'pipe' });
            } catch {
              execFileSync(ffmpegBin, ['-y', '-i', srcFile, targetPg], { stdio: 'pipe' });
            }
          } else {
            execFileSync(ffmpegBin, ['-y', '-i', srcFile, targetPg], { stdio: 'pipe' });
          }
          try { fs.unlinkSync(srcFile); } catch {}
        } else if (srcFile !== targetPg) {
          fs.renameSync(srcFile, targetPg);
        }
        finalPages.push(targetPg);
      }
      return finalPages;
    }
  } catch (pdftoppmErr) {}

  // Priority 3: Universal fallback
  try {
    execFileSync('sips', ['-s', 'format', fmt === 'jpg' ? 'jpeg' : (fmt === 'webp' || fmt === 'avif' ? 'png' : fmt), inputPath, '--out', outputBasePath], { stdio: 'pipe' });
    if (fs.existsSync(outputBasePath)) {
      return [outputBasePath];
    }
  } catch {}

  throw new Error(`Failed to convert PDF document ${path.basename(inputPath)} to ${targetFormat.toUpperCase()}`);
}
