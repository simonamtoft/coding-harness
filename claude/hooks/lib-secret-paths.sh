#!/usr/bin/env bash
# Shared secret-path matcher, sourced by check-bash.sh and check-read.sh.
#
# Why this exists: the host-managed policy sets
# `allowManagedPermissionRulesOnly: true`, which makes user-level
# `permissions.deny` rules inert. The old deny globs for ~/.ssh, cloud creds,
# keychains, *.pem, etc. therefore no longer block anything — and `cat`/`head`
# are on check-bash's readonly allowlist, so `cat ~/.ssh/id_rsa` was being
# auto-allowed. Hooks are the only user-controlled enforcement that survives
# the managed policy, so the high-value secret paths are reinstated here.
#
# Scope is deliberately the security-relevant core (keys, cloud creds,
# keychains) — not a 1:1 reproduction of the old glob list. Browser profiles
# and similar low-value/noisy paths are intentionally omitted.

# _sp_normalize PATH -> resolves '.' and '..' lexically without touching disk.
_sp_normalize() {
  local path="$1" result="" part
  local -a parts
  IFS='/' read -ra parts <<< "$path"
  for part in "${parts[@]}"; do
    case "$part" in
      ""|".") ;;
      "..") result="${result%/*}" ;;
      *) result="$result/$part" ;;
    esac
  done
  printf '%s' "${result:-/}"
}

# path_is_secret RAWPATH -> exit 0 if the path points at a protected secret.
# Accepts ~, relative (resolved against $PWD), and absolute forms.
path_is_secret() {
  local p="$1" abs
  [[ -z "$p" ]] && return 1
  case "$p" in
    "~")    abs="$HOME" ;;
    "~/"*)  abs="${p/#\~/$HOME}" ;;
    /*)     abs="$p" ;;
    *)      abs="$PWD/$p" ;;
  esac
  abs="$(_sp_normalize "$abs")"

  case "$abs" in
    "$HOME"/.ssh|"$HOME"/.ssh/*)                 return 0 ;;
    "$HOME"/.aws|"$HOME"/.aws/*)                 return 0 ;;
    "$HOME"/.gnupg|"$HOME"/.gnupg/*)             return 0 ;;
    "$HOME"/.azure|"$HOME"/.azure/*)             return 0 ;;
    "$HOME"/.kube|"$HOME"/.kube/*)               return 0 ;;
    "$HOME"/.config/gcloud|"$HOME"/.config/gcloud/*) return 0 ;;
    "$HOME"/.gcloud|"$HOME"/.gcloud/*)           return 0 ;;
    "$HOME"/Library/Keychains|"$HOME"/Library/Keychains/*) return 0 ;;
    "$HOME"/.netrc|"$HOME"/.pypirc|"$HOME"/.npmrc) return 0 ;;
    "$HOME"/.docker/config.json)                 return 0 ;;
  esac

  # Basename / extension patterns, location-independent.
  case "$abs" in
    *.pem|*.key)                                 return 0 ;;
    */id_rsa|*/id_ed25519)                       return 0 ;;
    */credentials.json)                          return 0 ;;
    */service-account*.json)                     return 0 ;;
  esac

  return 1
}
