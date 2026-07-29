locals {
  aws_architecture    = var.architecture == "amd64" ? "x86_64" : "arm64"
  ubuntu_architecture = var.architecture

  image_name = var.image_lifecycle == "candidate" ? "shipfox-runner-candidate-${var.candidate_id}-${var.architecture}" : "shipfox-runner-${var.image_os}-${var.architecture}-${var.build_number}-${var.build_attempt}"

  image_tags = merge({
    Name                    = local.image_name
    "shipfox.build_attempt" = var.build_attempt
    "shipfox.build_number"  = var.build_number
    "shipfox.image_os"      = var.image_os
    "shipfox.architecture"  = var.architecture
    "shipfox.runner"        = "@shipfox/runner"
    "shipfox.revision"      = var.revision
    "shipfox.lifecycle"     = var.image_lifecycle
    "shipfox.managed"       = "true"
    },
    var.image_lifecycle == "candidate" ? {
      "shipfox.candidate_id" = var.candidate_id
      "shipfox.expires_at"   = var.candidate_expires_at
    } : {},
    var.runner_version != "" ? { "shipfox.runner_version" = var.runner_version } : {},
  )
}
