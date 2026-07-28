variable "build_number" {
  type = string
}

variable "build_attempt" {
  type    = string
  default = "1"
}

variable "candidate_expires_at" {
  type    = string
  default = ""
}

variable "candidate_id" {
  type    = string
  default = ""
}

variable "candidate_kms_key_id" {
  type    = string
  default = ""
}

variable "candidate_ami_users" {
  type    = list(string)
  default = []
}

variable "architecture" {
  type    = string
  default = "amd64"
  validation {
    condition     = contains(["amd64", "arm64"], var.architecture)
    error_message = "Architecture must be amd64 or arm64."
  }
}

variable "image_os" {
  type    = string
  default = "ubuntu24"
}

variable "image_lifecycle" {
  type    = string
  default = "release"
  validation {
    condition     = contains(["candidate", "release"], var.image_lifecycle)
    error_message = "Image lifecycle must be candidate or release."
  }
}

variable "node_version" {
  type = string
}

variable "revision" {
  type    = string
  default = "local"
}

variable "runner_version" {
  type    = string
  default = ""
}

variable "os_disk_size_gb" {
  type    = number
  default = 100
}

variable "platform" {
  type = string
  validation {
    condition     = contains(["aws", "qemu"], var.platform)
    error_message = "Platform must be aws or qemu."
  }
}

variable "runner_workspace" {
  type = string
}
