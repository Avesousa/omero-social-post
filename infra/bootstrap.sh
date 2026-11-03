#!/usr/bin/env bash
#
# Bootstraps a fresh Ubuntu 24.04 VPS for omero-social-post. Run as root:
#
#   curl -fsSLo bootstrap.sh https://raw.githubusercontent.com/Avesousa/omero-social-post/main/infra/bootstrap.sh
#   sudo NEW_USER=omero SSH_PUBKEY="ssh-ed25519 AAAA... you@laptop" TS_AUTHKEY=tskey-auth-... bash bootstrap.sh
#
# or with flags:
#
#   sudo bash bootstrap.sh --user omero --ssh-key "ssh-ed25519 AAAA..." --ts-authkey tskey-auth-... --ts-hostname omero
#
# What it does (each step checks the current state first, so a second run changes nothing):
#   1. base packages (curl, ca-certificates, gnupg, ufw, unattended-upgrades)
#   2. a sudo user with your SSH public key (or root's authorized_keys when no key is given)
#   3. sshd hardening drop-in: no root login, no passwords (refused if the user has no key)
#   4. ufw: deny incoming, allow outgoing, allow SSH only; no app ports
#   5. unattended security upgrades
#   6. Docker Engine + compose plugin from Docker's apt repo; user added to the docker group
#   7. Tailscale from its apt repo; `tailscale up --ssh` when an auth key is given
#   8. /opt/omero owned by the user
#
# Environment variables / flags:
#   NEW_USER    --user         Admin user to create (default: omero)
#   SSH_PUBKEY  --ssh-key      Public key line for that user (default: copy root's authorized_keys)
#   TS_AUTHKEY  --ts-authkey   Tailscale auth key (optional; without it, instructions are printed)
#   TS_HOSTNAME --ts-hostname  Tailscale machine name (optional; becomes <name>.<tailnet>.ts.net)

set -euo pipefail

NEW_USER="${NEW_USER:-omero}"
SSH_PUBKEY="${SSH_PUBKEY:-}"
TS_AUTHKEY="${TS_AUTHKEY:-}"
TS_HOSTNAME="${TS_HOSTNAME:-}"

readonly APP_DIR=/opt/omero
readonly SSHD_DROPIN=/etc/ssh/sshd_config.d/00-omero-hardening.conf
readonly AUTO_UPGRADES=/etc/apt/apt.conf.d/20auto-upgrades

CHANGES=0
APT_UPDATED=0
SSH_HARDENED=0
TS_CONNECTED=0

# --- output helpers ----------------------------------------------------------

step() { printf '\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
ok() { printf '    \033[32mok\033[0m       %s\n' "$*"; }
changed() {
  CHANGES=$((CHANGES + 1))
  printf '    \033[33mchanged\033[0m  %s\n' "$*"
}
warn() { printf '    \033[1;31mWARNING\033[0m  %s\n' "$*" >&2; }
die() {
  printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2
  exit 1
}

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
  exit 0
}

# --- arguments ---------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) NEW_USER="${2:?--user needs a value}"; shift 2 ;;
    --ssh-key) SSH_PUBKEY="${2:?--ssh-key needs a value}"; shift 2 ;;
    --ts-authkey) TS_AUTHKEY="${2:?--ts-authkey needs a value}"; shift 2 ;;
    --ts-hostname) TS_HOSTNAME="${2:?--ts-hostname needs a value}"; shift 2 ;;
    -h | --help) usage ;;
    *) die "Unknown argument: $1 (see --help)" ;;
  esac
done

# --- preconditions -----------------------------------------------------------

[[ ${EUID} -eq 0 ]] || die "Run as root (sudo bash $0 ...)."
[[ -r /etc/os-release ]] || die "Cannot read /etc/os-release."
# shellcheck source=/dev/null
. /etc/os-release
[[ ${ID:-} == ubuntu ]] || die "This script supports Ubuntu only (found ${ID:-unknown})."
CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
[[ -n ${CODENAME} ]] || die "Cannot determine the Ubuntu codename."
if [[ ${VERSION_ID:-} != "24.04" ]]; then
  warn "Tested on Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}. Continuing."
