source "amazon-ebs" "build_image" {
  ami_name                    = var.image_lifecycle == "candidate" ? "shipfox-runner-candidate-${var.candidate_id}-${var.architecture}" : "shipfox-runner-${var.image_os}-${var.architecture}-${var.build_number}-${var.build_attempt}"
  ami_virtualization_type     = "hvm"
  associate_public_ip_address = true
  encrypt_boot                = true
  kms_key_id                  = var.image_lifecycle == "candidate" ? var.candidate_kms_key_id : ""
  ami_users                   = var.image_lifecycle == "candidate" ? var.candidate_ami_users : []
  imds_support                = "v2.0"
  instance_type               = var.architecture == "amd64" ? "t3.large" : "t4g.large"
  region                      = "eu-central-1"
  shutdown_behavior           = "terminate"
  ssh_username                = "ubuntu"

  source_ami_filter {
    filters = {
      architecture        = local.aws_architecture
      name                = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-${local.ubuntu_architecture}-server-*"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
    most_recent = true
    owners      = ["099720109477"]
  }

  tags = merge({
    Name                    = var.image_lifecycle == "candidate" ? "shipfox-runner-candidate-${var.candidate_id}-${var.architecture}" : "shipfox-runner-${var.image_os}-${var.architecture}-${var.build_number}-${var.build_attempt}"
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
