# Fase 6 — Turnos configurables y recordatorio de precios

Fecha: 2026-09-25 · Estado: aprobado. Planes: `docs/superpowers/plans/2026-09-25-fase-6-backend.md` y `../gasolineras-os-frontend/docs/superpowers/plans/2026-09-25-fase-6-frontend.md`.

Última fase del plan de 6 fases. Incluye además el cierre de los huecos abiertos de fases anteriores que bloquearían las pruebas en la estación.

## Objetivo

Antes de cada turno, el admin y el jefe de pista reciben un aviso para revisar o actualizar los precios del día en esa gasolinera. El aviso llega por correo (Resend) y por push de la PWA. Las horas de cada turno las configura el admin por gasolinera.

**Criterio de éxito:** 30 minutos antes del inicio de cada turno con recordatorio activo, cada admin y jefe de pista activo recibe **exactamente un** aviso por cada canal que tenga disponible. El aviso trae los precios vigentes (o dice que no hay precios cargados hoy) y un enlace a la pantalla de precios. El jefe de pista puede leer y editar los precios de las dos estaciones desde `/jefe`.

## Decisiones cerradas

| Tema | Decisión |
|---|---|
| Propósito del recordatorio | Revisar o actualizar precios |
| Modelo de turnos | Se mantienen `manana` y `tarde`; por gasolinera sólo se configuran `hora_inicio`/`hora_fin`. `despachos.turno` no cambia. |
| Mecanismo de disparo | Cron interno con `@nestjs/schedule`, cada minuto, en el backend |
| Destinatarios | Todos los usuarios activos con rol `admin` o `jefe_pista` |
| Push en modo demo | No existe. `sw.js` sólo se registra con `NEXT_PUBLIC_USE_MOCK=false`. |
| Cuadres por turno | Fuera de alcance. Las alertas falsas de "turno sin cuadrar" se eliminan del panel admin. |
| Offline / caché de la PWA | Fuera de alcance. `sw.js` no cachea nada. |

---

## 1. Backend: turnos y disparo

### 1.1 Datos

**`turnos_gasolinera`** (nueva)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `gasolinera_id` | uuid FK → `gasolineras.id`, not null | |
| `turno` | varchar not null | `'manana' \| 'tarde'` (mismo vocabulario que `despachos.turno`) |
| `hora_inicio` | `time` not null | Hora de Guatemala |
| `hora_fin` | `time` not null | Hora de Guatemala; puede ser menor que `hora_inicio` (el turno cruza la medianoche) |
| `recordatorio_activo` | boolean not null default `true` | |
| `updated_at` | timestamp default now | |

Índice único `(gasolinera_id, turno)`: cada gasolinera tiene exactamente una fila por turno.

La migración siembra, para cada gasolinera existente, `manana 06:00–14:00` y `tarde 14:00–22:00`. **Una gasolinera creada después** recibe las mismas dos filas por defecto dentro de la misma transacción de `GasolinerasService.create`.

**`recordatorios_turno`** (nueva): registro de avisos enviados; es a la vez el candado de idempotencia.

| Columna | Tipo |
|---|---|
| `id` | uuid PK |
| `gasolinera_id` | uuid FK not null |
| `turno` | varchar not null |
| `fecha` | `date` not null (fecha de Guatemala **del día en que arranca el turno**) |
| `enviado_en` | timestamp default now |
| `correos_enviados` | integer not null default 0 |
| `push_enviados` | integer not null default 0 |

Índice único `(gasolinera_id, turno, fecha)`.

**`suscripciones_push`** (nueva): ver §2.1.

### 1.2 Endpoints

| Método y ruta | Roles | Descripción |
|---|---|---|
| `GET /api/v1/gasolineras/:id/turnos` | admin, supervisor, jefe_pista | Las dos filas de la gasolinera |
| `PATCH /api/v1/gasolineras/:id/turnos/:turno` | admin | Body `{ hora_inicio?, hora_fin?, recordatorio_activo? }` |
| `GET /api/v1/turnos/actual?gasolinera_id=` | admin, supervisor | `{ turno: 'manana'\|'tarde'\|null }`. Para el supervisor, `gasolinera_id` sale de su usuario y el query se ignora. `null` si la hora actual no cae en ningún turno. |

**Validaciones del PATCH** (400 con mensaje en español):
- `hora_inicio`/`hora_fin` con formato `HH:mm` (24 h).
- `hora_inicio ≠ hora_fin`.
- El turno resultante no se solapa con el otro turno de la misma gasolinera. El solapamiento se calcula sobre intervalos de minutos del día, partiendo en dos los que cruzan la medianoche.
- `:turno` distinto de `manana`/`tarde` → 400.

