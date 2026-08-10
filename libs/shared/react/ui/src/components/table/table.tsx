import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';

function Table({className, ...props}: ComponentProps<'table'>) {
  return (
    <div className="relative w-full overflow-auto rounded-8 scrollbar">
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({className, ...props}: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn(className)} {...props} />;
}

function TableBody({className, ...props}: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn(className)} {...props} />;
}

function TableFooter({className, ...props}: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'border-t border-border-neutral-base bg-background-neutral-base font-medium',
        className,
      )}
      {...props}
    />
  );
}

function TableRow({className, ...props}: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'group/row border-b border-border-neutral-base transition-colors last:border-b-0',
        'hover:bg-background-neutral-hover',
        'data-[selected=true]:bg-background-neutral-pressed data-[selected=true]:hover:bg-background-neutral-pressed',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({className, ...props}: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-40 border-b border-border-neutral-base bg-background-neutral-base px-12 text-left align-middle text-xs font-medium leading-20 text-foreground-neutral-subtle',
        '[&:has([role=checkbox])]:w-0 [&:has([role=checkbox])]:px-12 [&:has([role=checkbox])]:pr-0 [&:has([role=checkbox])]:pt-6',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({className, ...props}: ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'truncate bg-background-neutral-base px-12 py-10 align-middle text-sm leading-20 text-foreground-neutral-base',
        'group-hover/row:bg-background-neutral-hover',
        'group-data-[selected=true]/row:bg-background-neutral-pressed!',
        '[&:has([role=checkbox])]:pr-0 [&:has([role=checkbox])]:pt-14',
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({className, ...props}: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-16 text-sm text-foreground-neutral-muted', className)}
      {...props}
    />
  );
}

export {Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow};
