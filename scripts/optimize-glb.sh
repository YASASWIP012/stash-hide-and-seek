#!/usr/bin/env bash
# Shrink a Lux3D GLB for the web: weld, simplify, 512px JPEG textures. Free, runs locally.
# usage: scripts/optimize-glb.sh in.glb out.glb [ratio]
set -euo pipefail
in="$1"; out="$2"; ratio="${3:-0.05}"
tmp="$(mktemp -d)"
g() { npx -y @gltf-transform/cli@4 "$@" >/dev/null; }
g weld "$in" "$tmp/1.glb"
g simplify "$tmp/1.glb" "$tmp/2.glb" --ratio "$ratio" --error 0.002
g resize "$tmp/2.glb" "$tmp/3.glb" --width 512 --height 512
g jpeg "$tmp/3.glb" "$tmp/4.glb" --quality 80
g prune "$tmp/4.glb" "$out"
rm -rf "$tmp"
ls -la "$out"