Editar un turno cuyo recordatorio ya salió hoy **no** reenvía el aviso: la fila en `recordatorios_turno` ya existe para esa fecha.

### 1.3 Permisos corregidos para `jefe_pista`

Hoy `jefe_pista` puede escribir precios pero no leerlos. Se agrega `jefe_pista` a:
- `GET /precios-combustible` y `GET /precios-combustible/hoy`
- `GET /gasolineras` y `GET /gasolineras/:id`

### 1.4 Disparo

`RecordatoriosService` con `@Cron(CronExpression.EVERY_MINUTE)`. No hace nada si `RECORDATORIOS_ACTIVOS === 'false'`.

**Predicado puro** (`src/modules/turnos/turnos.util.ts`), sin dependencias de Nest ni de la BD:

```ts
debeRecordar(ahoraUtc: Date, horaInicio: string /* "HH:mm" */): { fecha: string /* YYYY-MM-DD */ } | null
```

- `ahoraUtc` es el instante UTC (`new Date()`); la función lo convierte internamente a hora de Guatemala (UTC−6 fijo, sin DST) con `ahoraGuatemala()`. *(Implementación: el texto original decía `ahoraGt`; se recibe el instante UTC para que ningún llamador tenga que convertir.)* Hoy `getGuatemalaTime()` es una función privada de `despachos.service.ts` que sólo devuelve `{dayName, totalMinutes}`. Se extrae a `src/common/hora-guatemala.ts` con una variante que devuelve fecha y minutos, y `despachos.service.ts` pasa a importarla, sin cambiar su comportamiento.
- Calcula el **próximo** inicio del turno: hoy a `horaInicio` si todavía no pasó, o mañana si ya pasó.
- Devuelve la fecha de ese inicio si `inicio − 30 min ≤ ahoraGt < inicio`; si no, `null`.
- **Por qué una ventana y no el minuto exacto:** si el backend estuvo caído a las 13:30 y levanta a las 13:41, el recordatorio de las 14:00 igual sale.

**Por cada tick:**
1. Leer los turnos con `recordatorio_activo = true` de gasolineras activas y no bloqueadas.
2. Para cada uno, evaluar `debeRecordar`. Si devuelve `{fecha}`:
3. `INSERT INTO recordatorios_turno (...) VALUES (...) ON CONFLICT (gasolinera_id, turno, fecha) DO NOTHING RETURNING id`. Si no hay fila, otro tick u otra instancia ya lo reclamó: se salta.
4. Armar el mensaje (§1.5), resolver destinatarios y enviar por los dos canales.
5. Actualizar `correos_enviados`/`push_enviados` en la fila.

Un fallo en un turno no aborta los demás: cada turno va en su propio `try/catch` y se registra con el `Logger` de Nest. El tick no lanza nunca.

**Garantía:** "como mucho una vez" por turno y día. Si el proceso muere entre el paso 3 y el envío, ese aviso se pierde. Se acepta: es un recordatorio, no una transacción, y reintentar arriesgaría duplicados.

### 1.5 Mensaje

Construido por una función pura `armarRecordatorio({ gasolinera, turno, horaInicio, precios })`, que devuelve `{ asunto, texto, html, push: { title, body, url } }`.

- **Asunto:** `Turno Tarde en {gasolinera} empieza a las 14:00: revisa los precios`
- **Cuerpo con precios:** la lista de `precios_combustible` de esa gasolinera con `fecha = hoy (GT)`, con nombres legibles (Súper, Regular, Diésel, Gas LP) y en formato `Q 32.450`.
- **Cuerpo sin precios:** `Todavía no hay precios cargados para hoy en {gasolinera}.`
- **Enlace:** `${FRONTEND_URL}/jefe` para el jefe de pista y `${FRONTEND_URL}/admin/precios` para el admin. `FRONTEND_URL` ya existe (CORS en `main.ts` y enlaces de reset en `password-reset.service.ts`).
- El HTML escapa el nombre de la gasolinera, igual que el resto de los correos de la Fase 2.

### 1.6 Destinatarios y canales

- Usuarios con `rol IN ('admin','jefe_pista')` y `activo = true`.
- **Correo:** a los que tienen `email`, vía `MailService` (Fase 2). Si el envío a uno falla, se registra y se sigue con los demás.
- **Push:** a todas las filas de `suscripciones_push` de esos usuarios, vía `PushService` (§2.1).
- Los canales son independientes: si Resend falla, el push sale igual, y al revés.

