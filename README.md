# Radika

Servicio que hace seguimiento automático a trámites y le avisa al CRM cuando algo cambia.
El CRM registra cada trámite por la API; Radika lo revisa varias veces al día, guarda las
novedades y las entrega al CRM para que actualice la pestaña de Seguimiento.

## Estado por fases

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Tutelas y procesos judiciales (Rama Judicial), términos de tutela, avisos al CRM | Construida; formato de la Rama Judicial comprobado con una tutela real |
| 2 | Resumen de cada actuación con IA | Construida; falta probarla con una llave real de la API |
| 3 | Ministerio de Educación: convalidaciones y legalizaciones (con usuario del cliente) | Pendiente |
| 4 | Cancillería (apostillas) y SAC | Pendiente |

Los trámites de las fases 3 y 4 ya se pueden registrar: quedan con fuente `MANUAL` y sin
revisión automática hasta que exista su lector.

## Puesta en marcha

Requiere Node 20 o superior y PostgreSQL 16.

```bash
npm install
cp .env.example .env        # completa los valores
npm run build
npm start                   # crea las tablas al arrancar
```

Variables obligatorias: `DATABASE_URL` y `RADIKA_API_KEYS` (una o varias llaves de mínimo
32 caracteres, separadas por coma). El resto está explicado en `.env.example`.

En producción deja `NODE_ENV=production` (es el valor por defecto y exige `https` en la
dirección del CRM), agrega `?sslmode=require` a `DATABASE_URL` y, si hay un balanceador
delante, pon en `TRUST_PROXY_HOPS` cuántos son para que el límite de peticiones cuente por
cliente real. El límite es de 120 peticiones por minuto, y 10 por minuto para `revisar`.

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
- Los despachos que publican en otros sistemas (TYBA, SAMAI, Corte Constitucional) no están
  cubiertos todavía.
- Radika no envía WhatsApp ni correos por su cuenta: entrega el aviso al CRM y este decide.
