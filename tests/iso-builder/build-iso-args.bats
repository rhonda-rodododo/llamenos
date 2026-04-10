#!/usr/bin/env bats
# Tests for scripts/build-iso.sh argument validation.
# These tests intercept the docker invocation by setting BUILD_ISO_DRY_RUN=1,
# which makes the script print the resolved flags to stdout and exit 0
# before any docker call.

setup() {
  SCRIPT="${BATS_TEST_DIRNAME}/../../scripts/build-iso.sh"
  TMPKEY="$(mktemp -d)/test_ed25519.pub"
  ssh-keygen -t ed25519 -N '' -f "${TMPKEY%.*}" -C "test" >/dev/null 2>&1
  export BUILD_ISO_DRY_RUN=1
}

teardown() {
  rm -rf "$(dirname "$TMPKEY")"
}

@test "missing --hostname fails" {
  run "$SCRIPT" --ssh-key "$TMPKEY"
  [ "$status" -ne 0 ]
  [[ "$output" == *"--hostname is required"* ]]
}

@test "missing --ssh-key fails" {
  run "$SCRIPT" --hostname host01
  [ "$status" -ne 0 ]
  [[ "$output" == *"--ssh-key is required"* ]]
}

@test "invalid hostname format is rejected" {
  run "$SCRIPT" --hostname "Invalid_Host" --ssh-key "$TMPKEY"
  [ "$status" -ne 0 ]
  [[ "$output" == *"invalid hostname"* ]]
}

@test "valid hostname is accepted" {
  run "$SCRIPT" --hostname "host-01" --ssh-key "$TMPKEY"
  [ "$status" -eq 0 ]
  [[ "$output" == *"hostname=host-01"* ]]
}

@test "missing ssh-key file is rejected" {
  run "$SCRIPT" --hostname host01 --ssh-key /nonexistent/key.pub
  [ "$status" -ne 0 ]
  [[ "$output" == *"ssh key not found"* ]]
}

@test "RSA ssh key is rejected (ed25519/ECDSA only)" {
  rsakey="$(mktemp -d)/rsa.pub"
  ssh-keygen -t rsa -b 4096 -N '' -f "${rsakey%.*}" -C "test" >/dev/null 2>&1
  run "$SCRIPT" --hostname host01 --ssh-key "$rsakey"
  [ "$status" -ne 0 ]
  [[ "$output" == *"unsupported ssh key type"* ]]
  rm -rf "$(dirname "$rsakey")"
}

@test "ed25519 ssh key is accepted" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY"
  [ "$status" -eq 0 ]
}

@test "default unlock mode is dropbear" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY"
  [ "$status" -eq 0 ]
  [[ "$output" == *"unlock=dropbear"* ]]
}

@test "--unlock console is accepted" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --unlock console
  [ "$status" -eq 0 ]
  [[ "$output" == *"unlock=console"* ]]
}

@test "--unlock invalid is rejected" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --unlock magic
  [ "$status" -ne 0 ]
  [[ "$output" == *"--unlock must be"* ]]
}

@test "--static-ip without --gateway is rejected" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --static-ip 192.0.2.10/24
  [ "$status" -ne 0 ]
  [[ "$output" == *"--gateway is required"* ]]
}

@test "--static-ip with --gateway is accepted" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" \
    --static-ip 192.0.2.10/24 --gateway 192.0.2.1
  [ "$status" -eq 0 ]
  [[ "$output" == *"static_ip=192.0.2.10/24"* ]]
  [[ "$output" == *"gateway=192.0.2.1"* ]]
}

@test "default disk is /dev/sda" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY"
  [ "$status" -eq 0 ]
  [[ "$output" == *"disk=/dev/sda"* ]]
}

@test "--disk /dev/vda is accepted" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --disk /dev/vda
  [ "$status" -eq 0 ]
  [[ "$output" == *"disk=/dev/vda"* ]]
}

@test "--disk with arbitrary path is rejected" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --disk /etc/passwd
  [ "$status" -ne 0 ]
  [[ "$output" == *"invalid --disk"* ]]
}

@test "--debian-version 13.4.0 is accepted" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --debian-version 13.4.0
  [ "$status" -eq 0 ]
  [[ "$output" == *"debian_version=13.4.0"* ]]
}

@test "--debian-version 12.x is rejected (not Debian 13)" {
  run "$SCRIPT" --hostname host01 --ssh-key "$TMPKEY" --debian-version 12.5.0
  [ "$status" -ne 0 ]
  [[ "$output" == *"only Debian 13"* ]]
}

@test "--help prints usage and exits 0" {
  run "$SCRIPT" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage: scripts/build-iso.sh"* ]]
  [[ "$output" == *"--hostname"* ]]
  [[ "$output" == *"--ssh-key"* ]]
  [[ "$output" == *"--unlock"* ]]
}
