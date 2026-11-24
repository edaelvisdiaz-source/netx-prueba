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

## Sistema demo de apostillas (`crm-demo`)

Sistema mínimo para ensayar el flujo de WhatsApp mientras el CRM real no está en línea. Guarda
ventas, soportes de pago y registros en la base de datos del proyecto de Kapso (tabla
`demo_ventas`). No es el CRM: cuando exista, los agentes apuntan allá y esto se borra.

| Pieza | Identificador |
|---|---|
| Función `Sistema demo de apostillas` (privada) | `3424658c-8c01-49c4-b351-f5608bfde420` |
| Automatización `Pago y registro de clientes` (borrador) | `0aff3dc7-096e-4253-a645-6df56db9287e` |

La automatización tiene dos agentes: `pago` (modelo robusto; consulta la venta por el número de
WhatsApp, lee el soporte y lo guarda; la comparación de valores la hace la función, no el
modelo) y `registro` (modelo económico; lee título, notas y cédula y guarda el registro).
Ninguno confirma pagos: eso lo hace Contabilidad con `confirmar_pago`.

Acciones con la llave de Kapso (`POST /functions/<id>/invoke`):

- `{"accion":"crear_venta","telefono":"57300...","servicio":"...","valor":"1.250.000"}`
  (la asesora se asigna por turnos; `asesora` la fija a mano)
- `{"accion":"listar"}`, `{"accion":"ver","id":"..."}`, `{"accion":"eliminar","id":"..."}`
- `{"accion":"confirmar_pago","id":"...","confirmado":true,"nota":"..."}`

`{"accion":"cambiar_etapa","id":"...","etapa":"Radicado en el MEN"}` mueve el trámite una vez
el pago está confirmado y el registro completo. La etapa del cliente se calcula sola hasta ahí
(Pendiente de pago → Pendiente de registro → Faltan documentos → Pago por confirmar → Listo
para radicar) y luego la marca la asesora (Radicado en el MEN, Enviado, Apostillado).

### Pantalla (`crm-demo/pantalla`)

Kapso no sirve páginas desde las funciones (solo `POST`, con una política que bloquea
formularios y encabezados propios), así que la pantalla es un programa aparte para AWS Lambda
con dirección pública propia. Muestra la página, valida un único usuario y reenvía las acciones
permitidas al despliegue público del mismo código (`crm-demo-panel`,
`fee3c4ce-3ad8-4bcc-aae2-18c6e585a1be`), que exige el secreto `CLAVE_PANEL` y no acepta
llamadas de herramienta. El navegador nunca ve esa clave.

En AWS (us-east-1): función `apostillas-demo-pantalla` con dirección pública
`https://y5b7snu3g3rvlebookdtwtagiq0yjksw.lambda-url.us-east-1.on.aws/` y rol del mismo nombre,
que solo puede escribir sus propios registros. Para retirarla basta borrar esas dos piezas.

Cada venta tiene un enlace de formulario (`/f/<código de 24 caracteres>`), que es lo único que lo
protege: el cliente escribe su correo, sube cédula, título y notas y acepta los términos. Los
archivos van directo del navegador al depósito privado `apostillas-demo-documentos-146736797821`
(cifrado, sin acceso público, solo HTTPS, se borran a los 30 días) con direcciones firmadas de
diez minutos; en la plataforma se ven con direcciones de cinco minutos. Lo enviado por chat y
por formulario se suma en el mismo registro. Los documentos del formulario los lee
Claude Haiku 4.5 en Amazon Bedrock (`lectura.mjs`), con el permiso del propio programa y sin
llave, en una tarea en segundo plano que el programa se lanza a sí mismo. Para que funcione, la
cuenta de AWS debe haber enviado una vez el formulario de caso de uso de Anthropic en Bedrock.
Si la lectura falla, la venta queda marcada «Revisar a mano» y se puede repetir desde la plataforma.

Variables de la Lambda (ninguna va en el repositorio): `USUARIO`, `CLAVE_HASH` (`sal:hash`
scrypt en hexadecimal), `SECRETO_SESION`, `KAPSO_URL`, `KAPSO_CLAVE`.

Pruebas: `node --test kapso/crm-demo/pantalla/pantalla.test.mjs`

Pruebas: `node --test kapso/crm-demo/crm-demo.test.js`

## Apoyo comercial a las asesoras (`apoyo-comercial`)

Automatización `b6af1871-c9bf-437e-a902-2b2ab85fc58e`, activa en la línea de pruebas. Un solo
agente (modelo económico) que acompaña a la asesora: ella lleva la conversación y la IA
detecta soportes de pago, documentos y cotizaciones aceptadas, los registra en el sistema demo
y solo le escribe al cliente cuando es oportuno y seguro (acuses de recibo, fuera de horario,
asesora demorada más de 10 minutos, saludo a un cliente nuevo). Usa `tool_only`: el texto del
agente no le llega al cliente salvo que llame a `send_notification_to_user`. Nunca responde
sobre precios, plazos, viabilidad, estado de pagos ni reclamos. No marca los mensajes como
leídos, para no confundir a la asesora.

Límites conocidos: Kapso no tiene temporizadores, así que la demora de la asesora solo se
detecta cuando el cliente vuelve a escribir; y no hay notas internas, así que lo que la IA
encuentra se ve en la plataforma demo, no en la bandeja.

La automatización anterior `Pago y registro de clientes` (la IA atiende sola) quedó en borrador.

La tarifa oficial de apostillas para convalidación (Turbo 170, Flash 150, Express 130, Estándar
110 euros; radicación al MEN 30 euros en Express y Estándar) está en dos sitios que hay que
cambiar juntos: `TARIFAS` en `crm-demo/pantalla/pagina.mjs` y el texto del agente en
`apoyo-comercial/automatizacion.json`.
