# Kapso: reparto de conversaciones entre asesoras

Configuración de la bandeja de WhatsApp en Kapso. Kapso no trae reparto automático; se hace
con una función propia que una automatización llama cada vez que se abre una conversación.

## Reglas

| Caso | A quién va |
|---|---|
| Cliente nuevo, lunes a viernes | Por turnos entre las titulares |
| Cliente que ya atendió una titular | A esa misma asesora |
| Su asesora está ausente | A la asesora de reemplazo (sin cambiarle la asesora) |
| Sábado | A la asesora de reemplazo |
| Fuera de horario | Se asigna igual y el cliente recibe un aviso |
| Ya tiene asesora asignada a mano | No se toca |

Titulares, reemplazo, horario y texto del aviso están en `CONFIG`, al inicio de
`asignar-asesora/index.js`. Las asesoras se buscan por nombre entre los miembros del proyecto.

## Piezas en Kapso

| Pieza | Nombre | Identificador |
|---|---|---|
| Función | Reparto de asesoras (`asignar-asesora`) | `f86088a6-1c94-4e32-9870-68fe27776001` |
| Función | Registro de clientes (`registro-de-clientes`) | `f08aa423-8b18-4a9e-9f24-acfe6e2a987e` |
| Automatización | Reparto de asesoras | `b59e1c7f-a562-4de0-b3d2-b5402d5ec51c` |
| Disparador | Conversación creada, línea de pruebas | `25ecc94c-3938-4dbd-b70d-971114ca1d58` |
| Línea de pruebas | +1 202-589-9059 | `1389236027614507` |

La función necesita el secreto `KAPSO_API_KEY` (página de la función → Secrets) para poder
asignar y enviar el aviso de fuera de horario. Sin él solo responde ensayos.

## Operación

Todas las llamadas van a `POST https://api.kapso.ai/platform/v1/functions/<id>/invoke` con la
llave en `X-API-Key`.

- Ensayo, sin asignar ni escribir a nadie:
  `{"accion":"simular","ahora":"2026-11-28T15:00:00Z","contacto":"573000000001"}`
- Marcar ausente o de vuelta a una asesora:
  `{"accion":"ausencia","asesora":"Melissa Orellano","ausente":true}`

Para cambiar el código: editar `index.js`, pasar las pruebas y volver a desplegar
(`PATCH /functions/<id>` con el código y luego `POST /functions/<id>/deploy`).

## Pruebas

```
node --test kapso/asignar-asesora/reparto.test.js
```

## Registro de clientes por WhatsApp (en construcción)

El cliente envía sus datos y documentos por WhatsApp; la función `registro-de-clientes` los lee
con IA y prepara el registro para el CRM. Necesita dos secretos en su página (Secrets):
`ANTHROPIC_API_KEY` y `KAPSO_API_KEY`. Para comprobar que están, sin verlos:
`{"accion":"probar"}` en su dirección de invocación.

Reglas acordadas:

- Obligatorios: título, certificado de notas y cédula; además correo electrónico y WhatsApp.
- Si un documento sale borroso se le dice al cliente en el momento y elige reenviarlo o
  continuar; a la asesora le queda el aviso. Basta con que sea legible.
- El soporte de pago se lee y queda pendiente: quien confirma el pago es Contabilidad, en el CRM.
