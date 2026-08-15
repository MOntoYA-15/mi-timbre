// ══════════════════════════════════════════════
//  GESTIÓN DE USUARIOS + APROBACIONES (v6.0)
// ══════════════════════════════════════════════

let usuariosCache = [];

function cargarUsuarios() {
    db.ref('usuarios').on('value', snap => {
        usuariosCache = [];
        if (snap.exists()) {
            snap.forEach(child => usuariosCache.push({ uid: child.key, ...child.val() }));
            usuariosCache.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
        }
        pintarUsuarios();
        pintarPendientes();
        actualizarStatUsuarios();
        if (typeof pintarInfoSistema === 'function') pintarInfoSistema();
    });
}

function actualizarStatUsuarios() {
    const activos = usuariosCache.filter(u => u.activo !== false && (u.estado === 'aprobado' || !u.estado)).length;
    const el = document.getElementById('stat-usuarios-activos');
    if (el) el.textContent = activos;
}

function formatearUltimoAcceso(ts) {
    if (!ts) return 'nunca';
    const diffMin = Math.round((Date.now() - ts) / 60000);
    if (diffMin < 1) return 'justo ahora';
    if (diffMin < 60) return `hace ${diffMin} min`;
    if (diffMin < 1440) return `hace ${Math.round(diffMin / 60)} h`;
    return new Date(ts).toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function pintarPendientes() {
    const cont = document.getElementById('lista-pendientes');
    const contador = document.getElementById('contador-pendientes');
    const badge = document.getElementById('badge-pendientes');
    if (!cont) return;

    const pendientes = usuariosCache.filter(u => u.estado === 'pendiente');
    if (contador) contador.textContent = pendientes.length;

    if (badge) {
        if (pendientes.length > 0) {
            badge.textContent = pendientes.length;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    cont.innerHTML = '';
    if (pendientes.length === 0) {
        cont.innerHTML = '<div class="no-toques">No hay solicitudes pendientes</div>';
        return;
    }

    pendientes.forEach(u => {
        const fecha = u.creado
            ? new Date(u.creado).toLocaleString('es-SV', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : '—';
        const div = document.createElement('div');
        div.className = 'usuario-item pendiente-item';
        div.innerHTML = `
            <div class="usuario-top">
                <span class="usuario-email">
                    ${u.email || u.uid}
                    <span class="estado-pill pending">Pendiente</span>
                </span>
            </div>
            <div class="usuario-meta">Solicitado: ${fecha}</div>
            <div class="usuario-actions">
                <button class="on" onclick="aprobarUsuario('${u.uid}')">✓ Aprobar</button>
                <button class="off" onclick="rechazarUsuario('${u.uid}')">✕ Rechazar</button>
            </div>`;
        cont.appendChild(div);
    });
}

function aprobarUsuario(uid) {
    if (currentRol !== 'admin') return;
    const u = usuariosCache.find(x => x.uid === uid);
    confirmar(`¿Aprobar el acceso de ${u?.email || uid}?`, () => {
        db.ref('usuarios/' + uid).update({
            estado: 'aprobado',
            activo: true,
            aprobadoPor: currentEmail,
            aprobadoEn: Date.now()
        }).then(() => {
            registrarAccion('usuario_aprobado', u?.email || uid);
            setStatus('Usuario aprobado ✓', 'ok');
        }).catch(e => {
            console.error(e);
            setStatus('Error al aprobar', 'err');
        });
    });
}

function rechazarUsuario(uid) {
    if (currentRol !== 'admin') return;
    const u = usuariosCache.find(x => x.uid === uid);
    confirmar(`¿Rechazar la solicitud de ${u?.email || uid}? La cuenta quedará bloqueada.`, () => {
        db.ref('usuarios/' + uid).update({
            estado: 'rechazado',
            activo: false,
            rechazadoPor: currentEmail,
            rechazadoEn: Date.now()
        }).then(() => {
            registrarAccion('usuario_rechazado', u?.email || uid);
            setStatus('Solicitud rechazada', 'ok');
        }).catch(e => {
            console.error(e);
            setStatus('Error al rechazar', 'err');
        });
    });
}

function pintarUsuarios() {
    const cont = document.getElementById('lista-usuarios');
    if (!cont) return;

    const busqueda = (document.getElementById('buscar-usuario')?.value || '').toLowerCase().trim();
    const orden = document.getElementById('orden-usuarios')?.value || 'correo';

    // No mostrar pendientes aquí (van en su sección)
    let lista = usuariosCache.filter(u => u.estado !== 'pendiente');
    if (busqueda) {
        lista = lista.filter(u => (u.email || '').toLowerCase().includes(busqueda));
    }

    const comparadores = {
        correo:  (a, b) => (a.email || '').localeCompare(b.email || ''),
        rol:     (a, b) => (b.rol === 'admin' ? 1 : 0) - (a.rol === 'admin' ? 1 : 0) || (a.email || '').localeCompare(b.email || ''),
        acceso:  (a, b) => (b.ultimoAcceso || 0) - (a.ultimoAcceso || 0),
        creado:  (a, b) => (b.creado || 0) - (a.creado || 0),
        estado:  (a, b) => (a.estado || 'aprobado').localeCompare(b.estado || 'aprobado')
    };
    lista.sort(comparadores[orden] || comparadores.correo);

    document.getElementById('contador-usuarios').textContent = lista.length;

    const admins = lista.filter(u => u.rol === 'admin').length;
    const activos = lista.filter(u => u.activo !== false && (u.estado === 'aprobado' || !u.estado)).length;
    const rechazados = lista.filter(u => u.estado === 'rechazado').length;
    const resumen = document.getElementById('resumen-usuarios');
    if (resumen) {
        resumen.innerHTML = `
            <span>👑 Admins: <b>${admins}</b></span>
            <span>✅ Activos: <b>${activos}</b></span>
            <span>⛔ Inactivos/Rechazados: <b>${lista.length - activos}</b></span>`;
    }

    cont.innerHTML = '';

    if (lista.length === 0) {
        cont.innerHTML = `<div class="no-toques">${busqueda ? 'Sin coincidencias' : 'Sin usuarios registrados'}</div>`;
        return;
    }

    lista.forEach(u => {
        const activo = u.activo !== false && (u.estado === 'aprobado' || !u.estado);
        const esYo = u.uid === currentUID;
        const estadoTxt = u.estado === 'rechazado' ? 'Rechazado' : (activo ? 'Activo' : 'Inactivo');
        const estadoCls = u.estado === 'rechazado' ? 'off' : (activo ? 'on' : 'off');

        const div = document.createElement('div');
        div.className = 'usuario-item' + (activo ? '' : ' inactivo');
        div.innerHTML = `
            <div class="usuario-top">
                <span class="usuario-email">
                    ${u.email || u.uid}
                    ${esYo ? '<span class="tag-yo">tú</span>' : ''}
                    <span class="rol-pill ${u.rol === 'admin' ? 'admin' : ''}">${u.rol === 'admin' ? 'Admin' : 'Usuario'}</span>
                    <span class="estado-pill ${estadoCls}">${estadoTxt}</span>
                </span>
                <button class="copiar-btn" title="Copiar correo" onclick="copiarCorreo('${u.email || ''}', this)">📋</button>
            </div>
            <div class="usuario-meta">Últ. acceso: ${formatearUltimoAcceso(u.ultimoAcceso)}${u.creado ? ' · Creado: ' + new Date(u.creado).toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''}</div>
            <div class="usuario-actions">
                <select onchange="cambiarRol('${u.uid}', this.value)" ${esYo ? 'disabled' : ''}>
                    <option value="usuario" ${u.rol !== 'admin' ? 'selected' : ''}>Usuario</option>
                    <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
                <button class="${activo ? 'off' : 'on'}" onclick="toggleActivo('${u.uid}', ${activo})" ${esYo ? 'disabled' : ''}>
                    ${activo ? 'Desactivar' : 'Activar'}
                </button>
                <button class="link" onclick="enviarResetPassword('${u.uid}')">Resetear clave</button>
            </div>`;
        cont.appendChild(div);
    });
}

function copiarCorreo(email, btnEl) {
    if (!email) return;
    navigator.clipboard.writeText(email).then(() => {
        const original = btnEl.textContent;
        btnEl.textContent = '✓';
        setTimeout(() => { btnEl.textContent = original; }, 1200);
    }).catch(() => setStatus('No se pudo copiar el correo', 'err'));
}

function crearUsuario() {
    if (currentRol !== 'admin') return;

    const email = document.getElementById('nuevo-user-email').value.trim();
    const pass  = document.getElementById('nuevo-user-pass').value;
    const rol   = document.getElementById('nuevo-user-rol').value;
    const statusEl = document.getElementById('user-status');

    if (!email || !pass) {
        statusEl.textContent = 'Completa correo y contraseña.';
        return;
    }
    if (pass.length < 8) {
        statusEl.textContent = 'La contraseña debe tener al menos 8 caracteres.';
        return;
    }

    statusEl.textContent = 'Creando usuario...';

    const nombreApp = 'Secundaria_' + Date.now();
    const appSecundaria = firebase.initializeApp(firebaseConfig, nombreApp);

    appSecundaria.auth().createUserWithEmailAndPassword(email, pass)
        .then(cred => {
            const nuevoUid = cred.user.uid;
            return db.ref('usuarios/' + nuevoUid).set({
                email,
                rol,
                estado: 'aprobado',
                activo: true,
                creado: Date.now(),
                creadoPor: currentEmail
            });
        })
        .then(() => {
            registrarAccion('usuario_creado', `${email} (${rol})`);
            statusEl.textContent = `Usuario ${email} creado y aprobado ✓`;
            document.getElementById('nuevo-user-email').value = '';
            document.getElementById('nuevo-user-pass').value = '';
        })
        .catch(err => {
            console.error(err);
            statusEl.textContent = 'Error: ' + traducirErrorAuth(err.code);
        })
        .finally(() => {
            appSecundaria.auth().signOut().finally(() => appSecundaria.delete());
        });
}

function cambiarRol(uid, nuevoRol) {
    if (currentRol !== 'admin') return;
    if (uid === currentUID && nuevoRol !== 'admin') {
        confirmar('No puedes quitarte tu propio rol de administrador desde aquí.', () => {});
        pintarUsuarios();
        return;
    }
    db.ref('usuarios/' + uid + '/rol').set(nuevoRol).then(() => {
        registrarAccion('rol_cambiado', `${uid} → ${nuevoRol}`);
        setStatus('Rol actualizado ✓', 'ok');
    }).catch(e => console.error(e));
}

function toggleActivo(uid, estadoActual) {
    if (currentRol !== 'admin') return;
    if (uid === currentUID) {
        confirmar('No puedes desactivar tu propia cuenta.', () => {});
        return;
    }
    const nuevoEstado = !estadoActual;
    const usuario = usuariosCache.find(u => u.uid === uid);
    const mensaje = nuevoEstado
        ? `¿Reactivar el acceso de ${usuario?.email || uid}?`
        : `¿Desactivar el acceso de ${usuario?.email || uid}? No podrá iniciar sesión hasta que lo reactives.`;

    confirmar(mensaje, () => {
        const updates = { activo: nuevoEstado };
        // Si se reactiva y estaba rechazado, pasarlo a aprobado
        if (nuevoEstado && usuario?.estado === 'rechazado') {
            updates.estado = 'aprobado';
        }
        db.ref('usuarios/' + uid).update(updates).then(() => {
            registrarAccion(nuevoEstado ? 'usuario_activado' : 'usuario_desactivado', uid);
            setStatus(nuevoEstado ? 'Usuario activado ✓' : 'Usuario desactivado ✓', 'ok');
        }).catch(e => console.error(e));
    });
}

function enviarResetPassword(uid) {
    if (currentRol !== 'admin') return;
    const usuario = usuariosCache.find(u => u.uid === uid);
    if (!usuario?.email) return;

    confirmar(`¿Enviar un correo de restablecimiento de contraseña a ${usuario.email}?`, () => {
        const actionCodeSettings = { url: window.location.href };
        auth.sendPasswordResetEmail(usuario.email, actionCodeSettings).then(() => {
            registrarAccion('password_reset_enviado', usuario.email);
            setStatus('Correo enviado ✓ — pídele que revise spam/no deseado', 'ok');
        }).catch(err => {
            console.error('Error al enviar reset:', err.code, err.message);
            setStatus(traducirErrorReset(err.code), 'err');
        });
    });
}
