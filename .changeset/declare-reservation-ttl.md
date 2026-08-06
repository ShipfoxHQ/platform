---
'@shipfox/provisioner-core': minor
---

Let provisioner adapters request provider-specific reservation TTLs during demand polling. `startProvisioner` rejects an adapter whose `reservationTtlSeconds` is not a positive integer.
