declare function cn(...values: unknown[]): string;

export function AllowedSpacing() {
  const templateClassName = `p-4`;

  return (
    <>
      <div className="gap-tight gap-inline gap-cluster gap-group gap-section gap-region" />
      <div className="p-tight px-row py-row p-panel-compact p-panel px-frame py-frame" />
      <div className="p-0 gap-0 mt-0 first:pt-0 last:pb-0 p-[15%] pl-[2ch]" />
      <div className="p-0" />
      <div className={`p-4`} />
      <div className={templateClassName} />
      <div className={cn('p-4')} />
      <div data-className="p-4" />
    </>
  );
}
