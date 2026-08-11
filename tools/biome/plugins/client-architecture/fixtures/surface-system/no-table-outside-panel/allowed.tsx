import {Card} from '@shipfox/react-ui/card';
import {Panel} from '@shipfox/react-ui/panel';
import {Table} from '@shipfox/react-ui/table';

export function AllowedTable() {
  return (
    <Panel>
      <div>
        <Table />
      </div>
    </Panel>
  );
}

export function AllowedTableInCurrentPanelImplementation() {
  return (
    <Card>
      <Table />
    </Card>
  );
}
