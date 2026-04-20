import type {RemixiconComponentType} from '@remixicon/react';
import type {ComponentProps} from 'react';

type ShipfoxLogoProps = ComponentProps<RemixiconComponentType> & {
  color?: string;
};

export function ShipfoxLogo({color = '#FF4B00', ...props}: ShipfoxLogoProps) {
  return (
    <svg viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <title>Shipfox Logo</title>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M17.9759 32.3751L39.0987 74.1549C41.1536 78.2196 46.847 78.2196 48.902 74.1549L70.0247 32.3751L81.2835 38.122C84.6511 39.8409 85.3794 44.4228 82.7171 47.1406L47.9008 82.684C45.7466 84.8831 42.254 84.8831 40.0999 82.684L5.28351 47.1406C2.62124 44.4227 3.34957 39.8409 6.7171 38.122L17.9759 32.3751ZM44.0003 19.0912L73.0051 4.28593C77.7786 1.84936 82.8214 7.06388 80.3737 11.9054L70.0247 32.3751L44.0003 19.0912ZM44.0003 19.0912L14.9955 4.28593C10.2221 1.84936 5.17926 7.06388 7.62699 11.9054L17.9759 32.3751L44.0003 19.0912Z"
        fill={color}
      />
    </svg>
  );
}
