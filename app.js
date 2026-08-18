// ══════════════════════════════════════════════
//  FIREBASE CONFIG  (v6.1)
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

// Monitoreo de conexión
let dispositivoOnline = false;
let historialConexion = [];
let eventosDesconexion = [];
let inicioDesconexionActual = null;
let notifDesconexionActivas = false;
let monitorTimer = null;

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

function mostrarAuthTab(tipo) {
    const loginDiv = document.getElementById('auth-login');
    const regDiv   = document.getElementById('auth-registro');
    const btnLogin = document.getElementById('tab-login-btn');
    const btnReg   = document.getElementById('tab-registro-btn');

    document.getElementById('error-msg').textContent = '';
    document.getElementById('registro-msg').textContent = '';

    if (tipo === 'login') {
        loginDiv.classList.remove('hidden');
        regDiv.classList.add('hidden');
        btnLogin.classList.add('active');
        btnReg.classList.remove('active');
    } else {
        loginDiv.classList.add('hidden');
        regDiv.classList.remove('hidden');
        btnLogin.classList.remove('active');
        btnReg.classList.add('active');
    }
}

// ══════════════════════════════════════════════
//  MODAL DE CONFIRMACIÓN
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
    actualizarProximoLive();
}
setInterval(actualizarReloj, 1000);
actualizarReloj();

// ── Próximo toque en vivo ────────────────────
function actualizarProximoLive() {
    const elHora = document.getElementById('proximo-live');
    const elCd   = document.getElementById('proximo-countdown');
    if (!elHora || !elCd) return;

    if (!estadoMaestro) {
        elHora.textContent = 'PAUSADO';
        elCd.textContent = 'El sistema está pausado';
        return;
    }
    if (horariosCache.length === 0) {
        elHora.textContent = '--:--';
        elCd.textContent = 'Sin horarios configurados';
        return;
    }

    const ahora = new Date();
    const minAhora = ahora.getHours() * 60 + ahora.getMinutes();
    const segAhora = ahora.getSeconds();
    const minutos = horariosCache.map(t => t.h * 60 + t.m);
    const futuros = minutos.filter(m => m > minAhora || (m === minAhora && segAhora === 0)).sort((a, b) => a - b);
    const proximoMin = futuros.length ? futuros[0] : Math.min(...minutos) + 24 * 60;

    const h = Math.floor((proximoMin % (24 * 60)) / 60);
    const m = (proximoMin % (24 * 60)) % 60;
    elHora.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    let diffMin = proximoMin - minAhora;
    if (diffMin < 0) diffMin += 24 * 60;
    const totalSeg = diffMin * 60 - segAhora;
    if (totalSeg <= 0) {
        elCd.textContent = '¡Ahora!';
        return;
    }
    const hrs = Math.floor(totalSeg / 3600);
    const mins = Math.floor((totalSeg % 3600) / 60);
    const segs = totalSeg % 60;
    if (hrs > 0) {
        elCd.textContent = `En ${hrs}h ${mins}m ${segs}s`;
    } else if (mins > 0) {
        elCd.textContent = `En ${mins}m ${segs}s`;
    } else {
        elCd.textContent = `En ${segs}s`;
    }
}

// ── Sincronización automática de hora ─────────
// 1) Cada medianoche (+30s): solo timestamp
// 2) Cada 12 horas y 5 minutos: comando FORZADO al ESP32
const INTERVALO_SYNC_FORZADA_MS = (12 * 60 + 5) * 60 * 1000; // 12h 5min

function programarSyncHora() {
    // Sync ligera a medianoche (solo hora_unix_ms)
    const ahora = new Date();
    const mañana = new Date(ahora);
    mañana.setDate(mañana.getDate() + 1);
    mañana.setHours(0, 0, 30, 0);
    const msHastaMedianoche = mañana - ahora;

    setTimeout(() => {
        subirTimestampHora();
        setInterval(subirTimestampHora, 24 * 60 * 60 * 1000);
    }, msHastaMedianoche);

    // Sync FORZADA cada 12h 5min (hora + comando_sync_hora)
    // Primera ejecución: al cumplir el intervalo desde que se abre la sesión
    // (si quieres que sea a horas fijas del día, dímelo y lo ajustamos)
    setTimeout(() => {
        forzarSyncHoraESP32();
        setInterval(forzarSyncHoraESP32, INTERVALO_SYNC_FORZADA_MS);
    }, INTERVALO_SYNC_FORZADA_MS);

    console.log('[Sync] Forzada programada cada 12h 5min (' + INTERVALO_SYNC_FORZADA_MS + ' ms)');
}

