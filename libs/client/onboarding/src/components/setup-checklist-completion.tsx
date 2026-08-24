import {Button} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
import {Text} from '@shipfox/react-ui/typography';
import {useEffect, useRef} from 'react';
import {createConfettiParticles} from './setup-checklist-confetti.js';

const JSDOM_USER_AGENT_RE = /jsdom/u;
const CONFETTI_DURATION_MS = 2000;
const CONFETTI_RANDOM_SEED = 0x5f3759df;

export function SetupChecklistCompletion({
  showBurst,
  onBurstComplete,
  onDone,
}: {
  showBurst: boolean;
  onBurstComplete?: (() => void) | undefined;
  onDone?: (() => void) | undefined;
}) {
  return (
    <div className="relative overflow-hidden border-b border-tag-success-border bg-tag-success-bg p-panel">
      <ConfettiBurst active={showBurst} onComplete={onBurstComplete} />
      <div className="relative flex items-center gap-group">
        <Icon
          name="checkCircleSolid"
          className="size-20 shrink-0 text-tag-success-icon"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <Text size="sm" bold className="text-tag-success-text">
            You're set up
          </Text>
          <Text size="xs" className="text-tag-success-text">
            Your workspace is ready for its first workflow.
          </Text>
        </div>
        <Button type="button" size="sm" variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function ConfettiBurst({
  active,
  onComplete,
}: {
  active: boolean;
  onComplete?: (() => void) | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      onComplete?.();
    };

    const prefersReducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    if (typeof navigator !== 'undefined' && JSDOM_USER_AGENT_RE.test(navigator.userAgent)) {
      finish();
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      finish();
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 && bounds.height === 0) {
      finish();
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      finish();
      return;
    }

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(bounds.width, 1);
    const height = Math.max(bounds.height, 1);
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    context.scale(pixelRatio, pixelRatio);

    const styles = getComputedStyle(canvas);
    const colors = [
      styles.getPropertyValue('--color-background-accent-blue-base').trim(),
      styles.getPropertyValue('--color-background-accent-purple-base').trim(),
      styles.getPropertyValue('--color-background-accent-success-base').trim(),
      styles.getPropertyValue('--color-background-accent-warning-base').trim(),
    ].filter(Boolean);
    if (colors.length === 0) {
      finish();
      return;
    }
    const particles = createConfettiParticles(
      width,
      height,
      colors,
      prefersReducedMotion ? CONFETTI_RANDOM_SEED : undefined,
    );
    let frame = 0;
    const startedAt = performance.now();

    const draw = (now: number, advance = true) => {
      const elapsed = now - startedAt;
      context.clearRect(0, 0, width, height);
      context.globalAlpha = Math.max(0, 1 - elapsed / CONFETTI_DURATION_MS);
      for (const particle of particles) {
        if (advance) {
          particle.vy += 0.025;
          particle.vx *= 0.985;
          particle.x += particle.vx;
          particle.y += particle.vy;
          particle.rotation += 0.1;
        }
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        context.fillRect(
          -particle.size / 2,
          -particle.size / 2,
          particle.size,
          particle.size * 0.6,
        );
        context.restore();
      }
      context.globalAlpha = 1;
      if (!advance) return;
      if (elapsed < CONFETTI_DURATION_MS) {
        frame = requestAnimationFrame(draw);
      } else {
        finish();
      }
    };

    if (prefersReducedMotion) {
      draw(startedAt, false);
      finish();
      // Keep the static frame after hosts consume the burst immediately.
      return;
    }

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      context.clearRect(0, 0, width, height);
    };
  }, [active, onComplete]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 size-full">
      <canvas ref={canvasRef} className="size-full" />
    </div>
  );
}
