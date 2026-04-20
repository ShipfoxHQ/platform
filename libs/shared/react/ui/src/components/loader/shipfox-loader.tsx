import {
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {cn} from '../../utils/cn.js';
import {
  type AnimationType,
  BASE_MOVE_DELAY,
  type BackgroundMode,
  type ColorMode,
  defaultConfig,
  foxPixels,
  getColor,
  getPathGenerator,
  type ShipfoxConfig,
  VERTICAL_CENTER_SLOWDOWN,
} from './animation-utils.js';

const CURSOR_MAX_INTENSITY = 1;
const CURSOR_CURVE_POWER = 2.2;
const HOVER_RISE_SPEED = 0.35;
const HOVER_DECAY_MS = 240;
const LIGHT_BACKGROUND_OPACITY_REDUCTION = 2;
const FOX_GRID_SIZE = 12;
const BASE_CANVAS_SIZE = 60;
const TRAIL_GLOW_VALUES = [1, 0.7, 0.45, 0.25] as const;

export type ShipfoxLoaderProps = {
  size?: number;
  animation?: AnimationType;
  color?: ColorMode;
  background?: BackgroundMode;
  showControls?: boolean;
  autoPlay?: boolean;
  speed?: number;
  config?: Partial<ShipfoxConfig>;
  className?: string;
  style?: CSSProperties;
  onAnimationComplete?: () => void;
};

function brightenColor(color: string, intensity: number) {
  const [red = 0, green = 0, blue = 0] = color.split(',').map(Number);
  const brightRed = Math.min(255, red + (255 - red) * intensity);
  const brightGreen = Math.min(255, green + (255 - green) * intensity);
  const brightBlue = Math.min(255, blue + (255 - blue) * intensity);

  return [brightRed, brightGreen, brightBlue] as const;
}

export function ShipfoxLoader({
  size = 60,
  animation = 'random',
  color = 'orange',
  background = 'dark',
  showControls = false,
  autoPlay = true,
  speed = 1,
  config = {},
  className,
  style,
  onAnimationComplete,
}: ShipfoxLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const lastMoveTimeRef = useRef(0);
  const currentIndexRef = useRef(0);
  const lastTimestampRef = useRef(0);
  const isRunningRef = useRef(false);
  const litPixelsRef = useRef<Set<string>>(new Set());
  const trailRef = useRef<Array<{x: number; y: number}>>([]);
  const hoverIntensitiesRef = useRef(new Float32Array(foxPixels.length));
  const cursorRef = useRef({x: -9999, y: -9999, active: false});

  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const finalConfig = useMemo(() => ({...defaultConfig, ...config}), [config]);
  const resetAnimationKey = `${animation}:${background}:${color}:${size}`;
  const cellSize = size / FOX_GRID_SIZE;

  const cursorIntensityFor = useCallback(
    (pixelX: number, pixelY: number, canvasRect: DOMRect) => {
      if (!cursorRef.current.active) {
        return 0;
      }

      const sizeMultiplier = (cellSize * FOX_GRID_SIZE) / BASE_CANVAS_SIZE;
      const radius =
        finalConfig.cursorRadius *
        (1 + (1 / sizeMultiplier - 1) * finalConfig.sizeScale) *
        cellSize;
      const plateau = radius * 0.4;
      const centerX = canvasRect.left + (pixelX + 0.5) * cellSize;
      const centerY = canvasRect.top + (pixelY + 0.5) * cellSize;
      const distance = Math.hypot(cursorRef.current.x - centerX, cursorRef.current.y - centerY);

      if (distance > radius) {
        return 0;
      }

      if (distance <= plateau) {
        return 1;
      }

      const falloff = (distance - plateau) / (radius - plateau);
      return Math.max(0, CURSOR_MAX_INTENSITY * (1 - falloff) ** CURSOR_CURVE_POWER);
    },
    [cellSize, finalConfig],
  );

  const draw = useCallback(
    (timestamp: number) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }

      const deltaTime = Math.max(0, timestamp - lastTimestampRef.current);
      lastTimestampRef.current = timestamp;

      context.clearRect(0, 0, canvas.width, canvas.height);
      const canvasRect = canvas.getBoundingClientRect();
      const sizeMultiplier = canvas.width / BASE_CANVAS_SIZE;
      let ghostOpacity = Math.max(
        0.01,
        finalConfig.ghostOpacity * (1 - (sizeMultiplier - 1) * finalConfig.sizeScale),
      );

      if (background === 'light') {
        ghostOpacity /= LIGHT_BACKGROUND_OPACITY_REDUCTION;
      }

      const snakeHead = trailRef.current[0] ?? null;
      const currentColor = getColor(color, background);

      for (let index = 0; index < foxPixels.length; index += 1) {
        const pixel = foxPixels[index];
        if (!pixel) {
          continue;
        }

        const [x, y] = pixel;
        const pixelKey = `${x},${y}`;
        const targetIntensity = cursorIntensityFor(x, y, canvasRect);
        const currentHoverIntensity = hoverIntensitiesRef.current[index] ?? 0;

        if (targetIntensity > currentHoverIntensity) {
          hoverIntensitiesRef.current[index] =
            currentHoverIntensity +
            (targetIntensity - currentHoverIntensity) *
              (1 - (1 - HOVER_RISE_SPEED) ** (deltaTime / 16));
        } else {
          hoverIntensitiesRef.current[index] = Math.max(
            ghostOpacity,
            currentHoverIntensity * Math.exp(-deltaTime / HOVER_DECAY_MS),
          );
        }

        let fillColor: string;
        if (litPixelsRef.current.has(pixelKey)) {
          fillColor = `rgba(${currentColor},1)`;

          if (snakeHead && background !== 'light') {
            const distanceX = Math.abs(x - snakeHead.x);
            const distanceY = Math.abs(y - snakeHead.y);
            const distance = Math.max(distanceX, distanceY);
            const scaledRadius = Math.max(
              1,
              Math.round(
                finalConfig.lightRadius * (1 - (sizeMultiplier - 1) * finalConfig.sizeScale),
              ),
            );

            if (distance > 0 && distance <= scaledRadius) {
              const falloff = (1 - distance / scaledRadius) ** finalConfig.lightCurve;
              const brightness = Math.max(
                0.05,
                finalConfig.lightBrightness * (1 - (sizeMultiplier - 1) * finalConfig.sizeScale),
              );
              const [brightRed, brightGreen, brightBlue] = brightenColor(
                currentColor,
                falloff * brightness,
              );
              fillColor = `rgb(${brightRed},${brightGreen},${brightBlue})`;
            }
          }
        } else if (background === 'light') {
          const hoverTarget = cursorIntensityFor(x, y, canvasRect);
          fillColor =
            hoverTarget > 0 ? `rgba(${currentColor},1)` : `rgba(${currentColor},${ghostOpacity})`;
        } else {
          const [red = 0, green = 0, blue = 0] = currentColor.split(',').map(Number);
          const intensity = Math.min(1, hoverIntensitiesRef.current[index] ?? 0);
          fillColor = `rgba(${red},${green},${blue},${intensity})`;
        }

        context.fillStyle = fillColor;
        context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }

      if (background !== 'light') {
        for (let index = 0; index < trailRef.current.length; index += 1) {
          const trailPixel = trailRef.current[index];
          const glowIntensity = TRAIL_GLOW_VALUES[index];
          if (!trailPixel || glowIntensity === undefined) {
            continue;
          }

          const [brightRed, brightGreen, brightBlue] = brightenColor(
            currentColor,
            glowIntensity * 0.5,
          );
          context.fillStyle = `rgba(${brightRed},${brightGreen},${brightBlue},${glowIntensity})`;
          context.fillRect(trailPixel.x * cellSize, trailPixel.y * cellSize, cellSize, cellSize);
        }
      }
    },
    [background, cellSize, color, cursorIntensityFor, finalConfig],
  );

  const animationStep = useCallback(
    (timestamp: number) => {
      if (!isRunningRef.current || !isPlaying) {
        return;
      }

      draw(timestamp);

      const path = getPathGenerator(animation)();
      const litRatio = litPixelsRef.current.size / foxPixels.length;
      let moveDelay = BASE_MOVE_DELAY / speed;

      if (animation === 'random') {
        moveDelay = (BASE_MOVE_DELAY / speed) * (0.7 + litRatio * 1.1);
      } else if (animation === 'vertical') {
        const currentPixel = path[currentIndexRef.current];
        const [currentX] = currentPixel ?? [0, 0];
        moveDelay =
          currentX >= 4 && currentX <= 7
            ? (BASE_MOVE_DELAY / speed) * VERTICAL_CENTER_SLOWDOWN
            : BASE_MOVE_DELAY / speed;
      }

      const currentTime = performance.now();
      if (!lastMoveTimeRef.current) {
        lastMoveTimeRef.current = currentTime;
      }

      if (currentTime - lastMoveTimeRef.current > moveDelay) {
        const currentPixel = path[currentIndexRef.current];
        if (currentPixel) {
          const [x, y] = currentPixel;
          trailRef.current.unshift({x, y});
          if (trailRef.current.length > 4) {
            trailRef.current.pop();
          }

          const pixelKey = `${x},${y}`;
          if (litPixelsRef.current.has(pixelKey)) {
            litPixelsRef.current.delete(pixelKey);
          } else {
            litPixelsRef.current.add(pixelKey);
          }

          currentIndexRef.current = (currentIndexRef.current + 1) % path.length;
          lastMoveTimeRef.current = currentTime;

          if (currentIndexRef.current === 0) {
            onAnimationComplete?.();
          }
        }
      }

      animationRef.current = requestAnimationFrame(animationStep);
    },
    [animation, draw, isPlaying, onAnimationComplete, speed],
  );

  const handleMouseMove = useCallback((event: MouseEvent<HTMLCanvasElement>) => {
    cursorRef.current.x = event.clientX;
    cursorRef.current.y = event.clientY;
    cursorRef.current.active = true;
  }, []);

  const handleMouseLeave = useCallback(() => {
    cursorRef.current.active = false;
  }, []);

  const startAnimation = useCallback(() => {
    if (!isRunningRef.current) {
      isRunningRef.current = true;
      setIsPlaying(true);
      animationRef.current = requestAnimationFrame(animationStep);
    }
  }, [animationStep]);

  const stopAnimation = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = undefined;
    }
    isRunningRef.current = false;
    setIsPlaying(false);
  }, []);

  const resetAnimation = useCallback(() => {
    litPixelsRef.current.clear();
    trailRef.current = [];
    currentIndexRef.current = 0;
    lastMoveTimeRef.current = 0;
    hoverIntensitiesRef.current.fill(0);
  }, []);

  useEffect(() => {
    if (autoPlay && isPlaying) {
      startAnimation();
    } else if (!isPlaying) {
      stopAnimation();
    }

    return () => {
      stopAnimation();
    };
  }, [autoPlay, isPlaying, startAnimation, stopAnimation]);

  useEffect(() => {
    if (resetAnimationKey) {
      resetAnimation();
    }
  }, [resetAnimation, resetAnimationKey]);

  return (
    <div className={cn('shipfox-loader', className)} style={style}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          imageRendering: 'pixelated',
          display: 'block',
          margin: '0 auto',
        }}
      />
      {showControls && (
        <div style={{marginTop: 10, textAlign: 'center'}}>
          <button type="button" onClick={isPlaying ? stopAnimation : startAnimation}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={resetAnimation} style={{marginLeft: 10}}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