function subirTimestampHora() {
    db.ref('hora_unix_ms').set(Date.now()).catch(e => console.error('Error subiendo hora:', e));
}

/** Envía hora + comando forzado de sincronización al ESP32 */
function forzarSyncHoraESP32() {
    const ts = Date.now();
    console.log('[Sync] Forzando actualización de hora al ESP32:', new Date(ts).toLocaleString());
    db.ref('hora_unix_ms').set(ts)
        .then(() => db.ref('comando_sync_hora').set(true))
        .then(() => {
            if (typeof registrarAccion === 'function') {
                registrarAccion('hora_actualizada', 'auto cada 12h5min');
            }
            if (typeof setStatus === 'function') {
                setStatus('Hora del ESP32 actualizada (auto) ✓', 'ok');
            }
        })
        .catch(e => console.error('[Sync] Error forzando hora:', e));
}

// ══════════════════════════════════════════════
//  REGISTRO DE ACTIVIDAD (bitácora)
// ══════════════════════════════════════════════
// Guarda en Supabase (historial permanente)
function registrarAccion(accion, detalle = '') {
    if (typeof guardarEnHistorial === 'function') {
        guardarEnHistorial(accion, detalle);
    }
}

const ETIQUETAS_ACCION = {
    inicio_sesion: 'inició sesión',
    cierre_sesion: 'cerró sesión',
    solicitud_registro: 'solicitó registro',
    usuario_aprobado: 'aprobó un usuario',
    usuario_rechazado: 'rechazó un usuario',
    horario_agregado: 'agregó un horario',
    horario_editado: 'editó un horario',
    horario_eliminado: 'eliminó un horario',
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
    respaldo_descargado: 'descargó un respaldo',
    desconexion_esp32: 'detectó desconexión del ESP32'
};

async function renderRegistro() {
    setStatus('Cargando historial...', 'busy');
    const filtros = {
        accion: document.getElementById('filtro-accion')?.value || '',
        email:  document.getElementById('filtro-usuario')?.value || '',
        desde:  document.getElementById('filtro-desde')?.value || '',
        hasta:  document.getElementById('filtro-hasta')?.value || ''
    };
    // Limpiar filtros vacíos
    Object.keys(filtros).forEach(k => { if (!filtros[k]) delete filtros[k]; });

    registroCache = await cargarHistorialSupabase(registroLimite, filtros);
    // Normalizar: Supabase usa created_at, el resto del código espera timestamp
    registroCache = registroCache.map(r => ({
        ...r,
        timestamp: r.timestamp || new Date(r.created_at).getTime()
    }));
    actualizarFiltroUsuarios();
    pintarRegistro();
    setStatus('Historial cargado ✓', 'ok');
}

