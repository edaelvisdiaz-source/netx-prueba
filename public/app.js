'use strict';
/* Pantallas de Radika. Sin dependencias: todo el contenido se inserta como texto, nunca como HTML. */

const raiz = document.getElementById('app');
const estado = { usuario: null };

const TIPOS = {
  TUTELA: 'Tutela', PROCESO_JUDICIAL: 'Proceso judicial', CONVALIDACION_MEN: 'Convalidación (Ministerio)',
  LEGALIZACION_MEN: 'Legalización (Ministerio)', SAC_MEN: 'SAC (Ministerio)', APOSTILLA: 'Apostilla',
};
const ESTADOS = { ACTIVO: 'Activo', PAUSADO: 'Pausado', CERRADO: 'Cerrado' };
const CATEGORIAS = {
  ADMISION: ['Admisión', 'info'], FALLO: ['Fallo', 'aviso-c'], IMPUGNACION: ['Impugnación', 'aviso-c'], DESACATO: ['Desacato', 'mal'],
  REQUERIMIENTO: ['Requerimiento', 'mal'], REMISION_CORTE: ['Remisión a la Corte', 'info'], OTRA: ['Actuación', ''],
};
const NOVEDADES = {
  TRAMITE_SINCRONIZADO: 'Primera lectura', ACTUACION_NUEVA: 'Actuación nueva', TERMINO_POR_VENCER: 'Término por vencer',
  TERMINO_VENCIDO: 'Término vencido', ERROR_FUENTE: 'Problema al consultar',
};
const TERMINOS = { EN_CURSO: ['En curso', 'info'], POR_VENCER: ['Por vencer', 'aviso-c'], VENCIDO: ['Vencido', 'mal'], CUMPLIDO: ['Cumplido', 'ok'] };
const ETAPAS = {
  SIN_DATOS: ['Sin datos', ''], RADICADA: ['Radicada', 'info'], REQUERIMIENTO: ['Requerimiento', 'mal'], ADMITIDA: ['Admitida', 'info'],
  FALLO_FAVORABLE: ['Fallo a favor', 'ok'], FALLO_DESFAVORABLE: ['Fallo en contra', 'mal'], CARENCIA_OBJETO: ['Carencia de objeto', 'aviso-c'],
  FALLO_SIN_CLASIFICAR: ['Fallo por revisar', 'aviso-c'], IMPUGNADA: ['Impugnada', 'aviso-c'], DESACATO: ['Desacato', 'mal'], EN_CORTE: ['En la Corte', ''],
  CUMPLIDA: ['Cumplida', 'ok'],
};
const NIVELES = { URGENTE: ['Urgente', 'mal'], PRONTO: ['Pronto', 'aviso-c'], INFO: ['Para revisar', 'info'] };
const TRAMITES_POR_PAGINA = 50;
const ESPERA_BUSQUEDA_MS = 350;
const MOTIVOS = { SIN_RADICADO: 'No trae radicado', SIN_TRAMITE: 'El trámite no está registrado', AMBIGUO: 'Coincide con varios trámites' };

