export const FOX_ORANGE = '235,72,38';
export const BASE_MOVE_DELAY = 45;
export const VERTICAL_CENTER_SLOWDOWN = 1.7;

export type FoxPixel = readonly [number, number];

export const foxPixels = [
  [1, 0],
  [10, 0],
  [1, 1],
  [2, 1],
  [3, 1],
  [8, 1],
  [9, 1],
  [10, 1],
  [1, 2],
  [2, 2],
  [3, 2],
  [4, 2],
  [5, 2],
  [6, 2],
  [7, 2],
  [8, 2],
  [9, 2],
  [10, 2],
  [2, 3],
  [3, 3],
  [8, 3],
  [9, 3],
  [0, 5],
  [1, 5],
  [2, 5],
  [9, 5],
  [10, 5],
  [11, 5],
  [0, 6],
  [1, 6],
  [2, 6],
  [9, 6],
  [10, 6],
  [11, 6],
  [1, 7],
  [2, 7],
  [3, 7],
  [8, 7],
  [9, 7],
  [10, 7],
  [2, 8],
  [3, 8],
  [8, 8],
  [9, 8],
  [3, 9],
  [8, 9],
  [4, 10],
  [7, 10],
  [5, 11],
  [6, 11],
] as const satisfies readonly FoxPixel[];

export const foxSet = new Set(foxPixels.map(([x, y]) => `${x},${y}`));

export type AnimationType = 'random' | 'vertical' | 'circular' | 'leftright';
export type ColorMode = 'orange' | 'white' | 'black';
export type BackgroundMode = 'dark' | 'light';

export type ShipfoxConfig = {
  ghostOpacity: number;
  lightRadius: number;
  lightBrightness: number;
  lightCurve: number;
  sizeScale: number;
  cursorRadius: number;
};

export const defaultConfig: ShipfoxConfig = {
  ghostOpacity: 0.2,
  lightRadius: 4,
  lightBrightness: 0.65,
  lightCurve: 4,
  sizeScale: 0.1,
  cursorRadius: 5,
};

export function shuffle(array: readonly FoxPixel[]): FoxPixel[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = result[i];
    const replacement = result[j];
    if (current && replacement) {
      result[i] = replacement;
      result[j] = current;
    }
  }
  return result;
}

export function generateRandomPath(): FoxPixel[] {
  return shuffle(foxPixels);
}

export function generateVerticalPath(): FoxPixel[] {
  const grouped: Record<number, number[]> = {};
  for (const [x, y] of foxPixels) {
    grouped[x] ??= [];
    grouped[x].push(y);
  }

  const columns = Object.keys(grouped)
    .map(Number)
    .sort((a, b) => a - b);
  const path: FoxPixel[] = [];

  for (const [index, column] of columns.entries()) {
    const yValues = grouped[column]?.sort((a, b) => a - b) ?? [];
    if (index % 2) {
      yValues.reverse();
    }
    for (const y of yValues) {
      path.push([column, y]);
    }
  }

  return path;
}

export function generateCircularPath(): FoxPixel[] {
  const center = {x: 6, y: 6};
  const sorted = [...foxPixels].sort(
    ([leftX, leftY], [rightX, rightY]) =>
      Math.atan2(leftY - center.y, leftX - center.x) -
      Math.atan2(rightY - center.y, rightX - center.x),
  );

  const startIndex = sorted.findIndex(([x, y]) => y < center.y && Math.abs(x - center.x) <= 1);
  const offset = (startIndex + 1) % sorted.length;

  return [...sorted.slice(offset), ...sorted.slice(0, offset)];
}

export function generateLeftToRightPath(): FoxPixel[] {
  const grouped: Record<number, number[]> = {};
  for (const [x, y] of foxPixels) {
    grouped[y] ??= [];
    grouped[y].push(x);
  }

  const rows = Object.keys(grouped)
    .map(Number)
    .sort((a, b) => a - b);
  const path: FoxPixel[] = [];

  for (const row of rows) {
    const xValues = grouped[row]?.sort((a, b) => a - b) ?? [];
    for (const x of xValues) {
      path.push([x, row]);
    }
  }

  return path;
}

export function getPathGenerator(animationType: AnimationType): () => FoxPixel[] {
  switch (animationType) {
    case 'vertical':
      return generateVerticalPath;
    case 'circular':
      return generateCircularPath;
    case 'leftright':
      return generateLeftToRightPath;
    case 'random':
      return generateRandomPath;
  }
}

export function getColor(colorMode: ColorMode, backgroundMode: BackgroundMode): string {
  if (colorMode === 'white') {
    return backgroundMode === 'dark' ? '255,255,255' : '0,0,0';
  }

  if (colorMode === 'black') {
    return backgroundMode === 'dark' ? '0,0,0' : '255,255,255';
  }

  return FOX_ORANGE;
}