---

## 2. Push y frontend

### 2.1 Backend: suscripciones y envío

**`suscripciones_push`**

| Columna | Tipo |
|---|---|
| `id` | uuid PK |
| `usuario_id` | uuid FK → `usuarios.id` on delete cascade, not null |
| `endpoint` | text **unique** not null |
| `p256dh` | varchar not null |
| `auth` | varchar not null |
| `user_agent` | varchar null |
| `created_at` | timestamp default now |

**Endpoints**

| Método y ruta | Roles | Descripción |
|---|---|---|
| `GET /api/v1/push/vapid-public-key` | pública | `{ key: string \| null }`; `null` si el push está desactivado |
| `POST /api/v1/push/suscripciones` | admin, jefe_pista | Body `{ endpoint, keys: { p256dh, auth } }`. Upsert por `endpoint`: si ya existía, se reasigna al usuario actual. |
| `DELETE /api/v1/push/suscripciones` | admin, jefe_pista | Body `{ endpoint }`. Borra sólo si pertenece al usuario actual. |

Los DTOs llevan decoradores de `class-validator` en todos los campos (`forbidNonWhitelisted`).

**`PushService`**: token de inyección abstracto con dos implementaciones, el mismo patrón que `MailService` y `StorageService`.
- `WebPushService` (librería `web-push`) en producción.
- `InMemoryPushService` en los e2e; guarda los envíos para que los tests los inspeccionen.
- `enviar` devuelve `'ok' | 'expirada' | 'error'`; 404 y 410 son `'expirada'`. `SuscripcionesPushService` borra las filas expiradas, así `WebPushService` no toca la BD. Otros errores se registran sin borrar.

**Variables de entorno** (todas opcionales):
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (p. ej. `mailto:admin@…`). Si falta cualquiera, el push queda desactivado: warning en el log, `vapid-public-key` devuelve `null` y el backend arranca igual.
- `RECORDATORIOS_ACTIVOS` (por defecto `true`).
- Script `pnpm vapid:generate`, que imprime un par de claves nuevo.
- Se documentan en `.env.example`.

### 2.2 PWA

- **`public/manifest.webmanifest`:** `name` "EstacionFlow", `display: standalone`, `theme_color`/`background_color` = `--brand-navy` (`#002262`; el manifest no puede leer variables CSS), íconos PNG de 192 y 512 derivados de `logo-estacion.svg`. Se enlaza desde el `metadata` del layout raíz. Es necesario para push en iPhone (iOS 16.4+, sólo con la app instalada en la pantalla de inicio).
- **`public/sw.js`:** sólo los listeners `push` (muestra la notificación con `title`, `body` e ícono) y `notificationclick` (enfoca una pestaña abierta o abre `data.url`). Sin `fetch` handler y sin caché.
- **Registro:** `src/lib/push.ts` registra `/sw.js` **sólo si** `NEXT_PUBLIC_USE_MOCK === 'false'`, para no pelear el scope `/` con `mockServiceWorker.js`.
- **Middleware:** `sw.js`, `manifest.webmanifest` y los íconos se agregan a la exclusión del `matcher`.
- **CSP:** ya permite `worker-src 'self' blob:` y `manifest-src 'self'`. Se verifica que `connect-src` no bloquee la suscripción; los push services del navegador los contacta el propio navegador, no la página.

### 2.3 Pantallas

- **`/admin/turnos`** (nueva, en el menú del admin): una tarjeta por gasolinera con dos filas (Mañana, Tarde), inputs `time` de inicio y fin, interruptor "Recordatorio" y botón Guardar por fila. Los errores del backend se muestran tal cual. Sigue el Design System: bordes 0.5px, variables CSS, DM Sans, horas en tabular-nums.
- **Botón "Notificaciones"** en el encabezado del admin y del jefe de pista, a cargo de un componente `NotificacionesToggle`. Estados visibles: *No soportado* (sin `PushManager`, o iPhone sin instalar, con una línea que explica cómo instalar), *Bloqueadas* (permiso `denied`), *Activas* (suscrito) y *Desactivadas*. Activar: pedir permiso → `pushManager.subscribe` con la clave VAPID → `POST`. Desactivar: `unsubscribe` → `DELETE`. Si el backend devuelve `key: null`, el botón no se muestra.
- **`DespachoForm`:** `getTurnoDefault()` se reemplaza por `GET /turnos/actual`. Si falla o devuelve `null`, cae al cálculo local actual. El select sigue siendo editable.
- **Panel admin (`admin/page.tsx`):** se eliminan las alertas de turno basadas en `mockTurnos` y su import de `mock-data`.
- **Capa de datos:** `src/lib/api/turnos.ts` y `src/lib/api/push.ts` sobre `http.ts`; tipos en `src/types/index.ts`.
- **MSW:** handlers para `GET/PATCH /gasolineras/:id/turnos` y `GET /turnos/actual`, más datos semilla en `src/mocks/db.ts`. `vapid-public-key` devuelve `{ key: null }` en demo, así que el botón de notificaciones no aparece.

