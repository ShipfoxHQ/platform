---
"@shipfox/api-agent-dto": minor
"@shipfox/api-agent": minor
---

Adds optional model metadata (`context_window`, `max_output_tokens`, `reasoning`, `input_image`) to managed model entries and passes it through to the pi `custom_provider` contract so managed steps carry the same model descriptor as custom providers.