/** Crea un elemento. Los hijos de tipo texto se insertan como texto. */
function h(etiqueta, atributos, ...hijos) {
  const elemento = document.createElement(etiqueta);
  for (const [nombre, valor] of Object.entries(atributos || {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (nombre.startsWith('on')) elemento.addEventListener(nombre.slice(2), valor);
    else if (nombre === 'class') elemento.className = valor;
    else if (nombre === 'style') elemento.style.cssText = valor; // por CSSOM: la politica de contenido bloquea el atributo style
    else elemento.setAttribute(nombre, valor === true ? '' : valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    elemento.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return elemento;
}

/** Reemplaza el contenido de un elemento, omitiendo los huecos (null, false). */
function poner(elemento, ...hijos) {
  elemento.replaceChildren(...hijos.flat().filter((hijo) => hijo !== null && hijo !== undefined && hijo !== false));
}

class ErrorApi extends Error {
  constructor(mensaje, codigoHttp, detalles) {
    super(mensaje);
    this.codigoHttp = codigoHttp;
    this.detalles = detalles;
  }
}

async function api(metodo, ruta, cuerpo) {
  let respuesta;
  try {
    respuesta = await fetch(ruta, {
      method: metodo,
      credentials: 'same-origin',
      headers: { 'X-Radika': '1', ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi('No hay conexión con Radika. Revisa tu internet e intenta de nuevo.', 0);
  }
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !datos || datos.success === false) {
    const error = (datos && datos.error) || {};
    const detalle = Array.isArray(error.details) ? error.details.map((d) => `${d.campo}: ${d.mensaje}`).join('; ') : '';
    throw new ErrorApi([error.message || 'No se pudo completar la acción', detalle].filter(Boolean).join(' — '), respuesta.status, error.details);
  }
  return datos;
}

const fecha = (texto) => (texto ? new Date(texto.length === 10 ? `${texto}T12:00:00` : texto).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fechaHora = (texto) => (texto ? new Date(texto).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const chip = (texto, clase) => h('span', { class: `chip ${clase || ''}` }, texto);
const aviso = (texto, clase) => h('div', { class: `aviso ${clase || ''}`, role: clase === 'mal' ? 'alert' : 'status' }, texto);
const campo = (etiqueta, control) => {
  const id = `c${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), control);
};
const chipEtapa = (situacion) => (situacion.etapa ? chip(...(ETAPAS[situacion.etapa] || [situacion.etapa, ''])) : null);
const chipNivel = (nivel) => (nivel ? chip(...NIVELES[nivel]) : chip('Al día', 'ok'));
const nombreDe = (tramite, situacion) => situacion.tutelante || tramite.clienteNombre || 'Sin nombre registrado';
const irA = (destino) => ({ class: 'clic', tabindex: 0, onclick: () => (location.hash = destino), onkeydown: (e) => e.key === 'Enter' && (location.hash = destino) });
const opciones = (mapa, elegido, vacio) => [
  vacio ? h('option', { value: '' }, vacio) : null,
  ...Object.entries(mapa).map(([valor, texto]) => h('option', { value: valor, selected: valor === elegido }, Array.isArray(texto) ? texto[0] : texto)),
];

/** Ejecuta una acción de un formulario o botón mostrando el error junto a él y evitando el doble clic. */
async function conBoton(boton, zonaMensaje, accion) {
  boton.disabled = true;
  zonaMensaje.replaceChildren();
  try {
    await accion();
  } catch (error) {
    if (error.codigoHttp === 401 && estado.usuario) return salirLocal();
    zonaMensaje.replaceChildren(aviso(error.message, 'mal'));
  } finally {
    boton.disabled = false;
  }
}

function salirLocal() {
  estado.usuario = null;
  location.hash = '#/ingreso';
  pintar();
}

// ---------------------------------------------------------------- pantallas

function pantallaIngreso() {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const clave = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const mensaje = h('div');
  const boton = h('button', { type: 'submit' }, 'Entrar');
  const formulario = h('form', {
    onsubmit: (evento) => {
      evento.preventDefault();
      conBoton(boton, mensaje, async () => {
        estado.usuario = (await api('POST', '/v1/sesion', { email: email.value, clave: clave.value })).data.usuario;
        location.hash = '#/inicio';
        pintar();
      });
    },
  }, campo('Correo', email), campo('Clave', clave), mensaje, boton);
  return h('main', { class: 'ingreso' }, h('div', { class: 'logo' }, 'Radika'), h('p', { class: 'tenue' }, 'Seguimiento de trámites'), h('div', { class: 'tarjeta' }, formulario));
}

function pantallaCambioClave(obligatorio) {
  const actual = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const nueva = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 10 });
  const repetir = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 10 });
  const mensaje = h('div');
  const boton = h('button', { type: 'submit' }, 'Guardar clave');
  const formulario = h('form', {
    onsubmit: (evento) => {
      evento.preventDefault();
      conBoton(boton, mensaje, async () => {
        if (nueva.value !== repetir.value) throw new ErrorApi('Las dos claves nuevas no coinciden');
        await api('PUT', '/v1/sesion/clave', { actual: actual.value, nueva: nueva.value });
        estado.usuario = { ...estado.usuario, debeCambiarClave: false };
        location.hash = '#/inicio';
        pintar();
      });
    },
  }, campo(obligatorio ? 'Clave temporal' : 'Clave actual', actual), campo('Clave nueva (mínimo 10 caracteres)', nueva), campo('Repite la clave nueva', repetir), mensaje, boton);
  return h('main', { class: 'ingreso' }, h('h1', {}, obligatorio ? 'Elige tu clave' : 'Cambiar clave'),
    obligatorio ? h('p', { class: 'tenue' }, 'Entraste con una clave temporal. Cámbiala por una que solo tú conozcas.') : null,
    h('div', { class: 'tarjeta' }, formulario));
}

async function pantallaInicio() {
  const cuerpo = h('div', {}, h('p', { class: 'cargando' }, 'Cargando…'));
  const cifra = (numero, texto, clase) => h('div', { class: `tarjeta cifra ${clase || ''}` }, h('div', { class: 'numero' }, numero), h('div', { class: 'tenue' }, texto));
  api('GET', '/v1/panel').then(({ data }) => {
    const maximo = Math.max(1, ...data.porEtapa.map((e) => e.cantidad));
    poner(cuerpo,
      data.incompleto ? aviso('Hay más trámites activos de los que este tablero analiza. Cierra los que ya terminaron para ver todas las alertas.', 'mal') : null,
      h('div', { class: 'rejilla cifras' }, cifra(data.totales.activos, 'Trámites activos'), cifra(data.totales.urgentes, 'Urgentes', data.totales.urgentes ? 'mal' : ''),
        cifra(data.totales.pronto, 'Para atender pronto', data.totales.pronto ? 'aviso-c' : ''), cifra(data.totales.alDia, 'Al día', 'ok')),
      h('div', { class: 'tarjeta' }, h('h2', {}, `Requiere atención (${data.atencion.length})`),
        data.atencion.length === 0 ? h('p', { class: 'vacio' }, 'Nada pendiente: todos los trámites activos están al día.')
          : data.atencion.map((a) => h('div', { ...irA(`#/tramites/${a.tramiteId}`), class: `clic alerta ${NIVELES[a.nivel][1]}`, role: 'link' },
            h('div', { class: 'fila entre' }, h('strong', {}, a.tutelante || 'Sin nombre registrado'), h('span', { class: 'fila' }, a.etapa ? chip(...ETAPAS[a.etapa]) : null, chipNivel(a.nivel))),
            h('div', {}, a.motivo),
            a.recomendacion ? h('div', { class: 'tenue' }, a.recomendacion) : null,
            h('div', { class: 'mono tenue' }, `${a.radicado}${a.despacho ? ` · ${a.despacho}` : ''}`)))),
      h('div', { class: 'rejilla dos' },
        h('div', { class: 'tarjeta' }, h('h2', {}, 'Próximos vencimientos'),
          data.vencimientos.length === 0 ? h('p', { class: 'vacio' }, 'No hay plazos corriendo.')
            : h('table', {}, h('tbody', {}, data.vencimientos.map((v) => h('tr', irA(`#/tramites/${v.tramiteId}`),
              h('td', {}, h('strong', {}, fecha(v.fechaLimite))), h('td', {}, v.tutelante || v.radicado, h('div', { class: 'tenue' }, v.etapa ? ETAPAS[v.etapa][0] : ''))))))),
        h('div', { class: 'tarjeta' }, h('h2', {}, 'Tutelas por etapa'),
          data.porEtapa.length === 0 ? h('p', { class: 'vacio' }, 'Aún no hay tutelas activas.')
            : data.porEtapa.map((e) => h('div', { class: 'barra-etapa' }, h('div', { class: 'fila entre' }, h('span', {}, ETAPAS[e.etapa][0]), h('strong', {}, e.cantidad)),
              h('div', { class: 'pista' }, h('div', { class: 'relleno', style: `width:${Math.round((e.cantidad / maximo) * 100)}%` })))))));
  }).catch((error) => (error.codigoHttp === 401 ? salirLocal() : poner(cuerpo, aviso(error.message, 'mal'))));
  return h('main', {}, h('div', { class: 'fila entre' }, h('div', {}, h('h1', {}, 'Inicio'), h('p', { class: 'tenue' }, 'Lo que necesita tu atención hoy. Los plazos son estimados: se cuentan desde las fechas que publica el juzgado.')),
    h('button', { onclick: () => (location.hash = '#/nuevo') }, 'Nuevo trámite')), cuerpo);
}

async function pantallaTramites() {
  const filtros = { buscar: h('input', { type: 'search', placeholder: 'Nombre, radicado, entidad o código' }), tipo: h('select', {}, opciones(TIPOS, '', 'Todos los tipos')), estado: h('select', {}, opciones(ESTADOS, 'ACTIVO', 'Todos los estados')) };
  const lista = h('div', { class: 'tarjeta' });
  let pagina = 1;
  let pedido = 0;
  const cargar = async () => {
    const turno = ++pedido;
    const consulta = new URLSearchParams({ limit: String(TRAMITES_POR_PAGINA), page: String(pagina) });
    if (filtros.tipo.value) consulta.set('tipo', filtros.tipo.value);
    if (filtros.estado.value) consulta.set('estado', filtros.estado.value);
    if (filtros.buscar.value.trim().length >= 2) consulta.set('q', filtros.buscar.value.trim());
    lista.replaceChildren(h('p', { class: 'cargando' }, 'Cargando…'));
    try {
      const { data, meta } = await api('GET', `/v1/tramites?${consulta}`);
      if (turno !== pedido) return; // llegó una búsqueda más nueva
      if (data.length === 0) return lista.replaceChildren(h('p', { class: 'vacio' }, 'No hay trámites con esos filtros. Usa «Nuevo trámite» para registrar uno.'));
      const paginas = Math.ceil(meta.total / TRAMITES_POR_PAGINA);
      const cambiar = (delta) => () => { pagina += delta; cargar(); };
      poner(lista,
        h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Tutelante / cliente'), h('th', {}, 'Etapa'), h('th', { class: 'ocultar-movil' }, 'Último movimiento'), h('th', {}, 'Atención'))),
          h('tbody', {}, data.map((t) => {
            const s = t.situacion;
            return h('tr', irA(`#/tramites/${t.id}`),
              h('td', {}, h('strong', {}, nombreDe(t, s)), h('div', { class: 'mono tenue' }, t.radicado), h('div', { class: 'tenue' }, [TIPOS[t.tipo], t.despacho].filter(Boolean).join(' · '))),
              h('td', {}, chipEtapa(s) || chip(ESTADOS[t.estado], ''), s.esManual ? h('div', { class: 'tenue' }, 'Fijada a mano') : null, t.estado !== 'ACTIVO' ? h('div', { class: 'tenue' }, ESTADOS[t.estado]) : null),
              h('td', { class: 'ocultar-movil' }, s.ultimaNovedad ? [h('div', {}, s.ultimaNovedad.titulo), h('div', { class: 'tenue' }, [fecha(s.ultimaNovedad.fecha), s.ultimaNovedad.anotacion].filter(Boolean).join(' · '))] : h('span', { class: 'tenue' }, 'Sin movimientos')),
              h('td', {}, t.estado === 'ACTIVO' ? chipNivel(s.nivel) : h('span', { class: 'tenue' }, '—'), s.atencion[0] ? h('div', { class: 'tenue' }, s.atencion[0].motivo) : null));
          }))),
        h('div', { class: 'fila entre' }, h('p', { class: 'tenue' }, `${meta.total} trámite(s)${paginas > 1 ? ` · página ${pagina} de ${paginas}` : ''}`),
          paginas > 1 ? h('div', { class: 'fila' }, h('button', { class: 'secundario', type: 'button', disabled: pagina <= 1, onclick: cambiar(-1) }, 'Anterior'), h('button', { class: 'secundario', type: 'button', disabled: pagina >= paginas, onclick: cambiar(1) }, 'Siguiente')) : null));
    } catch (error) {
      if (error.codigoHttp === 401) return salirLocal();
      lista.replaceChildren(aviso(error.message, 'mal'));
    }
  };
  const desdeElInicio = () => { pagina = 1; cargar(); };
  let espera;
  filtros.buscar.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(desdeElInicio, ESPERA_BUSQUEDA_MS); });
  filtros.tipo.addEventListener('change', desdeElInicio);
  filtros.estado.addEventListener('change', desdeElInicio);
  cargar();
  return h('main', {}, h('div', { class: 'fila entre' }, h('h1', {}, 'Trámites'), h('button', { onclick: () => (location.hash = '#/nuevo') }, 'Nuevo trámite')),
    h('div', { class: 'tarjeta rejilla' }, campo('Buscar', filtros.buscar), campo('Tipo', filtros.tipo), campo('Estado', filtros.estado)), lista);
}

