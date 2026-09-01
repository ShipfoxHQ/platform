build {
  name    = "runner"
  sources = ["amazon-ebs.build_image", "qemu.build_image"]

  provisioner "file" {
    destination = "/tmp/shipfox-runner-workspace"
    source      = var.runner_workspace
  }

  provisioner "file" {
    destination = "/tmp/shipfox-runner-image-scripts"
    source      = abspath("${path.root}/scripts")
  }

  provisioner "shell" {
    environment_vars = ["NODE_VERSION=${var.node_version}"]
    execute_command  = "sudo -E sh -c '{{ .Vars }} {{ .Path }}'"
    scripts = [
      "${path.root}/scripts/build/setup-runner.sh",
      "${path.root}/scripts/build/install-node.sh",
      "${path.root}/scripts/build/install-runner.sh",
      "${path.root}/scripts/build/configure-boot.sh",
      "${path.root}/scripts/build/configure-ephemeral-boot.sh"
    ]
  }

  # Verify the shared base capabilities before provider-specific runtime units are installed.
  provisioner "file" {
    destination = "/tmp/shipfox-runner-image-composition"
    source      = abspath("${path.root}/composition/${var.image_os}/${var.architecture}")
  }

  provisioner "shell" {
    environment_vars = [
      "SHIPFOX_RUNNER_COMPOSITION_DIR=/tmp/shipfox-runner-image-composition",
      "SHIPFOX_RUNNER_IMAGE_ARCHITECTURE=${var.architecture}",
      "SHIPFOX_RUNNER_IMAGE_OS=${var.image_os}",
    ]
    execute_command = "sudo -E sh -c '{{ .Vars }} {{ .Path }}'"
    scripts         = ["${path.root}/scripts/build/verify-composition.sh"]
  }

  provisioner "file" {
    destination = "/tmp/shipfox-runner-assets"
    source      = abspath("${path.root}/assets")
  }

  # Nothing owns netplan once the bake removes cloud-init, so the image configures
  # systemd-networkd directly. Leaving netplan configuration in place would re-introduce a
  # generated unit that shadows this one by sort order.
  provisioner "shell" {
    inline = [
      "sudo rm -f /etc/netplan/*.yaml",
      "sudo install -d -m 0755 /etc/systemd/network",
      "sudo install -m 0644 /tmp/shipfox-runner-assets/shipfox-primary.network /etc/systemd/network/10-shipfox-primary.network",
      "sudo install -d -m 0755 /etc/systemd/system/systemd-networkd-wait-online.service.d",
      "sudo install -m 0644 /tmp/shipfox-runner-assets/shipfox-networkd-wait-online.conf /etc/systemd/system/systemd-networkd-wait-online.service.d/10-shipfox.conf",
      "sudo test -x /usr/lib/systemd/systemd-networkd-wait-online",
      "sudo systemctl enable systemd-networkd.service systemd-resolved.service",
      "test \"$(systemctl is-enabled systemd-networkd.service)\" = enabled",
      "test \"$(systemctl is-enabled systemd-resolved.service)\" = enabled"
    ]
  }

  provisioner "shell" {
    execute_command = "sudo -E sh -c '{{ .Vars }} {{ .Path }}'"
    scripts         = ["${path.root}/scripts/build/verify-network.sh"]
  }

  # The runner environment arrives over IMDSv2 and the instance powers itself off when that
  # fetch fails, so the reconfigured link has to reach the metadata service before the snapshot.
  provisioner "shell" {
    inline = [
      "curl --fail --silent --show-error --noproxy '*' --connect-timeout 2 --max-time 5 --request PUT --header 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token > /dev/null"
    ]
    only = ["amazon-ebs.build_image"]
  }

  provisioner "shell" {
    environment_vars = ["SHIPFOX_IMAGE_REVISION=${var.revision}"]
    execute_command  = "sudo sh -c '{{ .Vars }} {{ .Path }}'"
    inline = [
      "sudo install -d -m 0755 /etc/shipfox /opt/shipfox-runner/scripts/runtime/helpers",
      "printf '%s\\n' \"$SHIPFOX_IMAGE_REVISION\" > /etc/shipfox/image-revision",
      "chmod 0444 /etc/shipfox/image-revision",
      "sudo install -m 0644 /tmp/shipfox-runner-assets/shipfox-runner.target /etc/systemd/system/shipfox-runner.target",
      "sudo install -m 0644 /tmp/shipfox-runner-assets/shipfox-runner-env.path /etc/systemd/system/shipfox-runner-env.path",
      "sudo install -m 0644 /tmp/shipfox-runner-assets/shipfox-runner.service /etc/systemd/system/shipfox-runner.service",
      "sudo install -m 0644 /tmp/shipfox-runner-assets/shipfox-runner-env.service /etc/systemd/system/shipfox-runner-env.service",
      "sudo install -m 0644 /tmp/shipfox-runner-assets/shipfox-runner-boot-complete.service /etc/systemd/system/shipfox-runner-boot-complete.service",
      "sudo install -m 0644 /tmp/shipfox-runner-assets/shipfox-bootstrap.service /etc/systemd/system/shipfox-bootstrap.service",
      "sudo install -m 0755 /tmp/shipfox-runner-image-scripts/runtime/record-boot-io.sh /opt/shipfox-runner/scripts/runtime/record-boot-io.sh",
      "sudo install -m 0755 /tmp/shipfox-runner-image-scripts/runtime/shipfox-bootstrap.sh /opt/shipfox-runner/scripts/runtime/shipfox-bootstrap.sh",
      "sudo install -m 0755 /tmp/shipfox-runner-image-scripts/runtime/run-runner.sh /opt/shipfox-runner/scripts/runtime/run-runner.sh",
      "sudo install -m 0755 /tmp/shipfox-runner-image-scripts/runtime/verify-workspace-mount.sh /opt/shipfox-runner/scripts/runtime/verify-workspace-mount.sh",
      "sudo install -m 0755 /tmp/shipfox-runner-image-scripts/runtime/helpers/logger.sh /opt/shipfox-runner/scripts/runtime/helpers/logger.sh",
      "sudo install -m 0644 /tmp/shipfox-runner-image-scripts/runtime/helpers/resolve-root-partition.sh /opt/shipfox-runner/scripts/runtime/helpers/resolve-root-partition.sh",
      "sudo systemctl daemon-reload",
      "sudo systemctl enable shipfox-runner-env.path"
    ]
  }

  # Exercise the installed bootstrap against the live Packer root after all runtime files exist.
  provisioner "shell" {
    inline = [
      "sudo /opt/shipfox-runner/scripts/runtime/shipfox-bootstrap.sh --verify-root-partition"
    ]
  }

  provisioner "file" {
    destination = "/tmp/shipfox-spot-watchdog.service"
    source      = abspath("${path.root}/assets/shipfox-spot-watchdog.service")
    only        = ["amazon-ebs.build_image"]
  }

  provisioner "file" {
    destination = "/tmp/spot-watchdog.sh"
    source      = abspath("${path.root}/scripts/runtime/spot-watchdog.sh")
    only        = ["amazon-ebs.build_image"]
  }

  provisioner "shell" {
    inline = [
      "sudo install -m 0644 /tmp/shipfox-spot-watchdog.service /etc/systemd/system/shipfox-spot-watchdog.service",
      "sudo install -m 0755 /tmp/spot-watchdog.sh /opt/shipfox-runner/scripts/runtime/spot-watchdog.sh",
      "sudo systemctl daemon-reload",
      "sudo systemctl enable shipfox-bootstrap.service",
      "sudo systemctl enable shipfox-spot-watchdog.service"
    ]
    only = ["amazon-ebs.build_image"]
  }

  provisioner "shell" {
    inline = [
      "sudo systemd-analyze verify multi-user.target"
    ]
    only = ["amazon-ebs.build_image"]
  }

  # Harden the build user only after every provisioner that needs Packer's SSH access has run.
  provisioner "shell" {
    inline = [
      "sudo passwd --lock ubuntu",
      "sudo rm -f /home/ubuntu/.ssh/authorized_keys",
      "sudo test ! -e /home/ubuntu/.ssh/authorized_keys",
      "sudo rm -f /etc/hostname",
      "sudo test ! -e /etc/hostname",
      "sudo rm -f /etc/ssh/ssh_host_*",
      "sudo test -z \"$(find /etc/ssh -maxdepth 1 -type f -name 'ssh_host_*' -print -quit)\""
    ]
  }

  post-processor "manifest" {
    output     = "packer-manifest.json"
    strip_path = true
    custom_data = {
      architecture   = var.architecture
      build_attempt  = var.build_attempt
      build_number   = var.build_number
      candidate_id   = var.candidate_id
      encrypted      = "true"
      image_os       = var.image_os
      lifecycle      = var.image_lifecycle
      revision       = var.revision
      runner_version = var.runner_version
    }
  }
}
