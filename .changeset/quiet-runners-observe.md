---
"@shipfox/api-runners": patch
---

Downgrades expected runner assignment retries to debug logging. Adds the
`runners_provider_runner_created_to_control_session`,
`runners_provider_runner_control_session_to_assignment`,
`runners_provider_runner_assignment_to_activation`,
`runners_provider_runner_activation_to_first_claim`,
`runners_provider_runner_assignment_rejected`,
`runners_provider_runner_by_phase`, and
`runners_provider_runner_by_phase_oldest_age` metrics.