function pantallaNuevo() {
  const tipo = h('select', {}, opciones(TIPOS, 'TUTELA'));
  const radicado = h('input', { required: true, maxlength: 80 });
  const cliente = h('input', { maxlength: 160 });
  const referencia = h('input', { maxlength: 64 });
  const ayuda = h('p', { class: 'tenue' });
  const actualizarAyuda = () => (ayuda.textContent = ['TUTELA', 'PROCESO_JUDICIAL'].includes(tipo.value)
    ? 'Escribe los 23 dígitos del radicado (con o sin guiones). Radika lo revisará sola en la Rama Judicial.'
    : 'Este tipo se lleva por seguimiento manual: tú registras cada cambio que veas en la plataforma.');
  tipo.addEventListener('change', actualizarAyuda);
  actualizarAyuda();
  const mensaje = h('div');
  const boton = h('button', { type: 'submit' }, 'Registrar');
  return h('main', {}, h('h1', {}, 'Nuevo trámite'), h('div', { class: 'tarjeta' }, h('form', {
    onsubmit: (evento) => {
      evento.preventDefault();
      conBoton(boton, mensaje, async () => {
        const cuerpo = { tipo: tipo.value, radicado: radicado.value };
        if (cliente.value.trim()) cuerpo.clienteNombre = cliente.value.trim();
        if (referencia.value.trim()) cuerpo.referenciaCrm = referencia.value.trim();
        const creado = (await api('POST', '/v1/tramites', cuerpo)).data;
        if (creado.fuente !== 'MANUAL') await api('POST', `/v1/tramites/${creado.id}/revisar`).catch(() => null);
        location.hash = `#/tramites/${creado.id}`;
      });
    },
  }, h('div', { class: 'rejilla' }, campo('Tipo de trámite', tipo), campo('Radicado', radicado), campo('Cliente (opcional)', cliente), campo('Código de la venta (opcional)', referencia)), ayuda, mensaje,
    h('div', { class: 'fila' }, boton, h('button', { type: 'button', class: 'secundario', onclick: () => history.back() }, 'Cancelar')))));
}

