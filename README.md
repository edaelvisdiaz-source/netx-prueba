# Radika

Servicio que hace seguimiento automático a trámites y le avisa al CRM cuando algo cambia.
El CRM registra cada trámite por la API; Radika lo revisa varias veces al día, guarda las
novedades y las entrega al CRM para que actualice la pestaña de Seguimiento.

## Estado por fases

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Tutelas y procesos judiciales (Rama Judicial), términos de tutela, avisos al CRM | Construida; formato de la Rama Judicial comprobado con una tutela real |
| 2 | Resumen de cada actuación con IA | Construida; falta probarla con una llave real de la API |
| 3 | Ministerio de Educación: convalidaciones y legalizaciones (con usuario del cliente) | Bóveda de credenciales y motor de revisión construidos; falta el lector de la pantalla del portal |
| 4 | Cancillería (apostillas) y SAC | Pendiente |

Los trámites de las fases 3 y 4 ya se pueden registrar: quedan con fuente `MANUAL` y sin
revisión automática hasta que exista su lector.

## Puesta en marcha

Requiere Node 20 o superior y PostgreSQL 16.

```bash
npm install
cp .env.example .env        # completa los valores, incluido DATABASE_URL
npm run build
npm start                   # crea las tablas al arrancar
```

Variables obligatorias: `DATABASE_URL` y `RADIKA_API_KEYS` (una o varias llaves de mínimo
32 caracteres, separadas por coma). El resto está explicado en `.env.example`.

En producción deja `NODE_ENV=production` (es el valor por defecto y exige `https` en la
dirección del CRM), agrega `?sslmode=require` a `DATABASE_URL` y, si hay un balanceador
delante, pon en `TRUST_PROXY_HOPS` cuántos son para que el límite de peticiones cuente por
cliente real. El límite es de 120 peticiones por minuto, y 10 por minuto para `revisar`.

## Despliegue

Radika es un solo proceso que debe estar encendido todo el tiempo (revisa trámites y correo
cada pocos minutos) y una base de datos PostgreSQL 16. No encaja en funciones bajo demanda.

**En un servidor con Docker**, con su propia base de datos:

```bash
cp .env.example .env     # completa RADIKA_API_KEYS y POSTGRES_PASSWORD; lo demás es opcional
docker compose up -d --build
curl http://127.0.0.1:3000/health
```

**Con una base de datos externa** (por ejemplo RDS): quita el servicio `db` de
`docker-compose.yml` y define `DATABASE_URL` en `.env`. Radika crea sus tablas al arrancar;
basta con una base vacía y un usuario dueño de ella.

Lo que el servidor necesita:

| Necesidad | Detalle |
|---|---|
| Salida a internet | Puerto 448 hacia `consultaprocesos.ramajudicial.gov.co`, 993 hacia el correo, 443 hacia el CRM y la API de Anthropic |
| Entrada | Solo desde el CRM, por HTTPS. El puerto de Radika se publica en `127.0.0.1`; delante va un proxy con certificado (Caddy, Nginx o un balanceador) |
| Memoria | 1 GB es suficiente |
| Secretos | `RADIKA_API_KEYS`, `DATABASE_URL` o `POSTGRES_PASSWORD`, `CRM_WEBHOOK_SECRET`, `IMAP_PASSWORD`, `ANTHROPIC_API_KEY`: en el gestor de secretos del servidor, nunca en el repositorio |
| Una sola copia | Puede haber varias sin duplicar avisos, pero una basta para este volumen |

Después de desplegar, comprueba lo que las pruebas automáticas solo simulan:

1. `docker compose exec radika node -e "fetch('https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Procesos/Consulta/NumeroRadicacion?numero=11001310305620260005200&SoloActivos=false&pagina=1').then(r=>console.log(r.status))"`
   debe imprimir `200`. Si falla, el servidor no alcanza a la Rama Judicial (algunos sitios del
   Estado bloquean direcciones de fuera de Colombia) y hay que cambiar de región o proveedor.
2. Registra un trámite real y llama `POST /v1/tramites/:id/revisar`: debe traer sus actuaciones.
3. Con el buzón configurado, envía un correo de prueba y revisa los registros del servicio.
4. Con `ANTHROPIC_API_KEY`, la siguiente actuación nueva debe llegar con `resumen`.

