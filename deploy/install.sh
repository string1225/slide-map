#!/usr/bin/env bash
set -euo pipefail
release_id="${1:?release id required}"
archive="${2:?archive required}"
[[ "$release_id" =~ ^[0-9]{14}$ ]] || { echo 'Invalid release id'; exit 1; }
[[ -f "$archive" ]] || { echo 'Archive missing'; exit 1; }
[[ -s /etc/slide-map/server.env ]] || { echo 'Provision server environment first'; exit 1; }
release="/opt/slide-map/releases/$release_id"
backup="/opt/slide-map/backups/$release_id"
site=/etc/nginx/conf.d/sunny-string.conf
snippet=/etc/nginx/snippets/slide-map-location.conf
unit=/etc/systemd/system/slide-map.service
[[ ! -e "$release" ]] || { echo 'Release already exists'; exit 1; }
[[ ! -e /opt/slide-map/current || -L /opt/slide-map/current ]] || { echo 'Current path is not a symlink'; exit 1; }
if [[ ! -L /opt/slide-map/current ]] && ss -H -lnt '( sport = :3042 )' | grep -q .; then
    echo 'Port 3042 already occupied; refusing to replace an unrelated service'; exit 1
fi
id -u slide-map >/dev/null 2>&1 || useradd --system --home-dir /var/lib/slide-map --shell /sbin/nologin slide-map
install -d -m 755 /opt/slide-map/releases "$release" /etc/nginx/snippets
install -d -m 700 "$backup"
install -d -m 700 -o slide-map -g slide-map /var/lib/slide-map
cp -p "$site" "$backup/site.conf"
[[ ! -f "$snippet" ]] || cp -p "$snippet" "$backup/location.conf"
[[ ! -f "$unit" ]] || cp -p "$unit" "$backup/service.conf"
previous="$(readlink /opt/slide-map/current || true)"
rollback() {
    trap - ERR
    set +e
    cp -p "$backup/site.conf" "$site"
    if [[ -f "$backup/location.conf" ]]; then cp -p "$backup/location.conf" "$snippet"; else rm -f "$snippet"; fi
    if [[ -n "$previous" ]]; then
        ln -sfn "$previous" /opt/slide-map/current
    else
        systemctl disable --now slide-map
        [[ ! -L /opt/slide-map/current ]] || rm /opt/slide-map/current
    fi
    if [[ -f "$backup/service.conf" ]]; then cp -p "$backup/service.conf" "$unit"; else rm -f "$unit"; fi
    systemctl daemon-reload
    [[ -z "$previous" ]] || systemctl restart slide-map
    nginx -t && systemctl reload nginx
    echo 'Deployment failed; restored prior configuration. Release and backup retained.' >&2
}
trap rollback ERR
tar -xzf "$archive" -C "$release" --no-same-owner
chmod -R u=rwX,go=rX "$release"
install -m 644 "$release/deploy/slide-map-location.conf" "$snippet"
install -m 644 "$release/deploy/slide-map.service" "$unit"
python3 - <<'PY'
from pathlib import Path
p = Path('/etc/nginx/conf.d/sunny-string.conf')
text = p.read_text()
include = '    include /etc/nginx/snippets/slide-map-location.conf;'
anchor = '    include /etc/nginx/snippets/hexwar-location.conf;'
if include not in text:
    if text.count(anchor) != 1:
        raise RuntimeError('Expected HTTPS include anchor not found')
    p.write_text(text.replace(anchor, anchor + '\n' + include))
PY
nginx -t
ln -sfn "$release" /opt/slide-map/current
systemctl daemon-reload
systemctl enable slide-map
systemctl restart slide-map
for attempt in $(seq 1 15); do
    if curl --fail --silent http://127.0.0.1:3042/api/health >/dev/null; then break; fi
    sleep 1
done
curl --fail --silent http://127.0.0.1:3042/api/health
systemctl reload nginx
trap - ERR
printf '\nSlide Map release %s deployed\n' "$release_id"
