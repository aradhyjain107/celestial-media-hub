import { expect, describe, test, beforeEach, afterEach } from 'vitest';
import { isPdfFile, convertPdfToImage } from '../../lib/pdfRasterizer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('PDF Rasterizer (lib/pdfRasterizer.ts)', () => {
  let tmpDir: string;
  let pdfPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-pdf-test-'));
    pdfPath = path.join(tmpDir, 'test.pdf');
    // Valid minimal 1-page PDF
    const pdfContent = '%PDF-1.4\n' +
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/MediaBox[0 0 300 144]/Parent 2 0 R/Resources<<>>>>endobj\n' +
      'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \n' +
      'trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF';
    fs.writeFileSync(pdfPath, pdfContent);
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('isPdfFile correctly identifies .pdf files (case-insensitive)', () => {
    expect(isPdfFile('document.pdf')).toBe(true);
    expect(isPdfFile('REPORT.PDF')).toBe(true);
    expect(isPdfFile('/path/to/scan.pdf')).toBe(true);
    expect(isPdfFile('photo.png')).toBe(false);
    expect(isPdfFile('video.mp4')).toBe(false);
  });

  test('convertPdfToImage rasterizes real PDF to PNG', async () => {
    const outPng = path.join(tmpDir, 'output.png');
    const result = await convertPdfToImage(pdfPath, outPng, 'png');
    expect(result).toEqual([outPng]);
    expect(fs.existsSync(outPng)).toBe(true);
    expect(fs.statSync(outPng).size).toBeGreaterThan(0);
  });

  test('convertPdfToImage rasterizes real PDF to JPEG with quality options', async () => {
    const outJpg = path.join(tmpDir, 'output.jpg');
    const result = await convertPdfToImage(pdfPath, outJpg, 'jpg', { quality: 90 });
    expect(result).toEqual([outJpg]);
    expect(fs.existsSync(outJpg)).toBe(true);
    expect(fs.statSync(outJpg).size).toBeGreaterThan(0);
  });

  test('convertPdfToImage rasterizes real PDF to WebP via intermediate PNG', async () => {
    const outWebp = path.join(tmpDir, 'output.webp');
    const result = await convertPdfToImage(pdfPath, outWebp, 'webp', { quality: 80 });
    expect(result).toEqual([outWebp]);
    expect(fs.existsSync(outWebp)).toBe(true);
    expect(fs.statSync(outWebp).size).toBeGreaterThan(0);
  });

  test('convertPdfToImage rasterizes real PDF to TIFF and BMP', async () => {
    const outTiff = path.join(tmpDir, 'output.tiff');
    const resTiff = await convertPdfToImage(pdfPath, outTiff, 'tiff');
    expect(resTiff).toEqual([outTiff]);
    expect(fs.existsSync(outTiff)).toBe(true);

    const outBmp = path.join(tmpDir, 'output.bmp');
    const resBmp = await convertPdfToImage(pdfPath, outBmp, 'bmp');
    expect(resBmp).toEqual([outBmp]);
    expect(fs.existsSync(outBmp)).toBe(true);
  });

  test('convertPdfToImage rasterizes all pages from a multi-page PDF', async () => {
    const multiPdfPath = path.join(tmpDir, 'multipage.pdf');
    const multiPdfContent = '%PDF-1.4\n' +
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R 5 0 R]/Count 3>>endobj\n' +
      '3 0 obj<</Type/Page/MediaBox[0 0 300 144]/Parent 2 0 R/Resources<<>>>>endobj\n' +
      '4 0 obj<</Type/Page/MediaBox[0 0 300 144]/Parent 2 0 R/Resources<<>>>>endobj\n' +
      '5 0 obj<</Type/Page/MediaBox[0 0 300 144]/Parent 2 0 R/Resources<<>>>>endobj\n' +
      'xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000127 00000 n \n0000000206 00000 n \n0000000285 00000 n \n' +
      'trailer<</Size 6/Root 1 0 R>>\nstartxref\n364\n%%EOF';
    fs.writeFileSync(multiPdfPath, multiPdfContent);

    const outPng = path.join(tmpDir, 'converted_multipage.png');
    const pages = await convertPdfToImage(multiPdfPath, outPng, 'png');
    expect(pages.length).toBe(3);
    pages.forEach((p, idx) => {
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.statSync(p).size).toBeGreaterThan(0);
      expect(p).toContain(`converted_multipage_page_${idx + 1}.png`);
    });
  });
});
