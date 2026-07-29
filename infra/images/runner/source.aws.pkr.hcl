source "amazon-ebs" "build_image" {
  ami_name                    = local.image_name
  ami_virtualization_type     = "hvm"
  associate_public_ip_address = true
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

  launch_block_device_mappings {
    delete_on_termination = true
    device_name           = "/dev/sda1"
    encrypted             = true
    kms_key_id            = var.image_lifecycle == "candidate" ? var.candidate_kms_key_id : ""
    volume_size           = var.os_disk_size_gb
    volume_type           = "gp3"
  }

  tags = local.image_tags

  # Packer shares the AMI (ModifyImageAttribute) before it applies `tags`, so a
  # tag-scoped sharing policy only matches when the tags exist at registration.
  # `run_tags` are attached through CreateImage's tag specifications.
  run_tags = local.image_tags
}