function cargarMasRegistro() {
    registroLimite += 80;
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

    // Los filtros ya se aplican al cargar desde Supabase,
    // pero también filtramos en cliente por si el usuario cambia selects
    const filtroAccion = document.getElementById('filtro-accion')?.value || '';
    const filtroUsuario = document.getElementById('filtro-usuario')?.value || '';
    const desde = document.getElementById('filtro-desde')?.value || '';
    const hasta = document.getElementById('filtro-hasta')?.value || '';

    const desdeTs = desde ? new Date(desde + 'T00:00:00').getTime() : null;
    const hastaTs = hasta ? new Date(hasta + 'T23:59:59').getTime() : null;

    const filtrados = registroCache.filter(r => {
        if (filtroAccion && r.accion !== filtroAccion) return false;
        if (filtroUsuario && r.email !== filtroUsuario) return false;
        const ts = r.timestamp || new Date(r.created_at).getTime();
        if (desdeTs && ts < desdeTs) return false;
        if (hastaTs && ts > hastaTs) return false;
        return true;
    });

    document.getElementById('contador-registro').textContent = filtrados.length;
    cont.innerHTML = '';

    if (filtrados.length === 0) {
        cont.innerHTML = '<div class="no-toques">Sin resultados</div>';
        return;
    }

    filtrados.forEach(r => {
        const tsNum = r.timestamp || new Date(r.created_at).getTime();
        const fecha = new Date(tsNum);
        const ts = fecha.toLocaleString('es-SV', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const etiqueta = ETIQUETAS_ACCION[r.accion] || r.accion;
        const extra = r.duracion_seg ? ` (${r.duracion_seg}s)` : '';
        const div = document.createElement('div');
        div.className = 'registro-item';
        div.innerHTML = `<span class="ts">${ts}</span><b>${r.email || 'sistema'}</b> ${etiqueta}${r.detalle ? ' — ' + r.detalle : ''}${extra}`;
        cont.appendChild(div);
    });

    if (typeof actualizarMonitoreo === 'function') actualizarMonitoreo();
}

function exportarRegistroCSV() {
    if (registroCache.length === 0) { setStatus('No hay registro para exportar', 'err'); return; }
    const filas = [['Fecha', 'Correo', 'Accion', 'Detalle', 'Tipo', 'Duracion_seg']];
    registroCache.forEach(r => {
        const tsNum = r.timestamp || new Date(r.created_at).getTime();
        filas.push([
            new Date(tsNum).toLocaleString('es-SV'),
            r.email || '',
            r.accion || '',
            r.detalle || '',
            r.tipo || '',
            r.duracion_seg ?? ''
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
//  AUTH + REGISTRO CON APROBACIÓN
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

            // Estado pendiente → no dejar entrar
            if (perfil.estado === 'pendiente') {
                document.getElementById('error-msg').textContent =
                    'Tu solicitud está pendiente de aprobación. Un administrador debe autorizarte.';
                auth.signOut();
                return;
            }

            if (perfil.estado === 'rechazado') {
                document.getElementById('error-msg').textContent =
                    'Tu solicitud de acceso fue rechazada. Contacta a un administrador.';
                auth.signOut();
                return;
            }

            if (perfil.activo === false) {
                document.getElementById('error-msg').textContent =
                    'Tu acceso ha sido desactivado. Contacta a un administrador.';
                auth.signOut();
                return;
            }

            // Solo estados aprobados (o legados sin campo estado)
            const estadoOk = !perfil.estado || perfil.estado === 'aprobado';
            if (!estadoOk) {
                document.getElementById('error-msg').textContent =
                    'Tu cuenta no tiene acceso autorizado.';
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
            document.getElementById('monitoreo-avanzado').classList.toggle('hidden', !esAdmin);
            mostrarTab('inicio');

            startListening();
            if (esAdmin) {
                renderRegistro();
                if (typeof cargarUsuarios === 'function') cargarUsuarios();
                pintarInfoSistema();
                iniciarMonitoreo();
            }

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
    }
});

function handleLogin() {
    const email = document.getElementById('user-email').value.trim();
    const pass  = document.getElementById('user-pass').value;
    document.getElementById('error-msg').textContent = '';

    if (!email || !pass) {
        document.getElementById('error-msg').textContent = 'Completa correo y contraseña.';
        return;
    }

    auth.signInWithEmailAndPassword(email, pass).catch(err => {
        const msg = err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-email'
            ? 'Correo o contraseña incorrectos.'
            : (err.code === 'auth/too-many-requests' ? 'Demasiados intentos. Espera unos minutos.' : 'Error al iniciar sesión.');
        document.getElementById('error-msg').textContent = msg;
    });
}

function handleRegistro() {
    const email = document.getElementById('reg-email').value.trim();
    const pass  = document.getElementById('reg-pass').value;
    const pass2 = document.getElementById('reg-pass2').value;
    const msgEl = document.getElementById('registro-msg');

    msgEl.textContent = '';
    msgEl.className = '';

    if (!email || !pass || !pass2) {
        msgEl.textContent = 'Completa todos los campos.';
        msgEl.className = 'msg-err';
        return;
    }
    if (pass.length < 8) {
        msgEl.textContent = 'La contraseña debe tener al menos 8 caracteres.';
        msgEl.className = 'msg-err';
        return;
    }
    if (pass !== pass2) {
        msgEl.textContent = 'Las contraseñas no coinciden.';
        msgEl.className = 'msg-err';
        return;
    }

    msgEl.textContent = 'Creando solicitud...';
    msgEl.className = 'msg-busy';

    // Crear cuenta con una app secundaria para no afectar la sesión actual
    const nombreApp = 'Registro_' + Date.now();
    const appSec = firebase.initializeApp(firebaseConfig, nombreApp);

    appSec.auth().createUserWithEmailAndPassword(email, pass)
        .then(cred => {
            const uid = cred.user.uid;
            // IMPORTANTE: escribir con la app secundaria (ya autenticada como el usuario nuevo).
            // Si se usa db (app principal), auth.uid no coincide y Firebase da PERMISSION_DENIED.
            return appSec.database().ref('usuarios/' + uid).set({
                email,
                rol: 'usuario',
                estado: 'pendiente',
                activo: false,
                creado: Date.now(),
                creadoPor: 'auto-registro'
            }).then(() => {
                if (typeof guardarEnHistorial === 'function') {
                    const prevEmail = currentEmail;
                    const prevUID = currentUID;
                    currentEmail = email;
                    currentUID = uid;
                    guardarEnHistorial('solicitud_registro', 'Solicitud de acceso pendiente de aprobación');
                    currentEmail = prevEmail;
                    currentUID = prevUID;
                }
            });
        })
        .then(() => {
            msgEl.textContent = '✓ Solicitud enviada. Un administrador debe aprobar tu cuenta antes de que puedas entrar.';
            msgEl.className = 'msg-ok';
            document.getElementById('reg-email').value = '';
            document.getElementById('reg-pass').value = '';
            document.getElementById('reg-pass2').value = '';
        })
        .catch(err => {
            console.error(err);
            const codigo = err.code || err.message || '';
            let texto = traducirErrorAuth(err.code);
            if (String(codigo).includes('PERMISSION_DENIED') || String(err.message || '').includes('PERMISSION_DENIED')) {
                texto = 'Sin permiso para crear el perfil. Revisa las reglas de Firebase (usuarios).';
            }
            msgEl.textContent = 'Error: ' + texto;
            msgEl.className = 'msg-err';
        })
        .finally(() => {
            appSec.auth().signOut().finally(() => appSec.delete());
        });
}

function handleLogout() {
    registrarAccion('cierre_sesion');
    setTimeout(() => auth.signOut(), 150);
}

function cambiarMiPassword() {
    if (!currentEmail) return;
    confirmar(`¿Enviar un correo de restablecimiento de contraseña a ${currentEmail}?`, () => {
        const actionCodeSettings = { url: window.location.href };
        auth.sendPasswordResetEmail(currentEmail, actionCodeSettings).then(() => {
            setStatus('Correo enviado ✓ — revisa también spam/no deseado', 'ok');
        }).catch(err => {
            console.error('Error al enviar reset:', err.code, err.message);
            setStatus(traducirErrorReset(err.code), 'err');
        });
    });
}

function traducirErrorReset(code) {
    const mapa = {
        'auth/too-many-requests': 'Firebase bloqueó el envío por demasiados intentos seguidos. Espera unos minutos.',
        'auth/user-not-found': 'Ese correo no tiene cuenta en Firebase Authentication.',
        'auth/invalid-email': 'El correo no es válido.',
        'auth/network-request-failed': 'Falló la conexión. Revisa tu internet e intenta de nuevo.'
    };
    return mapa[code] || `Error de Firebase: ${code || 'desconocido'}`;
}

function traducirErrorAuth(code) {
    const mapa = {
        'auth/email-already-in-use': 'Ese correo ya está registrado.',
        'auth/invalid-email': 'Correo inválido.',
        'auth/weak-password': 'La contraseña es muy débil (mínimo 8 caracteres).',
        'auth/operation-not-allowed': 'El registro por correo no está habilitado en Firebase.'
    };
    return mapa[code] || code || 'error desconocido';
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
        actualizarProximoLive();
        if (typeof actualizarMonitoreo === 'function') actualizarMonitoreo();
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
        actualizarProximoLive();
        if (typeof actualizarMonitoreo === 'function') actualizarMonitoreo();
    });

    db.ref('ultima_conexion').on('value', snap => {
        const statusDiv  = document.getElementById('device-status');
        const statusText = document.getElementById('device-status-text');
        const lastTime   = snap.val();
        const update = () => {
            if (!lastTime) {
                statusDiv.className = 'st-offline';
                statusText.textContent = 'Sin datos del dispositivo';
                dispositivoOnline = false;
                return;
            }
            const diff = (Date.now() - lastTime) / 1000;
            if (diff < 40) {
                statusDiv.className = 'st-online';
                statusText.textContent = `ESP32 EN LÍNEA — hace ${Math.round(diff)}s`;
                dispositivoOnline = true;
            } else {
                statusDiv.className = 'st-offline';
                statusText.textContent = `FUERA DE LÍNEA — última vez hace ${Math.round(diff / 60)} min`;
                dispositivoOnline = false;
            }
        };
        update();
        if (hbTimer) clearInterval(hbTimer);
        hbTimer = setInterval(update, 5000);
    });
}

// ══════════════════════════════════════════════
//  DASHBOARD
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
//  MONITOREO AVANZADO
// ══════════════════════════════════════════════
function iniciarMonitoreo() {
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTick();
    monitorTimer = setInterval(monitorTick, 15000);
}

function monitorTick() {
    const ahora = Date.now();
    const anterior = historialConexion[historialConexion.length - 1];

    historialConexion.push({ ts: ahora, online: dispositivoOnline });
    if (historialConexion.length > 80) historialConexion.shift();

    if (anterior && anterior.online && !dispositivoOnline) {
        inicioDesconexionActual = ahora;
        if (notifDesconexionActivas && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('⚠️ ESP32 desconectado', { body: 'El sistema de timbre perdió conexión con el dispositivo.' });
        }
    }
    if (anterior && !anterior.online && dispositivoOnline && inicioDesconexionActual) {
        const duracionSeg = Math.round((ahora - inicioDesconexionActual) / 1000);
        eventosDesconexion.unshift({ inicio: inicioDesconexionActual, duracionSeg });
        eventosDesconexion = eventosDesconexion.slice(0, 10);
        // Guardar desconexión en Supabase (permanente)
        if (typeof guardarDesconexion === 'function') {
            guardarDesconexion(duracionSeg, inicioDesconexionActual);
        }
        inicioDesconexionActual = null;
    }

    actualizarMonitoreo();
}

function toggleNotificaciones(activo) {
    if (!activo) {
        notifDesconexionActivas = false;
        return;
    }
    if (typeof Notification === 'undefined') {
        setStatus('Tu navegador no soporta notificaciones', 'err');
        document.getElementById('notif-desconexion').checked = false;
        return;
    }
    Notification.requestPermission().then(permiso => {
        notifDesconexionActivas = permiso === 'granted';
        if (permiso !== 'granted') {
            document.getElementById('notif-desconexion').checked = false;
            setStatus('Permiso de notificaciones denegado por el navegador', 'err');
        } else {
            setStatus('Notificaciones activadas ✓', 'ok');
        }
    });
}

function actualizarMonitoreo() {
    if (currentRol !== 'admin') return;

    const badge   = document.getElementById('salud-badge');
    const detalle = document.getElementById('salud-detalle');
    const razones = [];
    let nivel = 'ok';

    if (!dispositivoOnline) { razones.push({ txt: 'ESP32 fuera de línea', mal: true }); nivel = 'bad'; }
    else razones.push({ txt: 'ESP32 en línea', mal: false });

    if (!estadoMaestro) { razones.push({ txt: 'Sistema pausado', mal: true }); if (nivel === 'ok') nivel = 'warn'; }
    else razones.push({ txt: 'Sistema activado', mal: false });

    if (horariosCache.length === 0) { razones.push({ txt: 'Sin horarios configurados', mal: true }); if (nivel === 'ok') nivel = 'warn'; }
    else razones.push({ txt: `${horariosCache.length} horario(s) configurado(s)`, mal: false });

    if (badge) {
        badge.className = 'salud-badge ' + nivel;
        badge.textContent = nivel === 'ok' ? '🟢 Todo en orden' : nivel === 'warn' ? '🟡 Requiere atención' : '🔴 Crítico';
    }
    if (detalle) {
        detalle.innerHTML = razones.map(r => `<li class="${r.mal ? 'mal' : 'bien'}">${r.mal ? '✕' : '✓'} ${r.txt}</li>`).join('');
    }

    const total   = historialConexion.length;
    const enLinea = historialConexion.filter(s => s.online).length;
    const pct     = total ? Math.round((enLinea / total) * 100) : 0;
    const elPct   = document.getElementById('uptime-porcentaje');
    if (elPct) elPct.textContent = total ? `${pct}%` : '--%';

    const linea = document.getElementById('linea-tiempo');
    if (linea) {
        linea.innerHTML = historialConexion.map(s =>
            `<span class="${s.online ? 'on' : 'off'}" title="${new Date(s.ts).toLocaleTimeString('es-SV')}"></span>`
        ).join('');
    }

    const listaDes = document.getElementById('lista-desconexiones');
    if (listaDes) {
        if (eventosDesconexion.length === 0) {
            listaDes.innerHTML = '<div class="no-toques">Sin desconexiones detectadas en esta sesión</div>';
        } else {
            listaDes.innerHTML = eventosDesconexion.map(ev => {
                const hora = new Date(ev.inicio).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
                const dur = ev.duracionSeg < 60 ? `${ev.duracionSeg}s` : `${Math.round(ev.duracionSeg / 60)} min`;
                return `<div class="registro-item">Desconectado a las <b>${hora}</b>, durante ${dur}</div>`;
            }).join('');
        }
    }

    const grafico = document.getElementById('grafico-actividad');
    if (grafico) {
        const dias = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            d.setHours(0, 0, 0, 0);
            dias.push({ fecha: d, count: 0 });
        }
        registroCache.forEach(r => {
            const f = new Date(r.timestamp);
            f.setHours(0, 0, 0, 0);
            const bucket = dias.find(d => d.fecha.getTime() === f.getTime());
            if (bucket) bucket.count++;
        });
        const max = Math.max(1, ...dias.map(d => d.count));
        const nombresDias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
        grafico.innerHTML = dias.map(d => `
            <div class="barra-dia">
                <span class="num">${d.count}</span>
                <div class="barra" style="height:${Math.max(3, (d.count / max) * 90)}px;"></div>
                <span class="dia">${nombresDias[d.fecha.getDay()]}</span>
            </div>`).join('');
    }

    const topEl = document.getElementById('top-acciones');
    if (topEl) {
        const conteo = {};
        registroCache.forEach(r => { conteo[r.accion] = (conteo[r.accion] || 0) + 1; });
        const top = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 3);
        topEl.innerHTML = top.length
            ? top.map(([accion, n]) => `<div class="top-accion-item"><span>${ETIQUETAS_ACCION[accion] || accion}</span><b>${n}</b></div>`).join('')
            : '<div class="no-toques">Sin datos suficientes todavía</div>';
    }
}

// ══════════════════════════════════════════════
//  HORARIOS
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

// ══════════════════════════════════════════════
//  ACCIONES
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
//  BLUETOOTH
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
//  SISTEMA
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
            version: '6.0',
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
        <span>Versión: <b>v6.1</b></span>
        <span>Horarios: <b>${horariosCache.length}</b></span>
        <span>Usuarios: <b>${typeof usuariosCache !== 'undefined' ? usuariosCache.length : '—'}</b></span>`;
}


// Inicializar Supabase al cargar
document.addEventListener('DOMContentLoaded', () => {
    if (typeof initSupabase === 'function') initSupabase();
});
