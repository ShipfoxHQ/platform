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
      "${path.root}/scripts/build/install-runner.sh"
    ]
  }

  provisioner "file" {
    destination = "/tmp/shipfox-runner-assets"
    source      = abspath("${path.root}/assets")
  }

  provisioner "shell" {
    inline = [
      "sudo install -d -m 0755 /etc/shipfox /opt/shipfox-runner/scripts/runtime/helpers",
      "sudo install -m 0644 /tmp/shipfox-runner-assets/shipfox-runner.target /etc/systemd/system/shipfox-runner.target",
      "sudo install -m 0644 /tmp/shipfox-runner-assets/shipfox-runner-env.path /etc/systemd/system/shipfox-runner-env.path",
      "sudo install -m 0644 /tmp/shipfox-runner-assets/shipfox-runner.service /etc/systemd/system/shipfox-runner.service",
      "sudo install -m 0644 /tmp/shipfox-runner-assets/shipfox-runner-env.service /etc/systemd/system/shipfox-runner-env.service",
      "sudo install -m 0644 /tmp/shipfox-runner-assets/shipfox-max-lifetime.service /etc/systemd/system/shipfox-max-lifetime.service",
      "sudo install -m 0755 /tmp/shipfox-runner-image-scripts/runtime/start-max-lifetime.sh /opt/shipfox-runner/scripts/runtime/start-max-lifetime.sh",
      "sudo install -m 0755 /tmp/shipfox-runner-image-scripts/runtime/helpers/logger.sh /opt/shipfox-runner/scripts/runtime/helpers/logger.sh",
      "sudo systemctl daemon-reload",
      "sudo systemctl enable shipfox-runner-env.path"
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
      "sudo systemctl enable shipfox-spot-watchdog.service"
    ]
    only = ["amazon-ebs.build_image"]
  }

  # Harden the build user only after every provisioner that needs Packer's SSH access has run.
  provisioner "shell" {
    inline = [
      "sudo passwd --lock ubuntu",
      "sudo rm -f /home/ubuntu/.ssh/authorized_keys",
      "sudo test ! -e /home/ubuntu/.ssh/authorized_keys"
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