---

## 3. Cierre de huecos de fases anteriores

| # | Hueco | Cambio |
|---|---|---|
| H1 | El operario se guarda y nunca se lee | `findOne` y `findAll` de despachos hacen `leftJoin` con `operarios` y devuelven `operario: { id, nombre } \| null`. Columna "Operario" en el Excel. Línea `Operario: {nombre}` en `ValeImpresion` (original y copia) debajo de "Despachado por". Mapper y tipo actualizados. |
| H2 | Sin validación de negocio de `operario_id` | Antes de la transacción: el operario existe, `activo = true` y `gasolinera_id` coincide con la de la gasolinera del despacho. Si no, 400: `El operario no pertenece a esta gasolinera o está inactivo.` |
| H3 | "Reimprimir vale" imprime en blanco | `admin/despachos/page.tsx` monta `ValeImpresion` con el despacho seleccionado (incluye `detalles` y `operario`) y llama a `imprimirVale()`. Se elimina el `window.print()` suelto. |
| H4 | `/jefe` es un stub | Pantalla propia: las dos gasolineras lado a lado, precio del día por combustible, editable por estación (`POST` si no hay precio hoy, `PATCH` si lo hay), y botón "Copiar a la otra estación" que llena los campos de la otra columna sin guardar hasta confirmar. Usa `layout.tsx` de `/jefe` y lleva el `NotificacionesToggle`. |
| H5 | Cookies `ef_session` con `rol="operario"` | En `middleware.ts`, `operario` se normaliza a `supervisor`, con un comentario que marca la fecha para quitarlo. |
| H6 | Diferencia entre esquema y migración en `usuarios_email_o_telefono_chk` | Se declara el `check()` en `usuarios.schema.ts`. Al correr `db:generate`, si Drizzle emite un `ADD CONSTRAINT` duplicado, el SQL de esa migración se reemplaza a mano por `-- constraint ya existente desde 0001` y se conserva el snapshot. Resultado esperado: un `db:generate` posterior no produce cambios. |
| H7 | La paginación de despachos se estima | `GET /despachos` devuelve `{ data, total, page, limit }`. **Cambio de contrato:** se documenta en `contrato-frontend.md` y se actualizan `listDespachos`, el mapper y el handler MSW en el mismo cambio. Se revisan antes los otros consumidores de `GET /despachos` (portal cliente, historial del supervisor, e2e). |
| H9 | "Hoy" se calcula en UTC (hallado al planear) | `despachos.service.ts` y `precios-combustible.service.ts` usan `new Date().toISOString()`: de 18:00 a 23:59 GT buscan el precio de mañana y **todo despacho falla**. Los filtros `fecha_desde`/`fecha_hasta` de despachos, Excel, reportes y saldos comparan `timestamp::date` en UTC. Todo "hoy" pasa a `src/common/hora-guatemala.ts`, los filtros usan `(col - INTERVAL '6 hours')::date` y los e2e usan la misma fecha. |
| H8 | 3 pantallas marcadas `feat(wip)` en `c70d871` | `DiagnosticChecklist` (dentro de `DespachoForm`), `/admin/control` (en el menú) y `VehiculoRestriccionesModal` (en Flota). **Se auditan primero y el resultado se presenta a Milton antes de tocarlas.** Criterio: si falta poco, se termina; si falta mucho, se oculta de la navegación o del render. |

Fuera de alcance: mover `reportes` y `saldos` al backend (hoy se derivan en el cliente y funcionan).

---

## 4. Pruebas

