#!/usr/bin/env bats
# Tests for cidr_to_netmask() in scripts/iso-builder/dropbear-setup.sh.
#
# dropbear-setup.sh checks TEST_MODE=1 before running its installer body,
# allowing us to source just the function definitions.

setup() {
  SCRIPT="${BATS_TEST_DIRNAME}/../../scripts/iso-builder/dropbear-setup.sh"
  # Source the script in TEST_MODE to load cidr_to_netmask without running
  # the installer body (which requires apt-get, /etc paths, etc.).
  export TEST_MODE=1
  # shellcheck disable=SC1090
  . "$SCRIPT"
}

@test "cidr /0 -> 0.0.0.0" {
  result="$(cidr_to_netmask 0)"
  [ "$result" = "0.0.0.0" ]
}

@test "cidr /1 -> 128.0.0.0" {
  result="$(cidr_to_netmask 1)"
  [ "$result" = "128.0.0.0" ]
}

@test "cidr /7 -> 254.0.0.0" {
  result="$(cidr_to_netmask 7)"
  [ "$result" = "254.0.0.0" ]
}

@test "cidr /8 -> 255.0.0.0" {
  result="$(cidr_to_netmask 8)"
  [ "$result" = "255.0.0.0" ]
}

@test "cidr /15 -> 255.254.0.0" {
  result="$(cidr_to_netmask 15)"
  [ "$result" = "255.254.0.0" ]
}

@test "cidr /16 -> 255.255.0.0" {
  result="$(cidr_to_netmask 16)"
  [ "$result" = "255.255.0.0" ]
}

@test "cidr /23 -> 255.255.254.0" {
  result="$(cidr_to_netmask 23)"
  [ "$result" = "255.255.254.0" ]
}

@test "cidr /24 -> 255.255.255.0" {
  result="$(cidr_to_netmask 24)"
  [ "$result" = "255.255.255.0" ]
}

@test "cidr /25 -> 255.255.255.128" {
  result="$(cidr_to_netmask 25)"
  [ "$result" = "255.255.255.128" ]
}

@test "cidr /31 -> 255.255.255.254" {
  result="$(cidr_to_netmask 31)"
  [ "$result" = "255.255.255.254" ]
}

@test "cidr /32 -> 255.255.255.255" {
  result="$(cidr_to_netmask 32)"
  [ "$result" = "255.255.255.255" ]
}