async function pantallaDetalle(id) {
  const contenedor = h('main', {}, h('p', { class: 'cargando' }, 'Cargando…'));
  const cargar = async () => {
    let d;
    try {
      d = (await api('GET', `/v1/tramites/${id}`)).data;
    } catch (error) {
      if (error.codigoHttp === 401) return salirLocal();
      return contenedor.replaceChildren(aviso(error.message, 'mal'), h('a', { href: '#/tramites' }, 'Volver a la lista'));
    }
    const t = d.tramite;
    const s = d.situacion;
    const mensaje = h('div');
    const guardar = (cambios) => api('PATCH', `/v1/tramites/${id}`, cambios);
    const etapa = h('select', {}, h('option', { value: '' }, s.etapaAutomatica ? `Automática (Radika detecta: ${ETAPAS[s.etapaAutomatica][0]})` : 'Sin etapa'), opciones(ETAPAS, s.esManual ? s.etapa : ''));
    etapa.addEventListener('change', () => conBoton(etapa, mensaje, async () => { await guardar({ etapaManual: etapa.value || null }); await cargar(); }));
    const nombre = h('input', { maxlength: 160, value: t.clienteNombre || '', placeholder: s.tutelante || '' });
    const codigo = h('input', { maxlength: 64, value: t.referenciaCrm || '' });
    const nota = h('textarea', { maxlength: 1000, placeholder: 'Por ejemplo: la clienta confirmó que ya recibió la resolución' }, t.nota || '');
    const botonDatos = h('button', { type: 'submit', class: 'secundario' }, 'Guardar');
    const mensajeDatos = h('div');
    const accion = (texto, clase, hacer) => {
      const boton = h('button', { type: 'button', class: clase }, texto);
      boton.addEventListener('click', () => conBoton(boton, mensaje, async () => { await hacer(); await cargar(); }));
      return boton;
    };
    const fechaActuacion = h('input', { type: 'date', required: true, value: new Date().toISOString().slice(0, 10) });
    const tituloActuacion = h('input', { required: true, maxlength: 200, placeholder: 'Por ejemplo: Requerimiento de documentos' });
    const notaActuacion = h('textarea', { maxlength: 2000 });
    const botonActuacion = h('button', { type: 'submit' }, 'Registrar');
    const mensajeActuacion = h('div');

    poner(contenedor,
      h('p', {}, h('a', { href: '#/tramites' }, '← Trámites')),
      h('div', { class: 'fila entre' }, h('div', {}, h('h1', {}, nombreDe(t, s)), h('div', { class: 'tenue' }, `${TIPOS[t.tipo] || t.tipo} · `, h('span', { class: 'mono' }, t.radicado))),
        h('span', { class: 'fila' }, chipEtapa(s), chip(ESTADOS[t.estado], t.estado === 'ACTIVO' ? 'ok' : ''))),
      t.ultimoError ? aviso(`Última revisión: ${t.ultimoError}`, 'mal') : null,
      mensaje,
      h('div', { class: 'tarjeta' }, h('h2', {}, 'En qué va'),
        h('p', { class: 'nota-estado' }, s.nota),
        s.ultimaNovedad && s.ultimaNovedad.anotacion ? h('p', { class: 'tenue' }, `${fecha(s.ultimaNovedad.fecha)} · ${s.ultimaNovedad.anotacion}`) : null,
        s.atencion.map((a) => h('div', { class: `alerta ${NIVELES[a.nivel][1]}` }, h('span', { class: 'fila' }, chipNivel(a.nivel), a.motivo))),
        s.recomendacion ? h('div', { class: 'recomendacion' }, h('strong', {}, 'Qué conviene hacer'), h('div', {}, s.recomendacion),
          h('div', { class: 'tenue' }, 'Orientación general según la etapa. Confírmala leyendo la providencia; los plazos reales corren desde la notificación.')) : null,
        t.tipo === 'TUTELA' ? h('div', { class: 'acciones' }, campo('Etapa del caso', etapa),
          h('p', { class: 'tenue' }, s.esManual ? 'Etapa fijada a mano: Radika no la cambiará sola, pero te avisará si llega una novedad distinta. Elige «Automática» para devolverle el control.' : 'Radika la actualiza sola con cada actuación. Puedes fijar otra si conoces algo que la consulta no muestra.')) : null),
      h('div', { class: 'tarjeta' }, h('dl', {},
        h('dt', {}, 'Tutelante'), h('dd', {}, s.tutelante || '—'),
        h('dt', {}, 'Accionado'), h('dd', {}, s.accionado || '—'),
        h('dt', {}, 'Despacho'), h('dd', {}, t.despacho || '—'),
        h('dt', {}, 'Radicado el'), h('dd', {}, fecha(t.fechaRadicacion)),
        h('dt', {}, 'Seguimiento'), h('dd', {}, t.fuente === 'MANUAL' ? 'Manual' : `Automático · última revisión ${fechaHora(t.ultimaRevisionAt)}`)),
        h('div', { class: 'fila acciones' },
          t.fuente !== 'MANUAL' && t.estado === 'ACTIVO' ? accion('Revisar ahora', '', () => api('POST', `/v1/tramites/${id}/revisar`)) : null,
          t.estado === 'ACTIVO' ? accion('Pausar', 'secundario', () => api('PATCH', `/v1/tramites/${id}`, { estado: 'PAUSADO' })) : null,
          t.estado !== 'ACTIVO' ? accion('Reactivar', 'secundario', () => api('PATCH', `/v1/tramites/${id}`, { estado: 'ACTIVO' })) : null,
          t.estado !== 'CERRADO' ? accion('Cerrar trámite', 'peligro', () => (confirm('¿Cerrar este trámite? Dejará de revisarse.') ? api('PATCH', `/v1/tramites/${id}`, { estado: 'CERRADO' }) : null)) : null)),
      h('div', { class: 'tarjeta' }, h('h2', {}, 'Datos del cliente y nota'), h('form', {
        onsubmit: (evento) => {
          evento.preventDefault();
          conBoton(botonDatos, mensajeDatos, async () => {
            await guardar({ clienteNombre: nombre.value.trim() || null, referenciaCrm: codigo.value.trim() || null, nota: nota.value.trim() || null });
            await cargar();
          });
        },
      }, h('div', { class: 'rejilla' }, campo('Nombre del cliente', nombre), campo('Código de la venta', codigo)), campo('Nota del asesor', nota), mensajeDatos, botonDatos)),
      d.terminos.length ? h('div', { class: 'tarjeta' }, h('h2', {}, 'Términos (estimados)'), d.terminos.map((termino) => h('div', { class: 'fila entre termino' },
        h('div', {}, termino.descripcion, h('div', { class: 'tenue' }, `Límite: ${fecha(termino.fechaLimite)} · ${termino.diasHabilesRestantes >= 0 ? `faltan ${termino.diasHabilesRestantes} día(s) hábil(es)` : `venció hace ${-termino.diasHabilesRestantes} día(s) hábil(es)`}`)),
        chip(...TERMINOS[termino.estado])))) : null,
      d.enlacesConsulta.length ? h('div', { class: 'tarjeta' }, h('h2', {}, 'Consultar en la fuente oficial'), d.enlacesConsulta.map((enlace) => h('p', {}, h('a', { href: enlace.url, target: '_blank', rel: 'noopener noreferrer' }, enlace.nombre), h('span', { class: 'tenue' }, ` — ${enlace.nota}`)))) : null,
      h('div', { class: 'tarjeta' }, h('h2', {}, `Actuaciones (${d.actuaciones.length})`),
        d.actuaciones.length === 0 ? h('p', { class: 'vacio' }, t.fuente === 'MANUAL' ? 'Aún no hay actuaciones. Registra la primera abajo.' : 'Aún no hay actuaciones. Si el trámite es reciente, la fuente puede tardar unos días en mostrarlo.')
          : d.actuaciones.map((a) => h('div', { class: 'linea' }, h('div', { class: 'fecha' }, fecha(a.fecha), a.despacho ? ` · ${a.despacho}` : ''),
            h('div', { class: 'titulo' }, a.titulo, ' ', chip(...(CATEGORIAS[a.categoria] || CATEGORIAS.OTRA))),
            a.anotacion ? h('div', { class: 'tenue' }, a.anotacion) : null,
            a.resumen ? h('div', { class: 'resumen' }, h('div', {}, a.resumen.resumen), h('div', { class: 'tenue' }, `Qué hacer: ${a.resumen.accionSugerida}`)) : null))),
      h('div', { class: 'tarjeta' }, h('h2', {}, 'Registrar una actuación a mano'), h('form', {
        onsubmit: (evento) => {
          evento.preventDefault();
          conBoton(botonActuacion, mensajeActuacion, async () => {
            const cuerpo = { fecha: fechaActuacion.value, titulo: tituloActuacion.value };
            if (notaActuacion.value.trim()) cuerpo.anotacion = notaActuacion.value.trim();
            await api('POST', `/v1/tramites/${id}/actuaciones`, cuerpo);
            await cargar();
          });
        },
      }, h('div', { class: 'rejilla' }, campo('Fecha', fechaActuacion), campo('Qué pasó', tituloActuacion)), campo('Detalle (opcional)', notaActuacion), mensajeActuacion, botonActuacion)));
  };
  cargar();
  return contenedor;
}

