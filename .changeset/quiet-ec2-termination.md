---
"@shipfox/provisioner-ec2-provider": patch
---

Reports each EC2 runner termination once instead of on every observation, using AWS instance IDs and a one-hour listing-gap grace period.
