/* eslint-disable security/detect-object-injection */
/**
 * Pure TypeScript ISO/IEC 18004 QR Code Matrix Generator (Byte mode, Versions 1-10, ECC Level M & Q).
 * Zero external dependencies; designed for instant client-side SVG rendering of UPI payment URIs.
 */

export type QrEccLevel = 'M' | 'Q';

interface VersionSpec {
  version: number;
  size: number;
  totalCodewords: number;
  ecCodewordsPerBlock: number;
  numBlocksGroup1: number;
  dataCodewordsGroup1: number;
  numBlocksGroup2: number;
  dataCodewordsGroup2: number;
  alignmentCenters: number[];
}

// ISO/IEC 18004 Table 9 — ECC Level Q (25% recovery, ideal when placing a center emblem)
const VERSION_SPECS_Q: VersionSpec[] = [
  { version: 1, size: 21, totalCodewords: 26, ecCodewordsPerBlock: 13, numBlocksGroup1: 1, dataCodewordsGroup1: 13, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [] },
  { version: 2, size: 25, totalCodewords: 44, ecCodewordsPerBlock: 22, numBlocksGroup1: 1, dataCodewordsGroup1: 22, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 18] },
  { version: 3, size: 29, totalCodewords: 70, ecCodewordsPerBlock: 18, numBlocksGroup1: 2, dataCodewordsGroup1: 17, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 22] },
  { version: 4, size: 33, totalCodewords: 100, ecCodewordsPerBlock: 26, numBlocksGroup1: 2, dataCodewordsGroup1: 24, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 26] },
  { version: 5, size: 37, totalCodewords: 134, ecCodewordsPerBlock: 18, numBlocksGroup1: 2, dataCodewordsGroup1: 15, numBlocksGroup2: 2, dataCodewordsGroup2: 16, alignmentCenters: [6, 30] },
  { version: 6, size: 41, totalCodewords: 172, ecCodewordsPerBlock: 24, numBlocksGroup1: 4, dataCodewordsGroup1: 19, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 34] },
  { version: 7, size: 45, totalCodewords: 196, ecCodewordsPerBlock: 18, numBlocksGroup1: 2, dataCodewordsGroup1: 14, numBlocksGroup2: 4, dataCodewordsGroup2: 15, alignmentCenters: [6, 22, 38] },
  { version: 8, size: 49, totalCodewords: 242, ecCodewordsPerBlock: 22, numBlocksGroup1: 4, dataCodewordsGroup1: 18, numBlocksGroup2: 2, dataCodewordsGroup2: 19, alignmentCenters: [6, 24, 42] },
];

// ECC Level M (15% recovery)
const VERSION_SPECS_M: VersionSpec[] = [
  { version: 1, size: 21, totalCodewords: 26, ecCodewordsPerBlock: 10, numBlocksGroup1: 1, dataCodewordsGroup1: 16, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [] },
  { version: 2, size: 25, totalCodewords: 44, ecCodewordsPerBlock: 16, numBlocksGroup1: 1, dataCodewordsGroup1: 28, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 18] },
  { version: 3, size: 29, totalCodewords: 70, ecCodewordsPerBlock: 26, numBlocksGroup1: 1, dataCodewordsGroup1: 44, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 22] },
  { version: 4, size: 33, totalCodewords: 100, ecCodewordsPerBlock: 18, numBlocksGroup1: 2, dataCodewordsGroup1: 32, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 26] },
  { version: 5, size: 37, totalCodewords: 134, ecCodewordsPerBlock: 24, numBlocksGroup1: 2, dataCodewordsGroup1: 43, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 30] },
  { version: 6, size: 41, totalCodewords: 172, ecCodewordsPerBlock: 16, numBlocksGroup1: 4, dataCodewordsGroup1: 27, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 34] },
  { version: 7, size: 45, totalCodewords: 196, ecCodewordsPerBlock: 18, numBlocksGroup1: 4, dataCodewordsGroup1: 31, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCenters: [6, 22, 38] },
  { version: 8, size: 49, totalCodewords: 242, ecCodewordsPerBlock: 22, numBlocksGroup1: 2, dataCodewordsGroup1: 38, numBlocksGroup2: 2, dataCodewordsGroup2: 39, alignmentCenters: [6, 24, 42] },
];