async function pantallaNovedades() {
  const lista = h('div', { class: 'tarjeta' }, h('p', { class: 'cargando' }, 'Cargando…'));
  api('GET', '/v1/novedades').then(({ data }) => {
    if (data.length === 0) return lista.replaceChildren(h('p', { class: 'vacio' }, 'Todavía no hay novedades.'));
    lista.replaceChildren(...data.map((n) => {
      const tramite = n.payload.tramite || {};
      const datos = n.payload.datos || {};
      const texto = datos.notaSugerida || (datos.termino && `${datos.termino.descripcion} — límite ${fecha(datos.termino.fechaLimite)}`) || datos.mensaje || (datos.estado && `Estado: ${datos.estado}`) || (datos.actuaciones !== undefined && `${datos.actuaciones} actuación(es) encontradas`) || '';
      return h('div', { class: 'linea' }, h('div', { class: 'fecha' }, fechaHora(n.createdAt)),
        h('div', { class: 'titulo' }, chip(NOVEDADES[n.tipo] || n.tipo, n.tipo === 'ERROR_FUENTE' || n.tipo === 'TERMINO_VENCIDO' ? 'mal' : n.tipo === 'TERMINO_POR_VENCER' ? 'aviso-c' : 'info'), ' ',
          h('a', { href: `#/tramites/${tramite.id}` }, `${TIPOS[tramite.tipo] || 'Trámite'} ${tramite.clienteNombre ? `· ${tramite.clienteNombre}` : ''}`)),
        h('div', { class: 'tenue mono' }, tramite.radicado || ''), texto ? h('div', {}, texto) : null);
    }));
  }).catch((error) => (error.codigoHttp === 401 ? salirLocal() : lista.replaceChildren(aviso(error.message, 'mal'))));
  return h('main', {}, h('h1', {}, 'Novedades'), h('p', { class: 'tenue' }, 'Lo último que Radika detectó, de lo más reciente a lo más antiguo.'), lista);
}

