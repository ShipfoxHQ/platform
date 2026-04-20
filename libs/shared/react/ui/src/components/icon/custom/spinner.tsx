import type {RemixiconComponentType} from '@remixicon/react';
import {motion, type SVGMotionProps, type Variants} from 'framer-motion';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';

const SEGMENT_COUNT = 8;
const DURATION = 1.2;
const BASE_OPACITY = 0;

const CLOCKWISE_ORDER = [1, 8, 4, 6, 2, 7, 3, 5];

const segmentVariants: Record<string, Variants> = {};

for (let i = 0; i < SEGMENT_COUNT; i++) {
  const segmentIndex = CLOCKWISE_ORDER[i];
  const delay = (i * DURATION) / SEGMENT_COUNT;

  segmentVariants[`segment${segmentIndex}`] = {
    initial: {opacity: BASE_OPACITY},
    animate: {
      opacity: [BASE_OPACITY, 1, BASE_OPACITY],
      transition: {
        duration: DURATION,
        ease: 'easeInOut',
        repeat: Infinity,
        repeatType: 'loop',
        delay,
        times: [0, 0.5, 1],
      },
    },
  };
}

function getSegmentVariants(segment: number): Variants {
  return segmentVariants[`segment${segment}`] ?? {};
}

export function SpinnerIcon(props: ComponentProps<RemixiconComponentType>) {
  const {className, size, ...restProps} = props;

  const iconSize = size ?? 24;

  const svgProps: SVGMotionProps<SVGSVGElement> = {
    width: typeof iconSize === 'number' ? String(iconSize) : iconSize,
    height: typeof iconSize === 'number' ? String(iconSize) : iconSize,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    className: cn(className),
    initial: 'initial',
    animate: 'animate',
    ...(restProps as unknown as SVGMotionProps<SVGSVGElement>),
  };
  return (
    <motion.svg {...svgProps}>
      <title>Spinner</title>
      <motion.path
        d="M10.583 1.91667C10.583 1.41041 10.9934 1 11.4997 1C12.0059 1 12.4163 1.41041 12.4163 1.91667V5.58333C12.4163 6.08959 12.0059 6.5 11.4997 6.5C10.9934 6.5 10.583 6.08959 10.583 5.58333V1.91667Z"
        fill="currentColor"
        stroke="currentColor"
        style={{fill: 'currentColor', fillOpacity: 1, stroke: 'currentColor', strokeOpacity: 1}}
        strokeWidth="0.916667"
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={getSegmentVariants(1)}
      />
      <motion.rect
        x="10.583"
        y="17.5"
        width="1.83333"
        height="5.5"
        rx="0.916667"
        fill="currentColor"
        stroke="currentColor"
        style={{fill: 'currentColor', fillOpacity: 1, stroke: 'currentColor', strokeOpacity: 1}}
        strokeWidth="0.916667"
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={getSegmentVariants(2)}
      />
      <motion.path
        d="M1.41667 12.918C0.910406 12.918 0.5 12.5076 0.5 12.0013C0.5 11.495 0.910405 11.0846 1.41667 11.0846L5.08333 11.0846C5.58959 11.0846 6 11.495 6 12.0013C6 12.5076 5.58959 12.918 5.08333 12.918L1.41667 12.918Z"
        fill="currentColor"
        stroke="currentColor"
        style={{fill: 'currentColor', fillOpacity: 1, stroke: 'currentColor', strokeOpacity: 1}}
        strokeWidth="0.916667"
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={getSegmentVariants(3)}
      />
      <motion.path
        d="M17.9167 12.918C17.4104 12.918 17 12.5076 17 12.0013C17 11.495 17.4104 11.0846 17.9167 11.0846L21.5833 11.0846C22.0896 11.0846 22.5 11.495 22.5 12.0013C22.5 12.5076 22.0896 12.918 21.5833 12.918L17.9167 12.918Z"
        fill="currentColor"
        stroke="currentColor"
        style={{fill: 'currentColor', fillOpacity: 1, stroke: 'currentColor', strokeOpacity: 1}}
        strokeWidth="0.916667"
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={getSegmentVariants(4)}
      />
      <motion.path
        d="M3.7224 5.52123C3.36442 5.16325 3.36442 4.58285 3.7224 4.22487C4.08038 3.86689 4.66078 3.86688 5.01876 4.22487L7.61149 6.81759C7.96947 7.17557 7.96947 7.75597 7.61149 8.11395C7.25351 8.47193 6.67311 8.47193 6.31512 8.11395L3.7224 5.52123Z"
        fill="currentColor"
        stroke="currentColor"
        style={{fill: 'currentColor', fillOpacity: 1, stroke: 'currentColor', strokeOpacity: 1}}
        strokeWidth="0.916667"
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={getSegmentVariants(5)}
      />
      <motion.rect
        x="14.7412"
        y="16.5391"
        width="1.83333"
        height="5.5"
        rx="0.916667"
        transform="rotate(-45 14.7412 16.5391)"
        fill="currentColor"
        stroke="currentColor"
        style={{fill: 'currentColor', fillOpacity: 1, stroke: 'currentColor', strokeOpacity: 1}}
        strokeWidth="0.916667"
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={getSegmentVariants(6)}
      />
      <motion.path
        d="M5.0183 19.7796C4.66032 20.1375 4.07992 20.1375 3.72194 19.7796C3.36396 19.4216 3.36396 18.8412 3.72194 18.4832L6.31466 15.8905C6.67264 15.5325 7.25304 15.5325 7.61102 15.8905C7.969 16.2484 7.969 16.8288 7.61102 17.1868L5.0183 19.7796Z"
        fill="currentColor"
        stroke="currentColor"
        style={{fill: 'currentColor', fillOpacity: 1, stroke: 'currentColor', strokeOpacity: 1}}
        strokeWidth="0.916667"
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={getSegmentVariants(7)}
      />
      <motion.path
        d="M16.6853 8.11354C16.3273 8.47152 15.7469 8.47152 15.3889 8.11354C15.0309 7.75556 15.0309 7.17516 15.3889 6.81718L17.9817 4.22445C18.3396 3.86647 18.92 3.86647 19.278 4.22445C19.636 4.58243 19.636 5.16283 19.278 5.52081L16.6853 8.11354Z"
        fill="currentColor"
        stroke="currentColor"
        style={{fill: 'currentColor', fillOpacity: 1, stroke: 'currentColor', strokeOpacity: 1}}
        strokeWidth="0.916667"
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={getSegmentVariants(8)}
      />
    </motion.svg>
  );
}