// GF(256) log/exp tables with primitive polynomial 0x11D
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    // eslint-disable-next-line security/detect-object-injection
    GF_EXP[i] = x;
    // eslint-disable-next-line security/detect-object-injection
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    // eslint-disable-next-line security/detect-object-injection
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  // eslint-disable-next-line security/detect-object-injection
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    // eslint-disable-next-line security/detect-object-injection
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      // eslint-disable-next-line security/detect-object-injection
      next[j] ^= poly[j];
      // eslint-disable-next-line security/detect-object-injection
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsComputeRemainder(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        // eslint-disable-next-line security/detect-object-injection
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function pickVersion(byteLength: number, ecc: QrEccLevel): VersionSpec {
  const table = ecc === 'Q' ? VERSION_SPECS_Q : VERSION_SPECS_M;
  for (const spec of table) {
    const capacityDataCodewords =
      spec.numBlocksGroup1 * spec.dataCodewordsGroup1 +
      spec.numBlocksGroup2 * spec.dataCodewordsGroup2;
    // Byte mode header is 4 bits mode + 8 bits length (for versions 1-9) = 12 bits
    const maxBytes = capacityDataCodewords - 2;
    if (byteLength <= maxBytes) return spec;
  }
  return table[table.length - 1];
}

function encodeDataCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const totalDataCodewords =
    spec.numBlocksGroup1 * spec.dataCodewordsGroup1 +
    spec.numBlocksGroup2 * spec.dataCodewordsGroup2;

  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Mode indicator for Byte mode = 0100
  pushBits(0b0100, 4);
  // Character count indicator (8 bits for versions 1-9)
  pushBits(bytes.length, 8);
  for (let i = 0; i < bytes.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    pushBits(bytes[i], 8);
  }

  // Terminator (up to 4 zero bits)
  const maxBits = totalDataCodewords * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  pushBits(0, termLen);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const codewords = new Uint8Array(totalDataCodewords);
  const byteLen = bits.length / 8;
  for (let i = 0; i < byteLen; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j];
    }
    // eslint-disable-next-line security/detect-object-injection
    codewords[i] = b;
  }

  // Pad codewords alternating 0xEC, 0x11
  const pads = [0xec, 0x11];
  for (let i = byteLen; i < totalDataCodewords; i++) {
    // eslint-disable-next-line security/detect-object-injection
    codewords[i] = pads[(i - byteLen) & 1];
  }

  return codewords;
}

function interleaveCodewords(dataCodewords: Uint8Array, spec: VersionSpec): Uint8Array {
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < spec.numBlocksGroup1; i++) {
    const block = dataCodewords.slice(offset, offset + spec.dataCodewordsGroup1);
    offset += spec.dataCodewordsGroup1;
    dataBlocks.push(block);
    ecBlocks.push(rsComputeRemainder(block, spec.ecCodewordsPerBlock));
  }
  for (let i = 0; i < spec.numBlocksGroup2; i++) {
    const block = dataCodewords.slice(offset, offset + spec.dataCodewordsGroup2);
    offset += spec.dataCodewordsGroup2;
    dataBlocks.push(block);
    ecBlocks.push(rsComputeRemainder(block, spec.ecCodewordsPerBlock));
  }

  const result = new Uint8Array(spec.totalCodewords);
  let outIdx = 0;
  const maxDataLen = Math.max(spec.dataCodewordsGroup1, spec.dataCodewordsGroup2);
  for (let col = 0; col < maxDataLen; col++) {
    for (let b = 0; b < dataBlocks.length; b++) {
      // eslint-disable-next-line security/detect-object-injection
      if (col < dataBlocks[b].length) {
        // eslint-disable-next-line security/detect-object-injection
        result[outIdx++] = dataBlocks[b][col];
      }
    }
  }
  for (let col = 0; col < spec.ecCodewordsPerBlock; col++) {
    for (let b = 0; b < ecBlocks.length; b++) {
      // eslint-disable-next-line security/detect-object-injection
      result[outIdx++] = ecBlocks[b][col];
    }
  }
  return result;
}

