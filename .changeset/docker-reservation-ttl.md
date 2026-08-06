---
'@shipfox/provisioner-docker-provider': patch
---

Request a reservation TTL derived from `SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS` on every demand poll, so reservations live exactly as long as a created container may take to register.
