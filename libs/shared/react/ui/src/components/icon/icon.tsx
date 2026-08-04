import type {RemixiconComponentType} from '@remixicon/react';
import {
  RiAddLine,
  RiArrowRightSLine,
  RiBookOpenFill,
  RiCheckboxCircleFill,
  RiCheckLine,
  RiCloseCircleFill,
  RiCloseLine,
  RiErrorWarningFill,
  RiExternalLinkLine,
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
  GiteaLogo,
  InfoTooltipFillIcon,
  JiraLogo,
  LinearLogo,
  ResizeIcon,
  SentryLogo,
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
  checkboxCircleFill: RiCheckboxCircleFill,
  closeCircleFill: RiCloseCircleFill,
  copy: RiFileCopyLine,
  errorWarningFill: RiErrorWarningFill,
  externalLink: RiExternalLinkLine,
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
  sentry: SentryLogo,
  slack: SlackLogo,
  stripe: StripeLogo,
  gitea: GiteaLogo,
  jira: JiraLogo,
  linear: LinearLogo,
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

type BaseIconProps = ComponentProps<RemixiconComponentType> & {title?: string};
type IconProps = {name: IconName; size?: number | string} & Omit<
  BaseIconProps,
  'name' | 'size' | 'width' | 'height'
>;

export function Icon({name, size, ...props}: IconProps) {
  const IconComponent = iconsMap[name];
  if (!IconComponent) return null;
  const svgProps = size === undefined ? props : {...props, width: size, height: size};
  return <IconComponent {...svgProps} />;
}
