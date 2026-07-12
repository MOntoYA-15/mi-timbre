// ══════════════════════════════════════════════
//  FIREBASE CONFIG
//  (usado también por users.js)
// ══════════════════════════════════════════════
const firebaseConfig = {
    apiKey:      "AIzaSyAbTb-cXeJmmPprRaVTqSyBiEyoEGv93f0",
    authDomain:  "sistematimbre.firebaseapp.com",
    databaseURL: "https://sistematimbre-default-rtdb.firebaseio.com",
    projectId:   "sistematimbre"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.database();

let estadoMaestro = true;
let hbTimer = null;

// Datos de sesión actual
let currentUID   = null;
let currentEmail = null;
let currentRol   = null; // "admin" | "usuario"

// Cachés en memoria
let horariosCache = [];
let registroCache = [];
let registroLimite = 80;

// ══════════════════════════════════════════════
//  NAVEGACIÓN POR PESTAÑAS
// ══════════════════════════════════════════════
function mostrarTab(nombre) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const tab = document.getElementById('tab-' + nombre);
    const btn = document.querySelector(`.nav-btn[data-tab="${nombre}"]`);
    if (tab) tab.classList.add('active');
    if (btn) btn.classList.add('active');
}

// ══════════════════════════════════════════════
//  MODAL DE CONFIRMACIÓN (reemplaza confirm() nativo)
// ══════════════════════════════════════════════
let modalCallback = null;

function confirmar(mensaje, callback) {
    document.getElementById('modal-mensaje').textContent = mensaje;
    modalCallback = callback;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function cerrarModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    modalCallback = null;
}

document.getElementById('modal-confirmar-btn').addEventListener('click', () => {
    const cb = modalCallback;
    cerrarModal();
    if (cb) cb();
});

// ── Reloj local ──────────────────────────────
function actualizarReloj() {
    const ahora = new Date();
    const pad = n => String(n).padStart(2, '0');
    document.getElementById('hora-local').textContent =
        `${pad(ahora.getHours())}:${pad(ahora.getMinutes())}:${pad(ahora.getSeconds())}`;
}
setInterval(actualizarReloj, 1000);
actualizarReloj();

// ── Sincronización automática de hora (cada 24h) ─
function programarSyncHora() {
    const ahora = new Date();
    const mañana = new Date(ahora);
    mañana.setDate(mañana.getDate() + 1);
    mañana.setHours(0, 0, 30, 0);
    const msHastaMedianoche = mañana - ahora;

    setTimeout(() => {
        subirTimestampHora();
        setInterval(subirTimestampHora, 24 * 60 * 60 * 1000);
    }, msHastaMedianoche);
}

function subirTimestampHora() {
    db.ref('hora_unix_ms').set(Date.now()).catch(e => console.error('Error subiendo hora:', e));
}

// ══════════════════════════════════════════════
//  REGISTRO DE ACTIVIDAD (bitácora)
// ══════════════════════════════════════════════
function registrarAccion(accion, detalle = '') {
    if (!currentUID) return;
    db.ref('registro').push({
        uid: currentUID,
        email: currentEmail,
        accion,
        detalle,
        timestamp: Date.now()
    }).catch(e => console.error('Error registrando acción:', e));
}

const ETIQUETAS_ACCION = {
    inicio_sesion: 'inició sesión',
    cierre_sesion: 'cerró sesión',
    horario_agregado: 'agregó un horario',
    horario_editado: 'editó un horario',
    horario_eliminado: 'eliminó un horario',
    horarios_importados: 'importó horarios',
    toque_manual: 'lanzó un toque manual',
    estado_maestro: 'cambió el estado del sistema',
    sincronizacion_completa: 'sincronizó todo',
    hora_actualizada: 'actualizó la hora del ESP32',
    wifi_configurado: 'configuró el WiFi por Bluetooth',
    usuario_creado: 'creó un usuario',
    rol_cambiado: 'cambió un rol',
    usuario_activado: 'activó un usuario',
    usuario_desactivado: 'desactivó un usuario',
    password_reset_enviado: 'envió un reseteo de contraseña',
    respaldo_descargado: 'descargó un respaldo'
};

