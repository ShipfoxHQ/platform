import type {UsagePricingCost} from '@shipfox/client-shell/runtime';
import {useUsagePricing} from '@shipfox/client-shell/runtime';
import {Badge} from '@shipfox/react-ui/badge';
import {formatUsageCost} from './usage-cost.js';

export function UsageCostBadge({cost}: {cost: UsagePricingCost | undefined}) {
  const pricing = useUsagePricing();
  const formatted = formatUsageCost(pricing, cost);
  if (!formatted) return null;

  return (
    <Badge
      data-usage-cost-state={cost?.state}
      variant={cost?.state === 'estimated' ? 'warning' : 'success'}
      size="2xs"
      title={cost?.state === 'estimated' ? 'Estimated cost' : 'Resolved cost'}
    >
      {cost?.state === 'estimated' ? 'est. ' : ''}
      {formatted}
    </Badge>
  );
}