function computeFormatBits(ecc: QrEccLevel, mask: number): number {
  // Format indicator: M = 00, Q = 11
  const eccBits = ecc === 'Q' ? 0b11 : 0b00;
  const data = (eccBits << 3) | (mask & 0b111);
  let rem = data << 10;
  const gen = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) {
      rem ^= gen << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

function applyMaskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function scorePenalty(modules: boolean[][], size: number): number {
  let penalty = 0;

  // Rule 1: 5+ consecutive same-colored modules in row/col
  for (let r = 0; r < size; r++) {
    let runColor = modules[r][0];
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  for (let c = 0; c < size; c++) {
    let runColor = modules[0][c];
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // Rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }

  return penalty;
}

export function generateQrMatrix(text: string, ecc: QrEccLevel = 'Q'): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const spec = pickVersion(bytes.length, ecc);
  const size = spec.size;

  const baseModules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      baseModules[r][c] = dark;
      isFunction[r][c] = true;
    }
  };

  // Finder patterns + separators
  const drawFinder = (topR: number, leftC: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = topR + dr;
        const c = leftC + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onOuterBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter && (onOuterBorder || inInner));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const centers = spec.alignmentCenters;
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === centers.length - 1) ||
        (i === centers.length - 1 && j === 0)
      ) {
        continue;
      }
      const cr = centers[i];
      const cc = centers[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(cr + dr, cc + dc, dark);
        }
      }
    }
  }

  // Dark module & reserved format areas
  setFunctionModule(size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      if (!isFunction[8][i]) setFunctionModule(8, i, false);
      if (!isFunction[i][8]) setFunctionModule(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunction[8][size - 1 - i]) setFunctionModule(8, size - 1 - i, false);
    if (!isFunction[size - 1 - i][8]) setFunctionModule(size - 1 - i, 8, false);
  }

  // Encode & interleave data + EC codewords
  const dataCw = encodeDataCodewords(bytes, spec);
  const allCw = interleaveCodewords(dataCw, spec);

  // Zigzag placement
  let bitIdx = 0;
  const totalBits = allCw.length * 8;
  let upward = true;
  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = rightCol - dc;
        if (!isFunction[r][c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            const byteVal = allCw[bitIdx >>> 3];
            dark = ((byteVal >>> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          baseModules[r][c] = dark;
        }
      }
    }
    upward = !upward;
  }

  const writeFormatInfo = (grid: boolean[][], mask: number) => {
    const bits = computeFormatBits(ecc, mask);
    for (let i = 0; i <= 5; i++) grid[8][i] = ((bits >>> i) & 1) === 1;
    grid[8][7] = ((bits >>> 6) & 1) === 1;
    grid[8][8] = ((bits >>> 7) & 1) === 1;
    grid[7][8] = ((bits >>> 8) & 1) === 1;
    for (let i = 9; i < 15; i++) grid[14 - i][8] = ((bits >>> i) & 1) === 1;

    for (let i = 0; i < 8; i++) grid[8][size - 1 - i] = ((bits >>> i) & 1) === 1;
    for (let i = 8; i < 15; i++) grid[size - 15 + i][8] = ((bits >>> i) & 1) === 1;
    grid[size - 8][8] = true;
  };

  let bestGrid = baseModules;
  let bestScore = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = baseModules.map((row, r) =>
      row.map((val, c) => (isFunction[r][c] ? val : val !== applyMaskBit(mask, r, c)))
    );
    writeFormatInfo(candidate, mask);
    const score = scorePenalty(candidate, size);
    if (score < bestScore) {
      bestScore = score;
      bestGrid = candidate;
    }
  }

  return bestGrid;
}