async function pantallaCorreos() {
  const lista = h('div', { class: 'tarjeta' }, h('p', { class: 'cargando' }, 'Cargando…'));
  const cargar = () => api('GET', '/v1/correos/pendientes').then(({ data }) => {
    if (data.length === 0) return lista.replaceChildren(h('p', { class: 'vacio' }, 'No hay correos de juzgados sin asociar.'));
    lista.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Correo'), h('th', {}, 'Por qué quedó pendiente'), h('th', {}, ''))),
      h('tbody', {}, data.map((c) => {
        const boton = h('button', { class: 'secundario', type: 'button' }, 'Ya lo revisé');
        const mensaje = h('div');
        boton.addEventListener('click', () => conBoton(boton, mensaje, async () => { await api('DELETE', `/v1/correos/pendientes/${c.id}`); cargar(); }));
        return h('tr', {}, h('td', {}, h('div', {}, c.asunto), h('div', { class: 'tenue' }, `${c.remitenteNombre || c.remitente} · ${fechaHora(c.fecha)}`)), h('td', {}, MOTIVOS[c.motivo] || c.motivo), h('td', {}, boton, mensaje));
      }))));
  }).catch((error) => (error.codigoHttp === 401 ? salirLocal() : lista.replaceChildren(aviso(error.message, 'mal'))));
  cargar();
  return h('main', {}, h('h1', {}, 'Correos sin asociar'), h('p', { class: 'tenue' }, 'Correos de juzgados que Radika no pudo enlazar con un trámite. Casi siempre falta registrar la tutela.'), lista);
}

