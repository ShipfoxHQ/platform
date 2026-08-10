import {render} from '@testing-library/react';
import {Panel} from '../panel/panel.js';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from './table.js';

describe('Table', () => {
  test('inherits its panel surface and leaves the container chrome to Panel', () => {
    const {container} = render(
      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workflow</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow data-selected="true">
              <TableCell>Deploy production</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Panel>,
    );

    const panel = container.querySelector('[data-slot="panel"]');
    const table = container.querySelector('[data-slot="table"]');
    const tableContainer = table?.parentElement;
    const header = container.querySelector('[data-slot="table-head"]');
    const cell = container.querySelector('[data-slot="table-cell"]');
    const row = container.querySelector('[data-slot="table-row"][data-selected="true"]');

    expect(panel?.classList.contains('rounded-8')).toBe(true);
    expect(panel?.classList.contains('border-border-neutral-base')).toBe(true);
    expect(tableContainer?.classList.contains('rounded-8')).toBe(false);
    expect(tableContainer?.classList.contains('border')).toBe(false);
    expect(header?.classList.contains('bg-background-subtle-base')).toBe(true);
    expect(cell?.classList.contains('bg-background-neutral-base')).toBe(false);
    expect(row?.classList.contains('hover:bg-background-neutral-hover')).toBe(true);
    expect(row?.classList.contains('data-[selected=true]:bg-background-neutral-pressed')).toBe(
      true,
    );
  });
});
