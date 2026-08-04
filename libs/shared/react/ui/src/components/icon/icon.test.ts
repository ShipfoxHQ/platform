import type {RemixiconComponentType} from '@remixicon/react';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
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
import {Icon, type IconName} from './icon.js';

const customIcons = [
  {name: 'badge', Component: BadgeIcon},
  {name: 'checkCircleSolid', Component: CheckCircleSolidIcon},
  {name: 'circleDottedLine', Component: CircleDottedLineIcon},
  {name: 'componentFill', Component: ComponentFillIcon},
  {name: 'componentLine', Component: ComponentLineIcon},
  {name: 'ellipseMiniSolid', Component: EllipseMiniSolidIcon},
  {name: 'gitea', Component: GiteaLogo},
  {name: 'infoTooltipFill', Component: InfoTooltipFillIcon},
  {name: 'jira', Component: JiraLogo},
  {name: 'linear', Component: LinearLogo},
  {name: 'resize', Component: ResizeIcon},
  {name: 'sentry', Component: SentryLogo},
  {name: 'shipfox', Component: ShipfoxLogo},
  {name: 'slack', Component: SlackLogo},
  {name: 'spinner', Component: SpinnerIcon},
  {name: 'stripe', Component: StripeLogo},
  {name: 'thunder', Component: ThunderIcon},
  {name: 'xCircleSolid', Component: XCircleSolidIcon},
] as const satisfies readonly {name: IconName; Component: RemixiconComponentType}[];

describe('custom icons', () => {
  it.each(customIcons)('forwards base icon props for $name', ({name}) => {
    const markup = renderToStaticMarkup(
      createElement(Icon, {
        name,
        size: 16,
        className: 'custom-icon',
        'aria-label': 'Custom icon',
      }),
    );

    expect(markup).toContain('width="16"');
    expect(markup).toContain('height="16"');
    expect(markup).toContain('class="custom-icon"');
    expect(markup).toContain('aria-label="Custom icon"');
    expect(markup).not.toContain('aria-hidden');
    expect(markup).not.toContain('<title>');
  });

  it.each(customIcons)('maps direct size props for $name', ({Component}) => {
    const markup = renderToStaticMarkup(
      createElement(Component, {
        size: 32,
        'aria-hidden': true,
      }),
    );

    expect(markup).toContain('width="32"');
    expect(markup).toContain('height="32"');
    expect(markup).not.toContain('size="32"');
  });

  it.each(customIcons)('defaults unlabeled custom icons to decorative for $name', ({Component}) => {
    const markup = renderToStaticMarkup(createElement(Component, {size: 24}));

    expect(markup).toContain('aria-hidden="true"');
  });

  it('leaves title text controlled by the caller', () => {
    const markup = renderToStaticMarkup(
      createElement(Icon, {
        name: 'infoTooltipFill',
        title: 'Caller tooltip',
        'aria-label': 'Caller label',
      }),
    );

    expect(markup).toContain('title="Caller tooltip"');
    expect(markup).toContain('aria-label="Caller label"');
    expect(markup).not.toContain('<title>');
  });

  it('renders the Slack glyph with the caller color', () => {
    const markup = renderToStaticMarkup(createElement(SlackLogo, {size: 24}));

    expect(markup).toContain('fill="currentColor"');
    expect(markup).not.toContain('#E01E5A');
    expect(markup).not.toContain('#36C5F0');
    expect(markup).not.toContain('#2EB67D');
    expect(markup).not.toContain('#ECB22E');
  });
});
