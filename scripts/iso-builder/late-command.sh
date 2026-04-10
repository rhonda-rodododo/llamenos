#!/bin/sh
# late-command.sh — runs in the installer chroot before reboot.
# Args: $1=UNLOCK_MODE  $2=SSH_PUBKEY_B64  $3=STATIC_IP  $4=GATEWAY  $5=DNS
#
# This script:
#   1. Stages the operator's SSH key for the deploy user
#   2. Drops a hardened sshd_config baseline (full hardening happens in Ansible)
#   3. Runs dropbear-setup.sh if --unlock=dropbear was selected
#   4. Writes a /etc/motd with next-step instructions
set -eu

UNLOCK_MODE="$1"
SSH_PUBKEY="$(echo "$2" | base64 -d)"
STATIC_IP="$3"
GATEWAY="$4"
DNS="$5"

# 1. Stage operator's SSH key for the deploy user
USER_HOME="/home/deploy"
mkdir -p "${USER_HOME}/.ssh"
echo "${SSH_PUBKEY}" > "${USER_HOME}/.ssh/authorized_keys"
chmod 700 "${USER_HOME}/.ssh"
chmod 600 "${USER_HOME}/.ssh/authorized_keys"
chown -R deploy:deploy "${USER_HOME}/.ssh"

# 2. Hardened sshd baseline (full hardening happens in Ansible)
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-llamenos-baseline.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
KbdInteractiveAuthentication no
UsePAM yes
PermitEmptyPasswords no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF

# 3. Set up dropbear-initramfs if requested
if [ "${UNLOCK_MODE}" = "dropbear" ]; then
  /tmp/dropbear-setup.sh "${SSH_PUBKEY}" "${STATIC_IP}" "${GATEWAY}" "${DNS}"
fi

# 4. Ensure NTP is on (chrony will replace this in Ansible)
systemctl enable systemd-timesyncd || true

# 5. First-boot welcome banner with next steps
cat > /etc/motd <<EOF

  Llamenos Hotline — fresh install (Debian 13)
  ──────────────────────────────────────────────
  Disk encryption:  LUKS2 + LVM (active)
  Unlock mode:      ${UNLOCK_MODE}
  SSH user:         deploy (sudo, key-only)

  NEXT STEP — from your workstation:

    cd <llamenos-checkout>/deploy/ansible
    just bootstrap   # if not already done
    ansible-playbook setup.yml -i 'this-host,'

EOF

exit 0