function renderRegistro() {
    db.ref('registro').limitToLast(registroLimite).on('value', snap => {
        registroCache = [];
        snap.forEach(child => registroCache.push(child.val()));
        registroCache.reverse();
        actualizarFiltroUsuarios();
        pintarRegistro();
    });
}

function cargarMasRegistro() {
    registroLimite += 80;
    db.ref('registro').off('value');
    renderRegistro();
    setStatus('Cargando más registros...', 'busy');
}

function actualizarFiltroUsuarios() {
    const sel = document.getElementById('filtro-usuario');
    if (!sel) return;
    const valorActual = sel.value;
    const correos = [...new Set(registroCache.map(r => r.email).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">Todos los usuarios</option>' +
        correos.map(c => `<option value="${c}">${c}</option>`).join('');
    sel.value = valorActual;
}

function pintarRegistro() {
    const cont = document.getElementById('lista-registro');
    if (!cont) return;

    const filtroAccion = document.getElementById('filtro-accion')?.value || '';
    const filtroUsuario = document.getElementById('filtro-usuario')?.value || '';
    const desde = document.getElementById('filtro-desde')?.value || '';
    const hasta = document.getElementById('filtro-hasta')?.value || '';

    const desdeTs = desde ? new Date(desde + 'T00:00:00').getTime() : null;
    const hastaTs = hasta ? new Date(hasta + 'T23:59:59').getTime() : null;

    const filtrados = registroCache.filter(r => {
        if (filtroAccion && r.accion !== filtroAccion) return false;
        if (filtroUsuario && r.email !== filtroUsuario) return false;
        if (desdeTs && r.timestamp < desdeTs) return false;
        if (hastaTs && r.timestamp > hastaTs) return false;
        return true;
    });

    document.getElementById('contador-registro').textContent = filtrados.length;
    cont.innerHTML = '';

    if (filtrados.length === 0) {
        cont.innerHTML = '<div class="no-toques">Sin resultados</div>';
        return;
    }

    filtrados.forEach(r => {
        const fecha = new Date(r.timestamp);
        const ts = fecha.toLocaleString('es-SV', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const etiqueta = ETIQUETAS_ACCION[r.accion] || r.accion;
        const div = document.createElement('div');
        div.className = 'registro-item';
        div.innerHTML = `<span class="ts">${ts}</span><b>${r.email || 'desconocido'}</b> ${etiqueta}${r.detalle ? ' — ' + r.detalle : ''}`;
        cont.appendChild(div);
    });
}

function exportarRegistroCSV() {
    if (registroCache.length === 0) { setStatus('No hay registro para exportar', 'err'); return; }
    const filas = [['Fecha', 'Correo', 'Accion', 'Detalle']];
    registroCache.forEach(r => {
        filas.push([
            new Date(r.timestamp).toLocaleString('es-SV'),
            r.email || '',
            r.accion || '',
            r.detalle || ''
        ]);
    });
    descargarCSV(filas, `registro_timbre_${Date.now()}.csv`);
    setStatus('CSV descargado ✓', 'ok');
}

function descargarCSV(filas, nombreArchivo) {
    const csv = filas.map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    a.click();
    URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════
auth.onAuthStateChanged(user => {
    if (user) {
        db.ref('usuarios/' + user.uid).once('value').then(snap => {
            const perfil = snap.val();

            if (!perfil) {
                document.getElementById('error-msg').textContent =
                    'Tu cuenta no está registrada en el sistema. Contacta a un administrador.';
                auth.signOut();
                return;
            }
            if (perfil.activo === false) {
                document.getElementById('error-msg').textContent =
                    'Tu acceso ha sido desactivado. Contacta a un administrador.';
                auth.signOut();
                return;
            }

            currentUID   = user.uid;
            currentEmail = perfil.email || user.email;
            currentRol   = perfil.rol === 'admin' ? 'admin' : 'usuario';

            document.getElementById('login-box').classList.add('hidden');
            document.getElementById('panel-box').classList.remove('hidden');
            document.getElementById('user-email-display').textContent = currentEmail;
            document.getElementById('mi-correo-txt').textContent = currentEmail;

            const badge = document.getElementById('user-role-badge');
            badge.textContent = currentRol === 'admin' ? 'Administrador' : 'Usuario';
            badge.className = 'role-badge ' + currentRol;

            const esAdmin = currentRol === 'admin';
            document.getElementById('bottom-nav').classList.toggle('hidden', !esAdmin);
            document.getElementById('dashboard-stats').classList.toggle('hidden', !esAdmin);
            mostrarTab('inicio');

            startListening();
            if (esAdmin) {
                renderRegistro();
                if (typeof cargarUsuarios === 'function') cargarUsuarios();
                pintarInfoSistema();
            }

            // Registra el último acceso del propio usuario (permitido por reglas
            // porque cada quien puede escribir solo su propio campo ultimoAcceso)
            db.ref('usuarios/' + currentUID + '/ultimoAcceso').set(Date.now()).catch(() => {});

            subirTimestampHora();
            programarSyncHora();
            registrarAccion('inicio_sesion');
        }).catch(e => {
            console.error(e);
            document.getElementById('error-msg').textContent = 'Error al verificar tu cuenta.';
            auth.signOut();
        });
    } else {
        currentUID = null; currentEmail = null; currentRol = null;
        document.getElementById('login-box').classList.remove('hidden');
        document.getElementById('panel-box').classList.add('hidden');
        // El mensaje de error NO se limpia aquí a propósito: si se hiciera,
        // desaparecería de inmediato porque signOut() dispara este bloque
        // justo después de mostrarlo. Se limpia solo al reintentar login.
    }
});

function handleLogin() {
    const email = document.getElementById('user-email').value.trim();
    const pass  = document.getElementById('user-pass').value;
    document.getElementById('error-msg').textContent = '';
    auth.signInWithEmailAndPassword(email, pass).catch(() => {
        document.getElementById('error-msg').textContent = 'Correo o contraseña incorrectos.';
    });
}

function handleLogout() {
    registrarAccion('cierre_sesion');
    setTimeout(() => auth.signOut(), 150);
}

function cambiarMiPassword() {
    if (!currentEmail) return;
    confirmar(`¿Enviar un correo de restablecimiento de contraseña a ${currentEmail}?`, () => {
        auth.sendPasswordResetEmail(currentEmail).then(() => {
            setStatus('Correo de restablecimiento enviado ✓', 'ok');
        }).catch(() => setStatus('Error al enviar el correo', 'err'));
    });
}

// ══════════════════════════════════════════════
//  LISTENERS EN TIEMPO REAL
// ══════════════════════════════════════════════
function startListening() {

    db.ref('estado_maestro').on('value', snap => {
        estadoMaestro = snap.val() !== false;
        const btn = document.getElementById('btn-maestro');
        if (btn) {
            if (estadoMaestro) {
                btn.textContent = '✔ SISTEMA ACTIVADO';
                btn.className   = 'btn btn-green';
            } else {
                btn.textContent = '⏸ SISTEMA PAUSADO';
                btn.className   = 'btn btn-red';
            }
        }
        const stat = document.getElementById('stat-estado-sistema');
        if (stat) stat.textContent = estadoMaestro ? 'Activo' : 'Pausado';
        actualizarDashboard();
    });

    db.ref('timbres').on('value', snap => {
        horariosCache = [];
        if (snap.exists()) {
            snap.forEach(child => {
                const t = child.val();
                horariosCache.push({ key: child.key, h: t.h, m: t.m });
            });
            horariosCache.sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
        }
        pintarHorarios();
        actualizarDashboard();
    });

    db.ref('ultima_conexion').on('value', snap => {
        const statusDiv  = document.getElementById('device-status');
        const statusText = document.getElementById('device-status-text');
        const lastTime   = snap.val();
        const update = () => {
            if (!lastTime) {
                statusDiv.className = 'st-offline';
                statusText.textContent = 'Sin datos del dispositivo';
                return;
            }
            const diff = (Date.now() - lastTime) / 1000;
            if (diff < 40) {
                statusDiv.className = 'st-online';
                statusText.textContent = `ESP32 EN LÍNEA — hace ${Math.round(diff)}s`;
            } else {
                statusDiv.className = 'st-offline';
                statusText.textContent = `FUERA DE LÍNEA — última vez hace ${Math.round(diff / 60)} min`;
            }
        };
        update();
        if (hbTimer) clearInterval(hbTimer);
        hbTimer = setInterval(update, 5000);
    });
}

// ══════════════════════════════════════════════
//  DASHBOARD (tarjetas de resumen, solo admin)
// ══════════════════════════════════════════════
function actualizarDashboard() {
    if (currentRol !== 'admin') return;

    const elProximo = document.getElementById('stat-proximo');
    const elTotal    = document.getElementById('stat-total-horarios');
    if (elTotal) elTotal.textContent = horariosCache.length;

    if (elProximo) {
        if (horariosCache.length === 0) {
            elProximo.textContent = '--:--';
        } else {
            const ahora = new Date();
            const minAhora = ahora.getHours() * 60 + ahora.getMinutes();
            const minutos = horariosCache.map(t => t.h * 60 + t.m);
            const futuros = minutos.filter(m => m > minAhora).sort((a, b) => a - b);
            const proximoMin = futuros.length ? futuros[0] : Math.min(...minutos);
            const h = Math.floor(proximoMin / 60), m = proximoMin % 60;
            elProximo.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }
    }
}

// ══════════════════════════════════════════════
//  HORARIOS (todo dentro de la pestaña "Timbre")
// ══════════════════════════════════════════════
function pintarHorarios() {
    const listDiv = document.getElementById('lista-toques');
    if (!listDiv) return;

    const busqueda = (document.getElementById('buscar-horario')?.value || '').trim();
    const filtrados = busqueda
        ? horariosCache.filter(t => `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`.includes(busqueda))
        : horariosCache;

    listDiv.innerHTML = '';
    if (filtrados.length === 0) {
        listDiv.innerHTML = `<div class="no-toques">${busqueda ? 'Sin coincidencias' : 'Sin horarios registrados'}</div>`;
    } else {
        filtrados.forEach(t => {
            const ts = `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`;
            const div = document.createElement('div');
            div.className = 'toque-item';
            div.id = `item-${t.key}`;
            div.innerHTML = `
                <span class="toque-time">${ts}</span>
                <div class="toque-actions">
                    <button class="btn-edit" onclick="showEditForm('${t.key}','${ts}')">Editar</button>
                    <button class="btn-del"  onclick="deleteTime('${t.key}')">Borrar</button>
                </div>`;
            listDiv.appendChild(div);
        });
    }
    document.getElementById('contador-horarios').textContent = horariosCache.length;

    const manana = horariosCache.filter(t => t.h < 12).length;
    const tarde   = horariosCache.length - manana;
    const resumen = document.getElementById('resumen-horarios');
    if (resumen) resumen.innerHTML = `<span>🌅 Mañana: <b>${manana}</b></span><span>🌇 Tarde: <b>${tarde}</b></span>`;
}

document.getElementById('buscar-horario')?.addEventListener('input', pintarHorarios);
document.getElementById('buscar-usuario')?.addEventListener('input', () => {
    if (typeof pintarUsuarios === 'function') pintarUsuarios();
});

function horarioExiste(h, m) {
    return horariosCache.some(t => t.h === h && t.m === m);
}

function addTime() {
    if (currentRol !== 'admin') return;
    const val = document.getElementById('nuevo-horario').value;
    if (!val) { setStatus('Selecciona una hora primero', 'err'); return; }
    const [h, m] = val.split(':').map(Number);
    if (horarioExiste(h, m)) { setStatus('Ese horario ya existe', 'err'); return; }
    setStatus('Guardando horario...', 'busy');
    db.ref('timbres').push({ h, m }).then(() => {
        triggerSync();
        registrarAccion('horario_agregado', val);
        document.getElementById('nuevo-horario').value = '';
        setStatus('Horario guardado ✓', 'ok');
    }).catch(() => setStatus('Error al guardar', 'err'));
}

function deleteTime(id) {
    if (currentRol !== 'admin') return;
    confirmar('¿Borrar este horario?', () => {
        setStatus('Borrando...', 'busy');
        db.ref('timbres/' + id).remove().then(() => {
            triggerSync();
            registrarAccion('horario_eliminado', id);
            setStatus('Horario eliminado ✓', 'ok');
        }).catch(() => setStatus('Error al borrar', 'err'));
    });
}

function showEditForm(id, currentTime) {
    if (currentRol !== 'admin') return;
    const item = document.getElementById(`item-${id}`);
    item.innerHTML = `
        <div class="edit-row">
            <input type="time" id="edit-${id}" value="${currentTime}">
            <button class="btn-edit" onclick="saveEdit('${id}')">OK</button>
            <button class="btn-del"  onclick="pintarHorarios()">✕</button>
        </div>`;
}

function saveEdit(id) {
    if (currentRol !== 'admin') return;
    const newVal = document.getElementById(`edit-${id}`)?.value;
    if (!newVal) return;
    const [h, m] = newVal.split(':').map(Number);
    setStatus('Actualizando...', 'busy');
    db.ref('timbres/' + id).update({ h, m }).then(() => {
        triggerSync();
        registrarAccion('horario_editado', newVal);
        setStatus('Horario actualizado ✓', 'ok');
    }).catch(() => setStatus('Error al actualizar', 'err'));
}

function exportarHorariosCSV() {
    if (horariosCache.length === 0) { setStatus('No hay horarios para exportar', 'err'); return; }
    const filas = [['Hora']];
    horariosCache.forEach(t => filas.push([`${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`]));
    descargarCSV(filas, `horarios_timbre_${Date.now()}.csv`);
    setStatus('CSV de horarios descargado ✓', 'ok');
}

function importarHorariosCSV(event) {
    if (currentRol !== 'admin') return;
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
        const lineas = e.target.result.split(/\r?\n/);
        const regex = /^([01]?\d|2[0-3]):([0-5]\d)/;
        const nuevos = [];

        lineas.forEach(linea => {
            const match = linea.trim().match(regex);
            if (!match) return;
            const h = parseInt(match[1], 10);
            const m = parseInt(match[2], 10);
            if (!horarioExiste(h, m) && !nuevos.some(n => n.h === h && n.m === m)) {
                nuevos.push({ h, m });
            }
        });

        if (nuevos.length === 0) {
            setStatus('No se encontraron horarios nuevos válidos en el archivo', 'err');
            event.target.value = '';
            return;
        }

        confirmar(`Se encontraron ${nuevos.length} horario(s) nuevo(s). ¿Agregarlos todos?`, () => {
            setStatus('Importando horarios...', 'busy');
            const promesas = nuevos.map(n => db.ref('timbres').push(n));
            Promise.all(promesas).then(() => {
                triggerSync();
                registrarAccion('horarios_importados', `${nuevos.length} horarios`);
                setStatus(`${nuevos.length} horario(s) importado(s) ✓`, 'ok');
            }).catch(() => setStatus('Error al importar', 'err'));
        });

        event.target.value = '';
    };
    reader.readAsText(file);
}

// ══════════════════════════════════════════════
//  ACCIONES (protegidas también por reglas de Firebase,
//  ver reglas-seguridad.json)
// ══════════════════════════════════════════════
function setStatus(msg, tipo = '') {
    const el = document.getElementById('status-bar');
    el.textContent = msg;
    el.className   = tipo;
    if (tipo === 'ok') setTimeout(() => { el.textContent = 'Listo.'; el.className = ''; }, 4000);
}

function toggleMaestro() {
    if (currentRol !== 'admin') return;
    const nuevoEstado = !estadoMaestro;
    db.ref('estado_maestro').set(nuevoEstado).then(() => {
        registrarAccion('estado_maestro', nuevoEstado ? 'activado' : 'pausado');
    }).catch(() => setStatus('Error al cambiar estado', 'err'));
}

function manualRing() {
    if (currentRol !== 'admin') return;
    confirmar('¿Enviar un toque manual al timbre ahora mismo?', () => {
        setStatus('Enviando toque manual...', 'busy');
        db.ref('manual').set(true).then(() => {
            registrarAccion('toque_manual');
            setStatus('¡Toque enviado! ✓', 'ok');
        }).catch(() => setStatus('Error al enviar', 'err'));
    });
}

function syncSystem() {
    if (currentRol !== 'admin') return;
    setStatus('Sincronizando...', 'busy');
    const batch = {
        hora_unix_ms: Date.now(),
        comando_sync: true,
        comando_sync_hora: true
    };
    db.ref('/').update(batch).then(() => {
        registrarAccion('sincronizacion_completa');
        setStatus('Sincronización enviada ✓', 'ok');
    }).catch(() => setStatus('Error de sincronización', 'err'));
}

// Disponible para TODOS los roles (admin y usuario normal)
function syncHora() {
    setStatus('Actualizando hora...', 'busy');
    db.ref('hora_unix_ms').set(Date.now())
      .then(() => db.ref('comando_sync_hora').set(true))
      .then(() => {
          registrarAccion('hora_actualizada');
          setStatus('Hora actualizada ✓', 'ok');
      })
      .catch(() => setStatus('Error al actualizar hora', 'err'));
}

function triggerSync() {
    db.ref('hora_unix_ms').set(Date.now());
    db.ref('comando_sync').set(true);
}

// ══════════════════════════════════════════════
//  BLUETOOTH HELPER (Web Bluetooth API) — solo admin
// ══════════════════════════════════════════════
function toggleBT() {
    const panel = document.getElementById('bt-panel');
    const icon  = document.getElementById('bt-toggle-icon');
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        icon.textContent = '▼';
    } else {
        panel.style.display = 'block';
        icon.textContent = '▲';
    }
}

async function enviarCredencialesBT() {
    if (currentRol !== 'admin') return;
    const ssid = document.getElementById('bt-ssid').value.trim();
    const pass = document.getElementById('bt-pass').value;
    const btStatus = document.getElementById('bt-status');

    if (!ssid) { btStatus.textContent = 'ERROR: Ingresa el nombre de la red.'; return; }
    if (!navigator.bluetooth) {
        btStatus.textContent = 'Tu navegador no soporta Web Bluetooth. Usa Chrome en Android/PC.';
        return;
    }

    try {
        btStatus.textContent = 'Buscando ESP32 por Bluetooth...';
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'Timbre-ESP32' }],
            optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb']
        });
        btStatus.textContent = 'Conectando...';
        const server  = await device.gatt.connect();
        const service = await server.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb');
        const char    = await service.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb');

        const mensaje = `${ssid}|${pass}\n`;
        const encoder = new TextEncoder();
        await char.writeValue(encoder.encode(mensaje));

        btStatus.textContent = `✓ Credenciales enviadas: ${ssid} | (contraseña oculta)`;
        registrarAccion('wifi_configurado', ssid);
        setTimeout(() => device.gatt.disconnect(), 3000);
    } catch (e) {
        btStatus.textContent = 'No se pudo conectar por Bluetooth: ' + e.message;
        console.error('BT Error:', e);
    }
}

