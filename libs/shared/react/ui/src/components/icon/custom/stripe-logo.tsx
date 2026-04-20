import type {RemixiconComponentType} from '@remixicon/react';
import type {ComponentProps} from 'react';

type StripeLogoProps = ComponentProps<RemixiconComponentType> & {
  color?: string;
};

export function StripeLogo({color = '#6772E5', ...props}: StripeLogoProps) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <title>Stripe Logo</title>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.3115 9.17663C12.3115 8.15771 13.1593 7.76352 14.5293 7.76352C16.7967 7.81251 19.0215 8.38821 21.0281 9.44512V3.29438C18.959 2.48126 16.7523 2.07592 14.5293 2.10068C9.24873 2.10068 5.70703 4.86665 5.70703 9.48529C5.70703 16.7115 15.63 15.5379 15.63 18.6526C15.63 19.8709 14.5888 20.2487 13.1236 20.2487C10.9631 20.2487 8.17253 19.3547 5.9837 18.1647V24.3958C8.23725 25.3764 10.6668 25.888 13.1244 25.8997C18.5514 25.8997 22.2925 23.2185 22.2925 18.5195C22.2925 10.7206 12.3115 12.1137 12.3115 9.17812V9.17663Z"
        fill={color}
      />
    </svg>
  );
}