async function pantallaUsuarios() {
  const lista = h('div', { class: 'tarjeta' });
  const resultado = h('div');
  const cargar = () => api('GET', '/v1/usuarios').then(({ data }) => {
    lista.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Persona'), h('th', {}, 'Rol'), h('th', {}, 'Estado'), h('th', {}, ''))),
      h('tbody', {}, data.map((u) => {
        const mensaje = h('div');
        const boton = (texto, cambios) => {
          const b = h('button', { class: 'secundario', type: 'button' }, texto);
          b.addEventListener('click', () => conBoton(b, mensaje, async () => {
            const r = (await api('PATCH', `/v1/usuarios/${u.id}`, cambios)).data;
            if (r.claveTemporal) mostrarClave(r.usuario.email, r.claveTemporal);
            cargar();
          }));
          return b;
        };
        const esYo = u.id === estado.usuario.id;
        return h('tr', {}, h('td', {}, h('div', {}, u.nombre), h('div', { class: 'tenue' }, u.email)), h('td', {}, u.rol === 'ADMIN' ? 'Administrador' : 'Asesor'),
          h('td', {}, u.activo ? chip(u.debeCambiarClave ? 'Clave temporal' : 'Activo', u.debeCambiarClave ? 'aviso-c' : 'ok') : chip('Desactivado', 'mal')),
          h('td', {}, h('div', { class: 'fila' }, boton('Nueva clave temporal', { nuevaClave: true }), esYo ? null : boton(u.activo ? 'Desactivar' : 'Activar', { activo: !u.activo })), mensaje));
      }))));
  }).catch((error) => (error.codigoHttp === 401 ? salirLocal() : lista.replaceChildren(aviso(error.message, 'mal'))));
  const mostrarClave = (email, clave) => resultado.replaceChildren(h('div', { class: 'aviso ok', role: 'status' }, `Clave temporal de ${email}: `, h('strong', { class: 'mono' }, clave), '. Entrégasela a la persona; solo se muestra esta vez y tendrá que cambiarla al entrar.'));
  const email = h('input', { type: 'email', required: true });
  const nombre = h('input', { required: true, minlength: 2, maxlength: 120 });
  const rol = h('select', {}, h('option', { value: 'ASESOR' }, 'Asesor'), h('option', { value: 'ADMIN' }, 'Administrador'));
  const mensaje = h('div');
  const botonCrear = h('button', { type: 'submit' }, 'Crear usuario');
  cargar();
  return h('main', {}, h('h1', {}, 'Usuarios'), resultado, lista, h('div', { class: 'tarjeta' }, h('h2', {}, 'Agregar una persona'), h('form', {
    onsubmit: (evento) => {
      evento.preventDefault();
      conBoton(botonCrear, mensaje, async () => {
        const creado = (await api('POST', '/v1/usuarios', { email: email.value, nombre: nombre.value, rol: rol.value })).data;
        mostrarClave(creado.usuario.email, creado.claveTemporal);
        email.value = ''; nombre.value = '';
        cargar();
      });
    },
  }, h('div', { class: 'rejilla' }, campo('Correo', email), campo('Nombre', nombre), campo('Rol', rol)), mensaje, botonCrear)));
}