### Prueba en vivo de la Rama Judicial

Desde un equipo con salida a internet:

```bash
npm run smoke:rama -- 11001310300120260012300
```

Debe listar los despachos y las últimas actuaciones del radicado. Si responde
"La fuente cambió su formato", el lector necesita un ajuste.

### Pruebas

```bash
npm test          # necesita PostgreSQL; usa TEST_DATABASE_URL si la defines
npm run test:cov
```

## API

Todas las rutas, salvo `/health`, exigen el encabezado `X-Api-Key`. Las respuestas usan
siempre el mismo sobre:

```json
{ "success": true, "data": {}, "error": null, "meta": { "total": 0, "page": 1, "limit": 20 } }
```

| Método y ruta | Qué hace |
|---|---|
| `GET /health` | Confirma que el servicio está arriba |
| `POST /v1/tramites` | Registra un trámite |
| `GET /v1/tramites` | Lista con filtros `referenciaCrm`, `tipo`, `estado`, `page`, `limit` |
| `GET /v1/tramites/:id` | Detalle con actuaciones y términos calculados |
| `PATCH /v1/tramites/:id` | Cambia `estado` (`ACTIVO`, `PAUSADO`, `CERRADO`), `referenciaCrm` o `clienteNombre` |
| `DELETE /v1/tramites/:id` | Elimina el trámite y su historial |
| `POST /v1/tramites/:id/revisar` | Revisa ahora mismo, sin esperar el turno |
| `PUT /v1/tramites/:id/credencial` | Guarda o reemplaza el usuario y la clave del portal (`usuario`, `clave`) |
| `DELETE /v1/tramites/:id/credencial` | Borra la credencial |
| `GET /v1/tramites/:id/accesos` | Bitácora de ingresos de Radika al portal con esa credencial |
| `POST /v1/tramites/:id/actuaciones` | Registra una actuación revisada a mano (`fecha`, `titulo`, `anotacion`) |
| `POST /v1/correos` | Recibe un correo de un despacho y lo enlaza con su trámite |
| `GET /v1/correos/pendientes` | Correos de juzgados sin trámite asociado |
| `DELETE /v1/correos/pendientes/:id` | Quita un correo de esa lista |
| `GET /v1/eventos` | Novedades en orden, con `cursor` y `limit` |
| `POST /v1/eventos/reintentar` | Vuelve a poner en cola los avisos que agotaron sus intentos |

### Registrar un trámite

```json
{
  "tipo": "TUTELA",
  "radicado": "11001-31-03-001-2026-00123-00",
  "referenciaCrm": "E4MXO9T4",
  "clienteNombre": "María Fernanda Rojas"
}
```

- `tipo`: `TUTELA`, `PROCESO_JUDICIAL`, `CONVALIDACION_MEN`, `LEGALIZACION_MEN`, `SAC_MEN`, `APOSTILLA`.
- `radicado`: 23 dígitos para los judiciales (se aceptan guiones y espacios).
- `referenciaCrm`: el código de la venta en el CRM. Vuelve en cada aviso para ubicar la tarjeta.

## Avisos al CRM

Si se definen `CRM_WEBHOOK_URL` y `CRM_WEBHOOK_SECRET`, Radika envía cada novedad con un
`POST` a esa dirección. Si el CRM no responde con un código 2xx, reintenta al minuto, a los
5, a los 30, a las 2 horas y cada 12 horas, hasta 8 intentos. Si el CRM prefiere preguntar,
puede leer lo mismo en `GET /v1/eventos`.

```json
{
  "id": "…",
  "tipo": "ACTUACION_NUEVA",
  "creadoEn": "2026-11-22T21:47:36.000Z",
  "tramite": { "id": "…", "tipo": "TUTELA", "radicado": "…", "referenciaCrm": "E4MXO9T4", "clienteNombre": "…" },
  "datos": {
    "actuacion": { "fecha": "2026-11-17", "titulo": "Sentencia de primera instancia", "anotacion": null, "despacho": "…", "categoria": "FALLO" },
    "notaSugerida": "Radika: actuacion del 2026-11-17 - Sentencia de primera instancia."
  }
}
```

