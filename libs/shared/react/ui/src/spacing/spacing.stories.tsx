import type {Meta, StoryObj} from '@storybook/react';

const meta = {
  title: 'Foundations/Semantic Spacing',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function SpacingPreview() {
  return (
    <div className="min-h-screen bg-background-neutral-background text-foreground-neutral-base">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-region px-frame py-frame">
        <header className="flex items-center justify-between gap-cluster border-b border-border-neutral-base pb-panel">
          <div className="flex items-center gap-inline">
            <div className="size-24 rounded-full bg-background-contrast-base" />
            <div className="flex flex-col gap-tight">
              <p className="text-sm font-semibold">Acme Cloud</p>
              <p className="text-xs text-foreground-neutral-muted">Operations workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-cluster">
            <span className="rounded-4 bg-background-subtle-base p-tight text-xs text-foreground-neutral-muted">
              Healthy
            </span>
            <button
              type="button"
              className="rounded-6 bg-background-button-inverted-default px-row py-row text-xs font-medium text-foreground-contrast-primary"
            >
              Open runbook
            </button>
          </div>
        </header>

        <main className="flex flex-col gap-region">
          <section className="flex flex-col gap-section">
            <div className="flex flex-col gap-tight">
              <p className="text-xs font-medium uppercase tracking-wider text-foreground-neutral-muted">
                Overview
              </p>
              <h1 className="text-2xl font-semibold">Production operations</h1>
            </div>

            <div className="grid grid-cols-3 gap-cluster">
              {[
                ['Active workflows', '24', '2 started today'],
                ['Runner capacity', '82%', 'Across 3 regions'],
                ['Open incidents', '03', '1 needs attention'],
              ].map(([label, value, detail]) => (
                <article
                  key={label}
                  className="flex flex-col gap-group rounded-8 border border-border-neutral-base bg-background-neutral-base p-panel-compact"
                >
                  <p className="text-xs text-foreground-neutral-muted">{label}</p>
                  <div className="flex items-end justify-between gap-inline">
                    <p className="text-xl font-semibold">{value}</p>
                    <p className="text-xs text-foreground-neutral-muted">{detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] gap-section">
            <article className="overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base">
              <div className="flex items-center justify-between gap-inline border-b border-border-neutral-base p-panel">
                <div className="flex flex-col gap-tight">
                  <h2 className="text-sm font-semibold">Recent workflow runs</h2>
                  <p className="text-xs text-foreground-neutral-muted">Last 24 hours</p>
                </div>
                <button
                  type="button"
                  className="rounded-4 border border-border-neutral-base px-row py-row text-xs font-medium"
                >
                  View all
                </button>
              </div>
              <div className="flex flex-col">
                {[
                  ['Deploy production', 'Succeeded', '2 min ago'],
                  ['Nightly verification', 'Running', '18 min ago'],
                  ['Release candidate', 'Failed', '42 min ago'],
                ].map(([name, status, time]) => (
                  <div
                    key={name}
                    className="flex items-center justify-between gap-inline border-b border-border-neutral-base px-row py-row last:border-b-0"
                  >
                    <div className="flex min-w-0 flex-col gap-tight">
                      <p className="truncate text-xs font-medium">{name}</p>
                      <p className="text-xs text-foreground-neutral-muted">{time}</p>
                    </div>
                    <span className="shrink-0 rounded-4 bg-background-subtle-base p-tight text-xs text-foreground-neutral-muted">
                      {status}
                    </span>
                  </div>
                ))}
              </div>
            </article>

            <aside className="flex flex-col gap-group rounded-8 border border-border-neutral-base bg-background-neutral-base p-panel">
              <div className="flex flex-col gap-tight">
                <h2 className="text-sm font-semibold">Deployment settings</h2>
                <p className="text-xs text-foreground-neutral-muted">
                  Keep production changes safe and observable.
                </p>
              </div>
              <div className="flex flex-col gap-inline">
                {['Require approval', 'Notify on failure', 'Retain run logs'].map((setting) => (
                  <label key={setting} className="flex items-center gap-inline text-xs">
                    <input type="checkbox" defaultChecked />
                    {setting}
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="rounded-6 bg-background-button-inverted-default px-row py-row text-xs font-medium text-foreground-contrast-primary"
              >
                Save settings
              </button>
            </aside>
          </section>
        </main>
      </div>
    </div>
  );
}

export const Comfortable: Story = {
  render: () => <SpacingPreview />,
};

export const CompactDensity: Story = {
  render: () => (
    <div data-density="compact">
      <SpacingPreview />
    </div>
  ),
};