// ------------------------------------------------------------------ armazón

function barra(ruta) {
  const enlace = (destino, texto) => h('a', { href: destino, class: ruta.startsWith(destino.slice(1)) ? 'activa' : '' }, texto);
  const salir = h('button', { class: 'enlace', type: 'button' }, 'Salir');
  salir.addEventListener('click', async () => { await api('DELETE', '/v1/sesion').catch(() => null); salirLocal(); });
  return h('nav', { class: 'barra', 'aria-label': 'Principal' }, h('span', { class: 'logo' }, 'Radika'), enlace('#/inicio', 'Inicio'), enlace('#/tramites', 'Trámites'), enlace('#/novedades', 'Novedades'), enlace('#/correos', 'Correos'),
    estado.usuario.rol === 'ADMIN' ? enlace('#/usuarios', 'Usuarios') : null,
    h('span', { class: 'quien' }, estado.usuario.nombre, h('a', { href: '#/clave' }, 'Cambiar clave'), salir));
}

async function pintar() {
  const ruta = location.hash.slice(1) || '/inicio';
  if (!estado.usuario) return raiz.replaceChildren(pantallaIngreso());
  if (estado.usuario.debeCambiarClave) return raiz.replaceChildren(pantallaCambioClave(true));
  const detalle = ruta.match(/^\/tramites\/([0-9a-f-]{36})$/);
  const pantalla = detalle ? pantallaDetalle(detalle[1])
    : ruta === '/nuevo' ? pantallaNuevo()
    : ruta === '/novedades' ? pantallaNovedades()
    : ruta === '/correos' ? pantallaCorreos()
    : ruta === '/clave' ? pantallaCambioClave(false)
    : ruta === '/usuarios' && estado.usuario.rol === 'ADMIN' ? pantallaUsuarios()
    : ruta.startsWith('/tramites') ? pantallaTramites()
    : pantallaInicio();
  raiz.replaceChildren(barra(ruta), await pantalla);
}

window.addEventListener('hashchange', pintar);
api('GET', '/v1/sesion').then(({ data }) => { estado.usuario = data.usuario; }).catch(() => { estado.usuario = null; }).finally(pintar);