fi
[[ ${NEW_USER} =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "Invalid user name: ${NEW_USER}"
[[ ${NEW_USER} != root ]] || die "NEW_USER must not be root."

export DEBIAN_FRONTEND=noninteractive
USER_HOME="/home/${NEW_USER}"

# --- apt helpers -------------------------------------------------------------

apt_update_once() {
  if [[ ${APT_UPDATED} -eq 0 ]]; then
    apt-get update -qq
    APT_UPDATED=1
  fi
}

is_installed() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'
}

apt_install() {
  local missing=() pkg
  for pkg in "$@"; do
    is_installed "${pkg}" || missing+=("${pkg}")
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    ok "packages present: $*"
    return
  fi
  apt_update_once
  apt-get install -y -qq --no-install-recommends "${missing[@]}" >/dev/null
  changed "installed ${missing[*]}"
}

# Writes stdin to a file only when the content differs. Returns 0 if it wrote, 1 if unchanged.
write_if_changed() {
  local target="$1" mode="$2" tmp
  tmp="$(mktemp)"
  cat >"${tmp}"
  if [[ -f ${target} ]] && cmp -s "${tmp}" "${target}"; then
    rm -f "${tmp}"
    return 1
  fi
  install -m "${mode}" -o root -g root "${tmp}" "${target}"
  rm -f "${tmp}"
  return 0
}

# Downloads a URL to a file only when the file is missing.
fetch_once() {
  local url="$1" target="$2"
  if [[ -s ${target} ]]; then
    ok "present: ${target}"
    return
  fi
  install -d -m 0755 "$(dirname "${target}")"
  curl -fsSL "${url}" -o "${target}"
  chmod 0644 "${target}"
  changed "downloaded ${target}"
  APT_UPDATED=0 # a new repository needs a fresh apt index
}

# Number of valid public keys in an authorized_keys file (0 when missing or empty).
count_keys() {
  local file="$1"
  [[ -s ${file} ]] || {
    echo 0
    return
  }
  { ssh-keygen -l -f "${file}" 2>/dev/null || true; } | wc -l
}

# True when the user is a member of the group (no pipes: safe under pipefail).
in_group() {
  [[ " $(id -nG "$1") " == *" $2 "* ]]
}

# --- 1. base packages ----------------------------------------------------------

step "Base packages"
apt_install ca-certificates curl gnupg ufw unattended-upgrades openssh-server

# --- 2. admin user + SSH key ---------------------------------------------------

step "Admin user '${NEW_USER}'"
if id -u "${NEW_USER}" >/dev/null 2>&1; then
  ok "user exists"
else
  useradd --create-home --shell /bin/bash "${NEW_USER}"
  changed "created user ${NEW_USER}"
fi
USER_HOME="$(getent passwd "${NEW_USER}" | cut -d: -f6)"

if in_group "${NEW_USER}" sudo; then
  ok "in group sudo"
else
  usermod -aG sudo "${NEW_USER}"
  changed "added ${NEW_USER} to group sudo"
fi

# Password login is disabled below, so a user without a password could never use sudo.
# Grant passwordless sudo only in that case; set a password (passwd) and delete the drop-in
# if you prefer sudo to ask for one.
SUDOERS_FILE="/etc/sudoers.d/90-omero-${NEW_USER}"
if [[ "$(passwd -S "${NEW_USER}" | awk '{print $2}')" == "P" ]]; then
  ok "user has a password; sudo will ask for it"
elif [[ -f ${SUDOERS_FILE} ]]; then
  ok "passwordless sudo drop-in present (${SUDOERS_FILE})"
else
  tmp_sudoers="$(mktemp)"
  printf '%s ALL=(ALL) NOPASSWD:ALL\n' "${NEW_USER}" >"${tmp_sudoers}"
  visudo -cf "${tmp_sudoers}" >/dev/null || die "Generated sudoers drop-in is invalid."
  install -m 0440 -o root -g root "${tmp_sudoers}" "${SUDOERS_FILE}"
  rm -f "${tmp_sudoers}"
  changed "passwordless sudo for ${NEW_USER} (${SUDOERS_FILE})"
fi

SSH_DIR="${USER_HOME}/.ssh"
AUTH_KEYS="${SSH_DIR}/authorized_keys"
if [[ ! -d ${SSH_DIR} ]]; then
  install -d -m 0700 -o "${NEW_USER}" -g "${NEW_USER}" "${SSH_DIR}"
  changed "created ${SSH_DIR}"
fi
if [[ ! -f ${AUTH_KEYS} ]]; then
  install -m 0600 -o "${NEW_USER}" -g "${NEW_USER}" /dev/null "${AUTH_KEYS}"
  changed "created ${AUTH_KEYS}"
fi

# Appends key lines that are not in authorized_keys yet.
add_keys_from() {
  local source_file="$1" line added=0
  while IFS= read -r line || [[ -n ${line} ]]; do
    [[ -z ${line} || ${line} == \#* ]] && continue
    if ! grep -qxF -- "${line}" "${AUTH_KEYS}"; then
      printf '%s\n' "${line}" >>"${AUTH_KEYS}"
      added=$((added + 1))
    fi
  done <"${source_file}"
  echo "${added}"
}

if [[ -n ${SSH_PUBKEY} ]]; then
  tmp_key="$(mktemp)"
  printf '%s\n' "${SSH_PUBKEY}" >"${tmp_key}"
  ssh-keygen -l -f "${tmp_key}" >/dev/null 2>&1 || {
    rm -f "${tmp_key}"
    die "SSH_PUBKEY is not a valid public key line."
  }
  n="$(add_keys_from "${tmp_key}")"
  rm -f "${tmp_key}"
  if [[ ${n} -gt 0 ]]; then changed "added SSH_PUBKEY to ${AUTH_KEYS}"; else ok "SSH_PUBKEY already authorized"; fi
elif [[ "$(count_keys "${AUTH_KEYS}")" -eq 0 && "$(count_keys /root/.ssh/authorized_keys)" -gt 0 ]]; then
  n="$(add_keys_from /root/.ssh/authorized_keys)"
  changed "copied ${n} key(s) from /root/.ssh/authorized_keys"
else
  ok "authorized_keys has $(count_keys "${AUTH_KEYS}") key(s)"
fi
# Keep ownership and modes strict (sshd ignores keys with loose permissions).
chown "${NEW_USER}:${NEW_USER}" "${SSH_DIR}" "${AUTH_KEYS}"
chmod 0700 "${SSH_DIR}"
chmod 0600 "${AUTH_KEYS}"

# --- 3. sshd hardening -------------------------------------------------------------

step "SSH hardening"
KEY_COUNT="$(count_keys "${AUTH_KEYS}")"
if [[ ${KEY_COUNT} -eq 0 ]]; then
  # Lockout guard: never turn off root/password login while the new user cannot log in with a key.
  warn "${NEW_USER} has no valid key in ${AUTH_KEYS}."
  warn "NOT disabling root or password login, to avoid locking you out."
  warn "Re-run with SSH_PUBKEY=\"ssh-ed25519 ...\" (or --ssh-key)."
else
  # Ubuntu's sshd_config includes sshd_config.d/*.conf first and the first value of each
  # option wins, so the 00- prefix beats 50-cloud-init.conf and similar provider files.
  previous=""
  [[ -f ${SSHD_DROPIN} ]] && previous="$(cat "${SSHD_DROPIN}")"
  if write_if_changed "${SSHD_DROPIN}" 0644 <<'EOF'; then
# Managed by omero-social-post infra/bootstrap.sh. Key-only SSH, no root login.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
EOF
    install -d -m 0755 /run/sshd # sshd -t needs the privilege separation directory
    if ! sshd -t; then
      if [[ -n ${previous} ]]; then printf '%s\n' "${previous}" >"${SSHD_DROPIN}"; else rm -f "${SSHD_DROPIN}"; fi
      die "sshd -t rejected the configuration; the drop-in was rolled back."
    fi
    if systemctl is-active --quiet ssh; then
      systemctl reload ssh
    fi
    changed "wrote ${SSHD_DROPIN} and reloaded sshd"
  else
    ok "drop-in up to date (${SSHD_DROPIN})"
  fi
  SSH_HARDENED=1

  # Check the effective configuration: an earlier-sorted file could still override ours.
  install -d -m 0755 /run/sshd
  effective="$(sshd -T 2>/dev/null)"
  for expected in 'permitrootlogin no' 'passwordauthentication no' 'kbdinteractiveauthentication no'; do
    if grep -qx "${expected}" <<<"${effective}"; then
      ok "effective: ${expected}"
    else
      warn "effective sshd config does not have '${expected}'; check /etc/ssh/sshd_config.d/."
    fi
  done
fi

# --- 4. firewall -------------------------------------------------------------------

step "Firewall (ufw)"
SSH_PORT="$(sshd -T 2>/dev/null | awk '$1 == "port" {print $2; exit}')"
SSH_PORT="${SSH_PORT:-22}"
ufw_status="$(ufw status verbose)"
if grep -q 'Default: deny (incoming), allow (outgoing)' <<<"${ufw_status}"; then
  ok "defaults: deny incoming, allow outgoing"
else
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  changed "defaults set to deny incoming, allow outgoing"
fi
# `ufw show added` lists rules even while ufw is inactive (with any comment appended).
ufw_added="$(ufw show added)"
if grep -qE "^ufw allow ${SSH_PORT}/tcp( |\$)" <<<"${ufw_added}"; then
  ok "SSH allowed on ${SSH_PORT}/tcp"
else
  # Later, once Tailscale SSH works, you can close public SSH and keep it tailnet-only
  # (the tailscale0 rule below already covers it): ufw delete allow 22/tcp
  ufw allow "${SSH_PORT}/tcp" comment 'SSH' >/dev/null
  changed "allowed SSH on ${SSH_PORT}/tcp"
fi
# Everything arriving over the tailnet is allowed: access is governed by Tailscale ACLs.
# This is what lets `tailscale serve` (HTTPS 443) and Tailscale SSH through.
if grep -qE '^ufw allow in on tailscale0( |$)' <<<"${ufw_added}"; then
  ok "tailnet traffic allowed (in on tailscale0)"
else
  ufw allow in on tailscale0 comment 'Tailscale' >/dev/null
  changed "allowed incoming traffic on tailscale0"
fi
if grep -q '^Status: active' <<<"${ufw_status}"; then
  ok "ufw active"
else
  ufw --force enable >/dev/null
  changed "ufw enabled"
fi
# No app ports: the web container publishes only on 127.0.0.1 and Tailscale serves it.
# (Docker's own iptables rules bypass ufw for published ports, which is why the compose file
# never publishes on 0.0.0.0.)

# --- 5. unattended upgrades ----------------------------------------------------------

step "Unattended security upgrades"
if write_if_changed "${AUTO_UPGRADES}" 0644 <<'EOF'; then
// Managed by omero-social-post infra/bootstrap.sh.
// Daily package lists + unattended-upgrade (security origins, see 50unattended-upgrades).
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  changed "wrote ${AUTO_UPGRADES}"
else
  ok "${AUTO_UPGRADES} up to date"
fi
if systemctl is-enabled --quiet unattended-upgrades; then
  ok "unattended-upgrades service enabled"
else
  systemctl enable --now unattended-upgrades >/dev/null 2>&1
  changed "enabled unattended-upgrades service"
fi

# --- 6. Docker -------------------------------------------------------------------------

step "Docker Engine + compose plugin"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "docker and the compose plugin are installed ($(docker --version))"
else
  if is_installed docker.io || is_installed podman-docker; then
    die "Ubuntu's docker.io/podman-docker is installed and conflicts with Docker CE. Remove it (apt-get remove docker.io docker-compose podman-docker) or reinstall the VPS, then re-run."
  fi
  install -d -m 0755 /etc/apt/keyrings
  fetch_once https://download.docker.com/linux/ubuntu/gpg /etc/apt/keyrings/docker.asc
  if write_if_changed /etc/apt/sources.list.d/docker.sources 0644 <<EOF; then
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${CODENAME}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
    changed "added Docker apt repository"
    APT_UPDATED=0
  else
    ok "Docker apt repository present"
  fi
  apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if systemctl is-enabled --quiet docker && systemctl is-active --quiet docker; then
  ok "docker service enabled and running"
else
  systemctl enable --now docker >/dev/null 2>&1
  changed "enabled and started docker"
fi
if in_group "${NEW_USER}" docker; then
  ok "${NEW_USER} in group docker"
else
  usermod -aG docker "${NEW_USER}"
  changed "added ${NEW_USER} to group docker (log in again to use it)"
fi

# --- 7. Tailscale ------------------------------------------------------------------------

step "Tailscale"
if command -v tailscale >/dev/null 2>&1; then
  ok "tailscale installed ($(tailscale version 2>/dev/null | sed -n 1p))"
else
  fetch_once "https://pkgs.tailscale.com/stable/ubuntu/${CODENAME}.noarmor.gpg" \
    /usr/share/keyrings/tailscale-archive-keyring.gpg
  if write_if_changed /etc/apt/sources.list.d/tailscale.list 0644 <<EOF; then
deb [signed-by=/usr/share/keyrings/tailscale-archive-keyring.gpg] https://pkgs.tailscale.com/stable/ubuntu ${CODENAME} main
EOF
    changed "added Tailscale apt repository"
    APT_UPDATED=0
  else
    ok "Tailscale apt repository present"
  fi
  apt_install tailscale
fi
if systemctl is-enabled --quiet tailscaled && systemctl is-active --quiet tailscaled; then
  ok "tailscaled enabled and running"
else
  systemctl enable --now tailscaled >/dev/null 2>&1
  changed "enabled and started tailscaled"
fi
# `tailscale status` exits non-zero while logged out or stopped.
if tailscale status >/dev/null 2>&1; then
  ok "connected to the tailnet as $(tailscale status --self --peers=false 2>/dev/null | awk 'NR==1 {print $2}')"
  TS_CONNECTED=1
elif [[ -n ${TS_AUTHKEY} ]]; then
  # Pass the key through a root-only file so it never shows up in the process list.
  key_file="$(mktemp)"
  chmod 0600 "${key_file}"
  printf '%s' "${TS_AUTHKEY}" >"${key_file}"
  ts_args=(up --ssh "--auth-key=file:${key_file}")
  [[ -n ${TS_HOSTNAME} ]] && ts_args+=("--hostname=${TS_HOSTNAME}")
  if tailscale "${ts_args[@]}"; then
    rm -f "${key_file}"
    changed "joined the tailnet (Tailscale SSH enabled)"
    TS_CONNECTED=1
  else
    rm -f "${key_file}"
    die "tailscale up failed (expired or already-used auth key?)."
  fi
else
  warn "Not connected to a tailnet and no TS_AUTHKEY given. Run it yourself:"
  warn "  sudo tailscale up --ssh${TS_HOSTNAME:+ --hostname=${TS_HOSTNAME}}"
  warn "and open the login URL it prints."
fi

# --- 8. app directory --------------------------------------------------------------------

step "App directory ${APP_DIR}"
for dir in "${APP_DIR}" "${APP_DIR}/backups"; do
  if [[ -d ${dir} && "$(stat -c '%U:%G %a' "${dir}")" == "${NEW_USER}:${NEW_USER} 750" ]]; then
    ok "${dir} (${NEW_USER}, 750)"
  else
    install -d -m 0750 -o "${NEW_USER}" -g "${NEW_USER}" "${dir}"
    changed "${dir} owned by ${NEW_USER} (750)"
  fi
done

# --- summary -------------------------------------------------------------------------------

step "Done"
if [[ ${CHANGES} -eq 0 ]]; then
  echo "    Nothing changed: this server was already bootstrapped."
else
  echo "    ${CHANGES} change(s) applied."
fi

cat <<EOF

Next steps (details in infra/README.md):

  1. In a NEW terminal, check you can log in before closing this session:
       ssh ${NEW_USER}@<server-ip>        (or: ssh ${NEW_USER}@<tailscale-name> via Tailscale SSH)
  2. As ${NEW_USER}, put docker-compose.yml, backup.sh and .env in ${APP_DIR}:
       cd ${APP_DIR}
       curl -fsSLO https://raw.githubusercontent.com/Avesousa/omero-social-post/main/infra/docker-compose.yml
       curl -fsSLO https://raw.githubusercontent.com/Avesousa/omero-social-post/main/infra/backup.sh
       curl -fsSL -o .env https://raw.githubusercontent.com/Avesousa/omero-social-post/main/infra/.env.example
       chmod 600 .env && chmod +x backup.sh
  3. Fill in .env (ENCRYPTION_KEY: openssl rand -base64 32; POSTGRES_PASSWORD: openssl rand -hex 24).
  4. docker compose pull && docker compose up -d
  5. sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
     and set PUBLIC_BASE_URL in .env to the https://<host>.<tailnet>.ts.net URL it prints.
EOF

if [[ ${SSH_HARDENED} -eq 0 ]]; then
  warn "SSH was NOT hardened (no key for ${NEW_USER}). Fix that and re-run this script."
  exit 3
fi
if [[ ${TS_CONNECTED} -eq 0 ]]; then
  echo
  echo "Reminder: Tailscale is installed but not connected yet (see the warning above)."
fi