| Tipo de aviso | Cuándo sale |
|---|---|
| `TRAMITE_SINCRONIZADO` | La primera vez que la fuente muestra el radicado |
| `ACTUACION_NUEVA` | Cada actuación que no estaba en la revisión anterior |
| `TERMINO_POR_VENCER` | Faltan 2 días hábiles o menos para un término de tutela |
| `TERMINO_VENCIDO` | El juez no falló dentro de los 10 días hábiles |
| `ERROR_FUENTE` | Cinco revisiones seguidas fallaron para ese trámite |

`notaSugerida` está pensada para guardarse como nota de la venta en Seguimiento.

### Verificar la firma

Cada aviso trae `X-Radika-Timestamp` y `X-Radika-Signature`. El CRM debe calcular
`sha256=` + HMAC-SHA256 de `"<timestamp>.<cuerpo tal como llegó>"` con el secreto compartido,
compararlo con la firma y rechazar avisos con más de 5 minutos de antigüedad. `X-Radika-Event-Id`
sirve para descartar repetidos.

## Resumen con IA

Si se define `ANTHROPIC_API_KEY`, cada actuación nueva se envía a Claude y vuelve explicada en
lenguaje sencillo. El resultado se guarda con la actuación y viaja en el aviso:

```json
"resumen": {
  "resumen": "El juez decidió la tutela en primera instancia.",
  "queSignifica": "Ya hay fallo; hay que leerlo para saber si fue a favor.",
  "accionSugerida": "Revisar el fallo con el abogado y avisar al cliente.",
  "urgencia": "ALTA"
}
```

- Cuando hay resumen, `notaSugerida` lo usa; si no, lleva el título de la actuación.
- Solo se resumen las novedades, no el historial de la primera sincronización.
- A Claude se le envían el tipo de trámite, el despacho, la fecha, el título y la anotación de
  la actuación, y los títulos de las anteriores. No se envían el nombre del cliente ni las
  partes, salvo que el juzgado los escriba dentro de la anotación.
- Si la API falla o no hay llave, el aviso sale igual con `"resumen": null`.
- El modelo se cambia con `RESUMEN_IA_MODELO`. Si el modelo declina una petición, la API la
  reintenta sola con un modelo de respaldo.
- El resumen es una ayuda de lectura, no un concepto jurídico.

## Correos de los juzgados

Los juzgados notifican por correo la admisión, el fallo y los demás autos. `POST /v1/correos`
recibe cada correo y lo convierte en una actuación del trámite al que pertenece:

```json
{
  "messageId": "<...@exchangelabs.com>",
  "from": "j17pccbt@cendoj.ramajudicial.gov.co",
  "fromNombre": "Juzgado 17 Penal Circuito Conocimiento - Bogotá",
  "subject": "NOTIFICA FALLO TUTELA 110013109017-2026 - 9795 Accionante: ...",
  "date": "2026-11-11T21:54:06Z",
  "adjuntos": ["10. Fallo de tutela 9795.pdf"],
  "texto": "opcional; solo se usa para buscar el radicado y no se guarda"
}
```

- El trámite se ubica por el radicado: completo (23 dígitos, con o sin guiones), por despacho
  + año + consecutivo (`110013109017-2026 - 9795`) o, si un solo trámite coincide, por año +
  consecutivo (`2026-09795`).
- Responde `{ "vinculado": true, "tramiteId": "...", "duplicado": false }`, o
  `{ "vinculado": false, "motivo": "..." }` con `SIN_RADICADO`, `SIN_TRAMITE`, `AMBIGUO` o
  `REMITENTE_NO_CONFIABLE`. Los no vinculados no se guardan: quien envía decide qué hacer.
- El mismo correo enviado dos veces no duplica la actuación.
- Solo se aceptan remitentes de los dominios de `CORREO_DOMINIOS_CONFIABLES`. Radika confía
  en que quien lee el buzón ya verificó la autenticidad del correo (SPF/DKIM).

### Lector del buzón

