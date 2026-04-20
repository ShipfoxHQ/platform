import type {RemixiconComponentType} from '@remixicon/react';
import {
  RiAddLine,
  RiArrowRightSLine,
  RiBookOpenFill,
  RiCheckLine,
  RiCloseLine,
  RiFileCopyLine,
  RiGithubFill,
  RiGoogleFill,
  RiHomeSmileFill,
  RiImageAddFill,
  RiInformationFill,
  RiMicrosoftFill,
  RiMoneyDollarCircleLine,
  RiSubtractLine,
} from '@remixicon/react';
import type {ComponentProps} from 'react';
import {
  BadgeIcon,
  CheckCircleSolidIcon,
  CircleDottedLineIcon,
  ComponentFillIcon,
  ComponentLineIcon,
  EllipseMiniSolidIcon,
  InfoTooltipFillIcon,
  ResizeIcon,
  ShipfoxLogo,
  SlackLogo,
  SpinnerIcon,
  StripeLogo,
  ThunderIcon,
  XCircleSolidIcon,
} from './custom/index.js';
import {remixiconMap} from './remixicon-registry.js';

const commonRemixicons = {
  addLine: RiAddLine,
  close: RiCloseLine,
  check: RiCheckLine,
  copy: RiFileCopyLine,
  info: RiInformationFill,
  imageAdd: RiImageAddFill,
  chevronRight: RiArrowRightSLine,
  homeSmile: RiHomeSmileFill,
  money: RiMoneyDollarCircleLine,
  google: RiGoogleFill,
  microsoft: RiMicrosoftFill,
  github: RiGithubFill,
  subtractLine: RiSubtractLine,
  bookOpen: RiBookOpenFill,
} as const satisfies Record<string, RemixiconComponentType>;

const customIconsMap = {
  shipfox: ShipfoxLogo,
  slack: SlackLogo,
  stripe: StripeLogo,
  badge: BadgeIcon,
  checkCircleSolid: CheckCircleSolidIcon,
  circleDottedLine: CircleDottedLineIcon,
  componentFill: ComponentFillIcon,
  componentLine: ComponentLineIcon,
  ellipseMiniSolid: EllipseMiniSolidIcon,
  infoTooltipFill: InfoTooltipFillIcon,
  resize: ResizeIcon,
  spinner: SpinnerIcon,
  thunder: ThunderIcon,
  xCircleSolid: XCircleSolidIcon,
} as const satisfies Record<string, RemixiconComponentType>;

const iconsMap = {
  ...remixiconMap,
  ...commonRemixicons,
  ...customIconsMap,
} as Record<string, RemixiconComponentType> & typeof customIconsMap;

export type IconName = keyof typeof iconsMap;
export const iconNames = Object.keys(iconsMap) as IconName[];

type BaseIconProps = ComponentProps<RemixiconComponentType>;
type IconProps = {name: IconName; size?: number | string} & Omit<
  BaseIconProps,
  'name' | 'size' | 'width' | 'height'
>;

export function Icon({name, size, ...props}: IconProps) {
  const IconComponent = iconsMap[name];
  if (!IconComponent) return null;
  const svgProps = size && typeof size === 'number' ? {...props, width: size, height: size} : props;
  return <IconComponent {...svgProps} />;
}