**Unitarias en el backend** (Jest, `src/**/*.spec.ts`):
- `debeRecordar`: dentro de la ventana; borde inferior exacto (`inicio − 30`, dispara); borde superior (`inicio`, no dispara); fuera de ventana; inicio a las 00:15 evaluado a las 23:50 del día anterior (fecha = día siguiente); inicio a las 00:00.
- Solapamiento de turnos: normales, contiguos (14:00/14:00, válido), cruzando la medianoche, solapados.
- `armarRecordatorio`: con precios, sin precios, escape de HTML, enlace según rol.
- `WebPushService`: con `web-push` simulado, 404/410 → `'expirada'`, 500 → `'error'`, y sin VAPID no envía. El borrado efectivo se prueba en e2e.
- `RecordatoriosService.tick` con repositorio y servicios falsos: un fallo en un turno no impide los demás; con `RECORDATORIOS_ACTIVOS=false` no hace nada.

**e2e en el backend** (`test/gasfuel.e2e-spec.ts` o un archivo nuevo `test/turnos.e2e-spec.ts`):
- Turnos: GET por rol, PATCH de admin, 403 para supervisor y jefe, cada validación con su 400, y creación de gasolinera con turnos por defecto.
- `GET /turnos/actual`, con la hora controlada por un reloj inyectable.
- Idempotencia: ejecutar `tick()` dos veces con el mismo reloj produce una fila en `recordatorios_turno`, un correo por destinatario con email y un push por suscripción, todo en los servicios de memoria.
- Suscripciones push: alta, upsert por endpoint, baja propia, 404 al borrar una ajena y 403 para supervisor y cliente.
- Permisos de lectura de precios para `jefe_pista`.
- H1, H2, H7: operario en detalle y listado, 400 por operario de otra estación o inactivo, y `total` correcto con paginación.

Para probar el tiempo sin esperar al reloj real, `RecordatoriosService.ejecutar(ahoraUtc)` y `TurnosService.turnoActual(gasolineraId, ahoraUtc)` reciben el instante como parámetro. El cron y los controllers pasan `new Date()`; los tests, un instante fijo.

**Frontend:** `type-check`, `lint` y `build` limpios. Verificación manual en el navegador contra el backend real: configurar turnos, activar notificaciones, forzar un disparo y recibir el push; preselección del turno; reimpresión del vale; pantalla `/jefe` con copiar a la otra estación. Los tests unitarios del frontend son el siguiente subproyecto (montar runner).

## 5. Orden de trabajo

Igual que en las fases anteriores: migración → endpoints → e2e → `docs/contrato-frontend.md` → tipos/API/UI del frontend → handlers MSW. La auditoría de H8 va al principio, porque su resultado puede cambiar el alcance.

## 6. Riesgos

- **Hora de Guatemala:** todo el cálculo pasa por el helper UTC−6 compartido (§1.4). `@nestjs/schedule` corre en la zona del proceso, así que el cron sólo "despierta" y nunca decide con la hora local.
- **Dos service workers:** mitigado registrando `sw.js` sólo fuera del modo demo. Si un navegador conserva registrado el SW de MSW de una sesión demo anterior, `src/lib/push.ts` lo desregistra antes de registrar `sw.js`.
- **iPhone:** push sólo con la PWA instalada. El botón lo explica en lugar de fallar en silencio.
- **H7 cambia la forma de la respuesta** de `GET /despachos`. Riesgo de romper consumidores no revisados; mitigado con la revisión previa y los e2e.

---

## 6. Desviaciones de la implementación

Lo que quedó distinto de lo planeado al construir el backend:

- `debeRecordar` recibe el instante UTC (ver §1.4), no la hora GT.
- H9 también se aplicó a `ventas-insumos.service.ts` (`vendido_at`) y a `reportes/pdf/reportes-pdf.service.ts` (`despachado_at`), además de los archivos listados.
- La migración `0006` necesitó casts `::time` en el seed de turnos; la línea duplicada del CHECK de H6 se reemplazó por `-- constraint ya existente desde 0001`.
- `escaparHtml` se movió a `src/common/escapar-html.ts` y lo comparten el reset de contraseña y el mensaje del recordatorio.
- `CrearSuscripcionDto.keys` lleva `@IsDefined()`: un body sin `keys` responde 400, no 500.
- `@nestjs/schedule@12.0.2` es sólo ESM. Jest (`package.json` y `test/jest-e2e.json`) transforma ese paquete con ts-jest; la app compilada depende de `require(esm)` de Node, que exige **Node >= 22.12**. No se añadió `engines`.
- Los tres suites e2e fijan `RECORDATORIOS_ACTIVOS=false` para que el cron real no corra durante las pruebas.
- `onConflictDoNothing` en `recordatorios_turno` usa el target explícito `(gasolinera_id, turno, fecha)`.