Con `IMAP_HOST`, `IMAP_USER` e `IMAP_PASSWORD` definidos, Radika revisa el buzón cada 5
minutos y hace esto mismo sola:

- Abre la carpeta en modo solo lectura: no marca correos como leídos, no mueve ni borra nada.
- Lee solo los encabezados (remitente, asunto, fecha, nombres de adjuntos), no el cuerpo.
- La primera vez toma como punto de partida el último correo que haya; el historial anterior
  no se procesa.
- Ignora por completo los correos que no vienen de un dominio judicial.
- Los correos de juzgados que no logra enlazar quedan en `GET /v1/correos/pendientes` con el
  motivo; casi siempre indican una tutela que falta registrar. Se quitan de la lista con
  `DELETE /v1/correos/pendientes/:id`.

La lógica del lector está probada con un buzón simulado; la conexión IMAP real se comprueba
al desplegar, con el buzón de verdad.

## Portales con usuario y clave

Para los trámites del Ministerio de Educación, el radicador escribe en el CRM el usuario y la
clave del cliente, y el CRM los envía con `PUT /v1/tramites/:id/credencial`.

- Se guardan cifrados (AES-256-GCM) con `CREDENCIALES_LLAVE`, que vive fuera de la base de
  datos. Una copia de la base no sirve para leerlos.
- Ninguna ruta los devuelve. El detalle del trámite solo dice `credencialConfigurada: true`.
- Al guardarla, el trámite pasa a la fuente `MEN_PORTAL` y Radika lo revisa una vez al día.
- La primera lectura produce `TRAMITE_SINCRONIZADO` con el estado. Cada cambio de estado se
  registra como actuación ("Cambio de estado: …") y sale como `ACTUACION_NUEVA` con
  `"origen": "PORTAL"`. El estado vigente queda en `tramite.estadoFuente`.
- Si el portal rechaza la clave, Radika avisa de inmediato con `ERROR_FUENTE` y no vuelve a
  intentar hasta el día siguiente, para no bloquear la cuenta del cliente.
- Cada ingreso queda en la bitácora (`GET /v1/tramites/:id/accesos`).

El lector que entra al portal y lee la pantalla de estado todavía no existe: mientras no esté
instalado, estos trámites no se revisan solos y siguen por revisión asistida.

## Revisión asistida

Para lo que Radika no consulta sola (SAMAI, y por ahora Ministerio de Educación, SAC y
Cancillería), el flujo es: abrir el enlace de `enlacesConsulta`, revisar, y registrar lo que
cambió con `POST /v1/tramites/:id/actuaciones`. Esa actuación se clasifica, se resume y
genera el mismo aviso `ACTUACION_NUEVA` que una detectada automáticamente, con
`"origen": "MANUAL"`.

## Términos de tutela

Se cuentan en días hábiles de Colombia (sin sábados, domingos ni festivos):

- **Fallo de primera instancia:** 10 días hábiles desde la fecha de radicación.
- **Impugnación:** 3 días hábiles desde la fecha del fallo.

Son estimados: el término real corre desde la notificación, y el cálculo no descuenta paros
ni vacancia judicial. La categoría de cada actuación (admisión, fallo, impugnación, desacato)
se deduce por palabras clave y es una ayuda, no un concepto jurídico.

## Límites conocidos

- La consulta usa el servicio público de la página de Consulta de Procesos de la Rama Judicial.
  No es una API con contrato oficial: puede cambiar o caerse sin aviso. Radika lo detecta y lo
  reporta en `ultimoError` y con el aviso `ERROR_FUENTE`.
- **SAMAI** (juzgados y tribunales administrativos, Consejo de Estado): su buscador es público,
  pero la ficha con las actuaciones pide una verificación "no soy un robot". Radika no la
  salta. El detalle de cada trámite trae en `enlacesConsulta` el enlace directo a la ficha
  para revisarla a mano y registrar la novedad con `POST /v1/tramites/:id/actuaciones`.
- **TYBA** pide captcha y la **Corte Constitucional** publica la selección de tutelas en autos;
  ninguna de las dos tiene consulta automática en Radika.
- Radika no envía WhatsApp ni correos por su cuenta: entrega el aviso al CRM y este decide.
