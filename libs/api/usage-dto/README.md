# Shipfox API Usage DTO

Usage DTOs define the durable usage records, replay commands, HTTP responses, and events shared
by the Usage bounded context and its consumers.

## What it does

- **Usage record schemas** describe job execution and inference segment quantities without prices.
- **`usageInterModuleContract`** defines segment capture and durable replay cursors.
- **Usage events** define the strict version 1 publication payloads and ordering contracts.
- **HTTP schemas** define the snake_case run and job-execution responses.

## Installation and setup

```sh
pnpm add @shipfox/api-usage-dto
```

## Usage

```ts
import {usageJobExecutionRecordedEventSchema} from '@shipfox/api-usage-dto';

const event = usageJobExecutionRecordedEventSchema.parse(payload);
console.log(event.jobExecutionId);
```

Import `usageInterModuleContract` from `@shipfox/api-usage-dto/inter-module` when composing a
Usage client or presentation.

## Development

```sh
turbo check --filter=@shipfox/api-usage-dto
turbo type --filter=@shipfox/api-usage-dto
turbo test --filter=@shipfox/api-usage-dto
```

## License

MIT
