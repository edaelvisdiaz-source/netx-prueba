#!/bin/bash
# Copia diaria de la base de datos de Radika al almacen privado. Si falla, avisa por el tema de alertas.
# Se instala en el servidor como /opt/radika/respaldo.sh y lo ejecuta el temporizador radika-respaldo.timer.
set -euo pipefail
BUCKET=${RESPALDO_BUCKET:?define RESPALDO_BUCKET}
TEMA=${RESPALDO_TEMA_ALERTAS:-}
REGION=${AWS_REGION:-us-east-1}
ARCHIVO=$(mktemp /tmp/radika-respaldo.XXXXXX)
avisar() {
  [ -n "$TEMA" ] || return 0
  aws sns publish --region "$REGION" --topic-arn "$TEMA" --subject "Radika: fallo la copia de respaldo" \
    --message "La copia diaria de la base de datos de Radika no se pudo hacer ($(date -u +%F)). Revisa: journalctl -u radika-respaldo" >/dev/null 2>&1 || true
}
trap 'rm -f "$ARCHIVO"' EXIT
trap 'avisar' ERR
# Los datos de conexion salen de la configuracion del servicio; la clave no aparece en la linea de comandos.
eval "$(python3 - <<'PY'
import shlex
from urllib.parse import urlparse, unquote
url = next(l.split('=', 1)[1].strip() for l in open('/opt/radika/.env') if l.startswith('DATABASE_URL='))
u = urlparse(url)
for k, v in (('PGHOST', u.hostname), ('PGPORT', str(u.port or 5432)), ('PGUSER', unquote(u.username or '')), ('PGPASSWORD', unquote(u.password or '')), ('PGDATABASE', u.path.lstrip('/'))):
    print(f'export {k}={shlex.quote(v)}')
PY
)"
export PGSSLMODE=verify-full PGSSLROOTCERT=/ca.pem
docker run --rm --network host -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGSSLROOTCERT \
  -v /opt/radika/rds-ca.pem:/ca.pem:ro postgres:16-alpine pg_dump --format=custom --no-owner --no-privileges > "$ARCHIVO"
TAMANO=$(stat -c %s "$ARCHIVO")
[ "$TAMANO" -gt 1000 ] || { echo "copia vacia"; exit 1; }
# Comprobar que la copia se puede leer antes de darla por buena.
docker run --rm -i postgres:16-alpine pg_restore --list < "$ARCHIVO" > /dev/null
aws s3 cp "$ARCHIVO" "s3://$BUCKET/respaldos/radika-$(date -u +%F).dump" --region "$REGION" --only-show-errors --sse AES256
echo "respaldo guardado: $TAMANO bytes"