// ══════════════════════════════════════════════
//  SISTEMA: respaldo e información general
// ══════════════════════════════════════════════
function descargarRespaldo() {
    if (currentRol !== 'admin') return;
    setStatus('Generando respaldo...', 'busy');

    Promise.all([
        db.ref('timbres').once('value'),
        db.ref('usuarios').once('value'),
        db.ref('registro').once('value'),
        db.ref('estado_maestro').once('value')
    ]).then(([timbresSnap, usuariosSnap, registroSnap, estadoSnap]) => {
        const respaldo = {
            fecha_respaldo: new Date().toISOString(),
            estado_maestro: estadoSnap.val(),
            timbres: timbresSnap.val() || {},
            usuarios: usuariosSnap.val() || {},
            registro: registroSnap.val() || {}
        };
        const blob = new Blob([JSON.stringify(respaldo, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `respaldo_timbre_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        registrarAccion('respaldo_descargado');
        setStatus('Respaldo descargado ✓', 'ok');
    }).catch(() => setStatus('Error al generar el respaldo', 'err'));
}

function pintarInfoSistema() {
    const el = document.getElementById('info-sistema');
    if (!el) return;
    el.innerHTML = `
        <span>Versión: <b>v5.0</b></span>
        <span>Horarios: <b>${horariosCache.length}</b></span>
        <span>Usuarios: <b>${typeof usuariosCache !== 'undefined' ? usuariosCache.length : '—'}</b></span>`;
}
