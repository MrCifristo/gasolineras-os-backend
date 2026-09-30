# Contrato API ↔ Frontend

**Estado:** Aprobado — 2026-07-15
**Alcance:** decisiones vinculantes para la migración a auth interno + backend real.

El backend (`gasolineras-os-backend`) y el frontend (`estacionflow-frontend`) son repos separados y **nunca se han hablado**: el frontend corre sobre mocks y el backend solo lo ejercita su e2e. Este documento fija el contrato para que ambos lados puedan avanzar en paralelo sin adivinar.

Cada punto de abajo era una divergencia real y verificada entre los dos lados. Ninguno es hipotético.

---

## 1. Sesión y tokens

**Divergencia:** `src/lib/auth.ts:66` del frontend lee `data.user`, pero `auth.service.ts` devuelve el usuario bajo `usuario`. El login fallaba en silencio y sin mensaje de error. Además el `access_token` que devuelve el backend nunca se guardaba, y `src/lib/api.ts:21` mandaba `value.token` desde una cookie que no tiene esa llave — o sea, `Bearer ` vacío y 401 en todo.

**Decisión:**

`POST /api/v1/auth/login` recibe **`identificador`** (correo **o** teléfono) + `password`
—ya no `email`— y devuelve los tokens **en el body**, no como `Set-Cookie`:

```jsonc
// body: { "identificador": "correo o teléfono", "password": "..." }
{
  "access_token": "<jwt>",     // 15 min
  "refresh_token": "<opaco>",  // 30d supervisor, 7d admin/cliente/jefe_pista
  "usuario": {                 // "usuario", NO "user"
    "id": "uuid",
    "email": "... | null",     // email OPCIONAL: un usuario puede tener sólo teléfono
    "telefono": "... | null",
    "nombre": "...",
    "rol": "admin" | "supervisor" | "cliente" | "jefe_pista",
    "gasolinera_id": "uuid | null",
    "cliente_id": "uuid | null"
  }
}
```

> **Roles renombrados/añadidos:** `operario` → **`supervisor`** (el que inicia sesión en la
> tablet). Nuevo **`jefe_pista`** (sólo cambia precios de ambas gasolineras). El operario que
> físicamente despacha ya no es una cuenta: es una fila de `operarios` (sin login) que el
> supervisor elige de un listado. Ver `POST /api/v1/despachos.operario_id` (§2) y
> `GET /api/v1/operarios?gasolinera_id=`.

El backend es una **API bearer pura** y JWT estándar. El navegador la consume **directo** (no hay BFF ni proxy intermedio): el frontend guarda `access_token`/`refresh_token` de la respuesta y los manda como `Authorization: Bearer` en cada request (`src/lib/api/http.ts`). `AuthGuard` valida ese Bearer.

- Con el token en el header (no en cookie ambiental), **CSRF no aplica**: el navegador no adjunta el `Authorization` solo, así que no hay maquinaria anti-CSRF que mantener.
- El middleware de Next (`src/middleware.ts`) sólo lee el `rol` de la cookie de sesión para decidir a qué panel mandar; **no valida la firma**. La autorización real la hace el guard del backend en cada llamada, así que una cookie manipulada no da acceso a ningún dato.
- La suite e2e usa `Authorization: Bearer`, igual que el navegador.

---

## 1b. Contraseñas: alta, recuperación y reset del admin

**Alta.** `password` es **opcional** en `POST /api/v1/usuarios`. Si se omite, el servidor genera una y la respuesta trae **`password_temporal` en claro**:

```jsonc
// respuesta de POST /usuarios (201)
{ "id": "uuid", "email": "...", "rol": "supervisor", /* … */,
  "password_temporal": "Kx7mQp2rTn9v" }   // sólo en esta respuesta
```

Ese texto plano **no se persiste y no vuelve a estar disponible**: es la única oportunidad de mostrarlo o descargarlo. `password_hash` nunca sale en ninguna respuesta.

Al crear un usuario con `rol: "cliente"` **y** correo, el backend le manda automáticamente el enlace de recuperación para que elija su propia contraseña. El envío es *fire-and-forget*: si el proveedor falla, el alta igual devuelve 201 (el usuario ya existe y su `password_temporal` sirve).

**Recuperación (público, sin token de sesión).**

| Endpoint | Body | Respuesta |
|---|---|---|
| `POST /api/v1/auth/password/solicitar` | `{ "identificador": "correo o teléfono" }` | **204 siempre** |
| `POST /api/v1/auth/password/reset` | `{ "token": "...", "password": "min 8" }` | 204, o 400 |

`solicitar` responde **204 en todos los casos** — exista o no el identificador, tenga o no correo, falle o no el proveedor. No hay forma de distinguirlos, y es a propósito: cualquier diferencia convertiría el endpoint en un oráculo para enumerar cuentas. **El frontend no debe intentar inferir nada de la respuesta**; muestra siempre el mismo mensaje ("si la cuenta existe, te llegará un correo").

El enlace del correo apunta a `${FRONTEND_URL}/reset?token=<token>`, así que el frontend necesita una ruta pública `/reset` que lea `token` del query string, y `/recuperar` para pedirlo. Ambas van **fuera** del matcher de autenticación del middleware.

El token vence en **60 minutos**, sirve **una sola vez**, y **cada solicitud nueva invalida la anterior**. Cualquier fallo —token inexistente, vencido, ya usado o de un usuario inactivo— devuelve el mismo 400 con el mismo mensaje. Un reset exitoso **revoca todas las sesiones abiertas** del usuario: los tokens que el frontend tuviera guardados pasan a dar 401 y hay que reloguear.

**Reset por el admin.** `POST /api/v1/usuarios/:id/reset-password`, `@Auth("admin")`, body `{ "modo": "generar" | "enlace" }`:

- `"generar"` → `{ "password_temporal": "..." }` y revoca las sesiones del usuario.
- `"enlace"` → `{ "enviado": true }`, manda el correo y **no** devuelve credencial. Da **400** si el usuario no tiene correo registrado.

Ambos responden **201** (es un `POST` sin `@HttpCode`), no 200.

Los límites de tasa aplican: `solicitar` 5/min, `reset` 10/min, por IP.

---

## 1c. Capa financiera: crédito, saldo inicial y estado de cuenta

**`credito_bloqueado` es un flag distinto de `bloqueado`.** No los mezclen en la UI:

| Flag | Qué significa | Efecto |
|---|---|---|
| `bloqueado` | El cliente suspendió su cuenta entera | Ningún despacho. Mensaje: *"Cuenta bloqueada por el cliente"* |
| `credito_bloqueado` | La estación le cortó el crédito (mora, decisión administrativa) | Ningún despacho, pero la cuenta sigue viva: se consulta, se abona y se emite estado de cuenta. Mensaje: *"Crédito suspendido — consulte con administración"* |

Ambos son `boolean` en `clientes` y se editan por `POST`/`PATCH /clientes`. `GET /despachos/vehiculo/:id/consumo-hoy` ahora devuelve **`cliente_credito_bloqueado`** junto a `cliente_bloqueado`, para que el checklist del operario diga cuál de los dos es.

**Saldo inicial.** `POST /clientes` acepta `saldo_inicial` (número, `>= 0`, opcional). **No es una columna**: abre la cuenta con ese saldo y deja un movimiento `credito` con descripción `"Saldo inicial"` y **`gasolinera_id: null`**, porque una apertura no ocurre en ninguna estación.

> Consecuencia para el frontend: **`movimientos_saldo.gasolinera_id` ahora puede venir `null`**. Toda tabla o agrupación por estación tiene que contemplarlo (mostrar "—", no romper).

`saldo_inicial` **no se acepta en `PATCH /clientes/:id`** — devuelve 400. Una apertura no se reescribe; para corregir el saldo se registra un abono, que deja rastro en el ledger.

**Estado de cuenta.** `GET /api/v1/saldos/cliente/:id/estado-cuenta?fecha_desde&fecha_hasta`, `@Auth("admin")`:

```jsonc
{
  "cliente": { "id": "uuid", "nombre": "...", "nit": "...", "credito_bloqueado": false },
  "periodo": { "fecha_desde": "2026-08-01", "fecha_hasta": "2026-08-31" },
  "saldo_inicial": "5000.000",   // todo el ledger ANTERIOR a fecha_desde, resumido
  "total_abonos":  "1500.000",
  "total_debitos": "2280.000",
  "saldo_final":   "4220.000",
  "movimientos": [ /* filas de movimientos_saldo del rango, ascendente */ ]
}
```

Los cuatro totales son **strings** con 3 decimales, como el resto de los numéricos del seam: coercionarlos en `mappers.ts`. Se cumple siempre `saldo_inicial + total_abonos − total_debitos = saldo_final`. Sin `fecha_desde`, `saldo_inicial` es `0` y todo el histórico cae dentro del período.

En cada movimiento el `monto` es **positivo** y el signo lo pone `tipo` (`credito` suma, `debito` resta). El saldo corriente por fila hay que acumularlo en el cliente.

**PDF**: `GET .../estado-cuenta/pdf` con los mismos parámetros, devuelve `application/pdf` como descarga.

Un **saldo negativo es válido y esperado**: no hay control de fondos insuficientes, las cuentas se van a negativo a propósito.

---

## 1d. Vale multi-renglón: canecas y toneles

Un vale puede repartirse entre el vehículo, canecas y toneles, **en cualquier combinación, incluso sin vehículo**. Cada renglón lleva su propio combustible y su propio monto; el vale unifica el total.

**Forma nueva** de `POST /api/v1/despachos`:

```jsonc
{
  "cliente_id": "uuid",
  "operario_id": "uuid",
  "turno": "manana",
  "vehiculo_id": "uuid",   // OPCIONAL — omitir en un vale sólo de contenedores
  "piloto_id": "uuid",     // OPCIONAL — pero va junto con vehiculo_id
  "detalles": [
    { "renglon": "vehiculo", "tipo_combustible": "diesel", "monto": "300.000" },
    { "renglon": "caneca",   "tipo_combustible": "super",  "monto": "400.000" }
  ]
}
```

`renglon` es `"vehiculo" | "caneca" | "tonel"`. Entre 1 y 10 renglones, cada monto mayor que cero.

**La forma vieja sigue funcionando**: `tipo_combustible` + `monto` en la raíz equivalen a un único renglón `vehiculo`. Mandar las dos formas a la vez es un **400**, igual que mandar ninguna.

Reglas que devuelven **400**:
- `vehiculo_id` sin `piloto_id`, o al revés.
- Un renglón `vehiculo` sin `vehiculo_id`.
- `vehiculo_id` presente pero ningún renglón `vehiculo`.

**Respuesta**: el vale creado con un arreglo `detalles`, donde cada entrada trae `renglon`, `tipo_combustible`, `monto`, `galones` y `precio_galon`. El frontend tiene todo para imprimir sin una segunda llamada. `monto_total` y `galones` del header son la **suma** de los renglones.

**Lo que cambia al leer:**
- `despachos.vehiculo_id`, `piloto_id` y `precio_id` ahora pueden ser **`null`**. `GET /despachos/:id` devuelve `vehiculo: null` y `piloto: null` en esos vales, más `detalles[]`. Los tipos del frontend y el vale impreso deben tolerarlo.
- El filtro `?tipo_combustible=` busca en los **renglones**, no en el precio del header: un vale cuyo super fue a una caneca ahora aparece en ese filtro.
- El Excel suma una columna **Renglones** con el desglose (`diesel 20.000 gal + caneca super 5.000 gal`).

**Límites, y esto importa:** los límites del vehículo (monto y volumen, por transacción y acumulados) miden **sólo los renglones `vehiculo`**. Cobrarle al vehículo el combustible que se fue en canecas le comería su cupo. Los límites de la **cuenta** y el débito de saldo sí usan el **total** del vale. Un vale mixto cuenta como **una** transacción.

Un vale sigue siendo **una fila header**, así que la numeración por advisory lock no cambió y los números siguen sin repetirse.

---

## 1e. Inventario de insumos y sus ventas

La estación vende insumos (aceites, refrigerante, filtros) aparte del combustible.

**Catálogo** — `/api/v1/inventario/productos`. `GET` es `admin` + `supervisor` (el supervisor necesita el catálogo para vender en la bomba); `POST`, `PATCH` y `DELETE` son sólo `admin`. `DELETE` es baja lógica.

`stock_actual` **no se puede editar por `PATCH`** — devuelve 400. El stock sólo se mueve con `POST /inventario/productos/:id/stock` (`{ tipo: "entrada"|"salida", cantidad, motivo?, referencia? }`, `admin` + `supervisor`), que deja el movimiento en el kardex. Editarlo a mano dejaría un faltante que después nadie puede explicar.

`GET /inventario/productos/bajos` lista lo que está en o por debajo de su `stock_minimo`. `GET /inventario/productos/:id/movimientos` es el kardex (`admin`).

**A diferencia del saldo del cliente, el stock nunca queda negativo**: una salida que lo dejaría bajo cero devuelve 400 con `"Stock insuficiente…"`.

**Ventas** — `POST /api/v1/ventas-insumos`, `admin` + `supervisor`:

```jsonc
{
  "forma_pago": "efectivo" | "cargo_cliente",
  "cliente_id": "uuid",      // OBLIGATORIO con cargo_cliente, PROHIBIDO con efectivo (400)
  "operario_id": "uuid",     // opcional: quién entregó
  "bomba_numero": 1,         // opcional, pero sólo 1 o 3 (400 en cualquier otra)
  "detalles": [{ "producto_id": "uuid", "cantidad": 2 }]
}
```

La diferencia de fondo entre las dos formas de pago:

| | efectivo | cargo_cliente |
|---|---|---|
| Stock | descuenta | descuenta |
| Kardex | movimiento de salida | movimiento de salida |
| Saldo del cliente | **no lo toca** | lo debita |
| Estado de cuenta | no aparece | **aparece**, junto al combustible |

Un producto no puede repetirse en dos renglones (400): agrupá la cantidad. Una venta que exceda el stock se rechaza **entera**, no parcialmente. Un cliente bloqueado o con crédito suspendido no acepta cargos.

Las ventas llevan **su propia serie de vale**, independiente de la de combustible: son documentos distintos y numerarlos juntos haría ilegible la conciliación. `precio_unitario` queda congelado en el renglón, así que cambiar el precio del producto no reescribe ventas pasadas.

`GET /ventas-insumos` y `GET /ventas-insumos/:id` aplican el mismo scoping por rol que despachos: el supervisor ve su estación, el cliente sólo lo suyo.

---

## 1f. Fase 6: turnos, recordatorios y push

### Hora de Guatemala (H9)

**"Hoy" es siempre la fecha de Guatemala (UTC−6 fijo, sin DST), nunca la del servidor ni la UTC.** Aplica al precio vigente al despachar, a `GET /precios-combustible/hoy`, a los filtros `fecha_desde`/`fecha_hasta` (despachos, Excel, reportes, saldos, ventas de insumos) y al turno vigente. Antes, de 18:00 a 23:59 GT el servidor buscaba el precio de mañana y todo despacho fallaba con "No hay precio registrado". El frontend debe calcular su "hoy" igual (UTC−6) y no con `toISOString()`.

### Turnos — `/api/v1/gasolineras/:id/turnos`

Cada gasolinera nace con dos turnos (`manana` 06:00–14:00 y `tarde` 14:00–22:00, recordatorio activo). Las horas viajan como `"HH:mm"` de 24 h.

`GET /gasolineras/:id/turnos` — `admin`, `supervisor`, `jefe_pista`. Siempre dos filas, `manana` primero. 404 si la gasolinera no existe.

```jsonc
[
  { "id": "uuid", "gasolinera_id": "uuid", "turno": "manana",
    "hora_inicio": "06:00", "hora_fin": "14:00", "recordatorio_activo": true,
    "updated_at": "2026-09-25T15:04:05.000Z" },
  { "id": "uuid", "gasolinera_id": "uuid", "turno": "tarde",
    "hora_inicio": "14:00", "hora_fin": "22:00", "recordatorio_activo": true,
    "updated_at": null }
]
```

`PATCH /gasolineras/:id/turnos/:turno` — sólo `admin`. `:turno` es `manana` o `tarde` (otro valor: 400). Todos los campos del body son opcionales, pero debe venir al menos uno:

```jsonc
{ "hora_inicio": "05:30", "hora_fin": "13:30", "recordatorio_activo": false }
```

Responde la fila actualizada (misma forma que arriba). Errores 400, todos en español: formato distinto de `HH:mm`; `hora_inicio` igual a `hora_fin`; solapamiento con el otro turno (`"El turno se solapa con el turno de la tarde (14:00–22:00)"`; turnos contiguos como 06:00–14:00 y 14:00–22:00 son válidos; un turno puede cruzar la medianoche); body vacío (`"No hay cambios que guardar"`); campos desconocidos (`forbidNonWhitelisted`). Supervisor y jefe de pista reciben 403.

`GET /turnos/actual?gasolinera_id=` — `admin`, `supervisor`. Responde el turno vigente según la hora de Guatemala, o `null` fuera de ambos horarios:

```jsonc
{ "turno": "manana" }   // "manana" | "tarde" | null
```

El supervisor **siempre** recibe el de su propia gasolinera: el query se ignora. El admin debe mandar `gasolinera_id` (400 `"Falta gasolinera_id"` si no).

### Recordatorio de precios

Un cron interno corre cada minuto y, 30 minutos antes del inicio de cada turno con `recordatorio_activo`, avisa a todos los usuarios activos `admin` y `jefe_pista` por correo (Resend) y por push. Sale **una sola vez** por (gasolinera, turno, fecha GT). No hay endpoint: es efecto lateral. Se apaga con `RECORDATORIOS_ACTIVOS=false`.

### Push — `/api/v1/push`

`GET /push/vapid-public-key` — **pública** (sin token; la clave VAPID pública no es secreta):

```jsonc
{ "key": "BPx…" }   // null si el backend no tiene VAPID configurado: el push está desactivado
```

`POST /push/suscripciones` — `admin`, `jefe_pista`. Body: el `PushSubscription.toJSON()` del navegador **sin** `expirationTime` (está prohibido: `forbidNonWhitelisted` lo rechaza con 400):

```jsonc
{ "endpoint": "https://fcm.googleapis.com/fcm/send/…",
  "keys": { "p256dh": "…", "auth": "…" } }
```

Responde `201 { "ok": true }`. Es un upsert por `endpoint`: si el mismo navegador inicia sesión con otro usuario, la suscripción pasa al nuevo. El `endpoint` debe ser `https`; `keys` es obligatorio (sin `keys`: 400). Supervisor y cliente reciben 403.

`DELETE /push/suscripciones` — `admin`, `jefe_pista`. Body `{ "endpoint": "…" }`. Responde `200 { "ok": true }`; 404 `"Suscripción no encontrada"` si no existe **o si es de otro usuario**. El backend también borra por su cuenta las suscripciones que el servicio push declara expiradas (404/410).

### `GET /despachos`: nueva forma paginada (cambio de contrato, H7)

Ya **no** responde un arreglo. Ahora:

```jsonc
{
  "data": [ { /* columnas de despachos */, "operario": { "id": "uuid", "nombre": "Juan Pérez" } /* o null */ } ],
  "total": 137,   // filas que cumplen los filtros, sin paginar
  "page": 1,
  "limit": 20
}
```

`page` (default 1) y `limit` (default 20) siguen siendo query params. `total` ya cuenta con los filtros aplicados, así que el frontend deja de adivinar si hay más páginas. Los filtros y el scoping por rol no cambian.

### `operario` en las respuestas (H1/H2)

- Cada fila de `GET /despachos` y `GET /despachos/:id` (dentro del objeto de respuesta, junto a `despacho`, `vehiculo`, `piloto`, …) incluyen `operario: { id, nombre } | null`. Es `null` en los vales anteriores a la Fase 1, que no tenían operario.
- El Excel de despachos tiene una columna "Operario".
- `POST /despachos` valida `operario_id`: debe existir, estar activo y ser de la **misma gasolinera** del despacho. Si no, 400 `"El operario no pertenece a esta gasolinera o está inactivo."`.

### Permisos de lectura del jefe de pista

`jefe_pista` ahora puede leer, además de escribir precios: `GET /gasolineras`, `GET /gasolineras/:id`, `GET /precios-combustible` y `GET /precios-combustible/hoy`. Y `GET /gasolineras/:id/turnos`.

`GET /precios-combustible/hoy?gasolinera_id=` devuelve los precios vigentes hoy (fecha GT) de esa gasolinera. `admin` y `jefe_pista` eligen la gasolinera (sin `gasolinera_id`: 400 `"Falta gasolinera_id"`); el supervisor recibe siempre la suya y el query se ignora.

---

## 2. Crear despacho: se manda `monto`, no `galones`

**Divergencia:** `CreateDespachoDto` exige `galones: string` (`@IsNumberString`) y no tiene campo `monto`. Pero el operario **teclea quetzales en la bomba** (commits `5552543`/`49a1ed9`/`57cc894` movieron el formulario a eso deliberadamente), y `DespachoForm.tsx:143` deriva galones en el navegador. Con `forbidNonWhitelisted: true`, mandar `monto` es un 400 duro.

**Decisión: el frontend manda `monto`; el backend deriva `galones`.**

Motivo: si el frontend calcula `galones = monto / precio` y lo manda, el backend recalcula `monto = galones × precio` y **por redondeo no da el monto tecleado**. El vale terminaría con un total distinto al que pagó el cliente. Eso es un problema de recibo, no de UX.

El precio autoritativo vive en el servidor. El frontend nunca calcula dinero.

```jsonc
// POST /api/v1/despachos
{
  "cliente_id": "uuid",
  "vehiculo_id": "uuid",
  "piloto_id": "uuid",
  "operario_id": "uuid",     // ← operario elegido del listado (NO el supervisor logueado)
  "turno": "manana" | "tarde",
  "tipo_combustible": "diesel" | "super" | "regular" | "gas_lp",
  "monto": "1552.05",        // ← lo que teclea el supervisor
  "bomba_numero": 3,         // opcional
  "kilometraje": "187420",   // opcional
  "firma_piloto_base64": "data:image/png;base64,..."
}
```

`galones = monto / precio_galon`, redondeado a 3 decimales, calculado server-side. `monto_total` es exactamente el `monto` recibido.

> `monto_total` se sigue calculando **antes** de abrir la transacción, igual que hoy. Toda la cascada de validación previa al `pg_advisory_xact_lock` es TOCTOU-racy por diseño; eso no cambia.

---

## 3. `serie_vale` sale de la gasolinera, no del cliente

**Divergencia:** el backend lo exige (`@IsNotEmpty`) y es parte del índice único `(gasolinera_id, serie_vale, numero_vale)`. El frontend **nunca lo manda**. No existía dónde configurarlo: `gasolineras` no tenía la columna. Los mocks usan `'A'` hardcodeado.

**Decisión: una serie activa por gasolinera.**

- Nueva columna `gasolineras.serie_vale_actual varchar NOT NULL DEFAULT 'A'`.
- El admin la cambia al abrir un talonario nuevo.
- El backend la lee de la gasolinera del operario. **`serie_vale` sale de `CreateDespachoDto`**: el cliente no lo manda ni puede influirlo.

Encaja con el `pg_advisory_xact_lock(hashtext(gasolinera_id || ':' || serie_vale))` que ya serializa la numeración por gasolinera+serie.

---

## 4. `estado` no existe

**Divergencia:** `Despacho.estado` y `DespachoFilters.estado` existen solo en el frontend (`src/types/index.ts`). No hay columna `estado` en `despachos.schema.ts` ni query param que lo acepte.

**Decisión: eliminar `estado` del frontend.** Es un campo fantasma de la época de los mocks. Todo despacho persistido está, por definición, completado: la fila solo existe si la transacción hizo commit. Mandarlo como filtro sería un 400.

---

## 5. Los numéricos viajan como string

**Divergencia — la más peligrosa.** Drizzle `numeric` devuelve **strings** vía node-postgres. `despachos.galones`, `monto_total`, `kilometraje` y `precios_combustible.precio_galon` son todos `numeric`. Pero `src/types/index.ts` los declara `number`, y `ValeImpresion.tsx:116-118` hace `.toFixed()` sobre ellos.

En cuanto salgan los mocks: `TypeError: toFixed is not a function`, **a media impresión, en la tablet de la bomba**. TypeScript no lo detecta porque las respuestas del backend son `any`.

**Decisión: el backend sigue devolviendo strings; el frontend coerciona en el borde.**

No se toca el backend: los strings preservan la precisión decimal exacta, que es lo correcto para dinero. Un `parseFloat` server-side introduciría error de punto flotante en los montos.

El frontend coerciona en `src/lib/api/` con **mappers de DTO explícitos**, uno por recurso. Nunca `Number()` disperso en los call sites, nunca coerción en el componente. Los tipos de `src/types/index.ts` siguen diciendo `number` y eso pasa a ser cierto **después del mapper**, que es la única frontera donde la API cruda entra a la app.

---

## 6. Firma del piloto

**Decisión:**

- **Subida:** el navegador sigue mandando el dataURL base64 en el body del create. El backend hace el PUT a R2. No se presigna PUT desde el browser (exigiría CORS, un round-trip extra, y le daría acceso de escritura al bucket).
- El PUT va **antes** de abrir la transacción. Nunca adentro: ahí se sostiene el advisory lock que serializa todos los despachos de esa gasolinera+serie, y un upload lento congelaría la fila de la bomba.
- **Persistencia:** `despachos.firma_key varchar(255)` reemplaza a `firma_piloto_base64`. Los blobs salen de la tabla de hechos.
- **Lectura:** `GET /api/v1/despachos/:id/firma` con `@Auth()` + scoping, streamea desde R2 con `Cache-Control: private`. **No se usan URLs presignadas**: son credenciales en la URL (historial, Referer, logs) para el artefacto que prueba que el piloto recibió el combustible.
- **Impresión:** el camino de impresión **nunca hace fetch**. El cliente ya tiene el dataURL en memoria. `imprimirVale` espera `img.complete` antes de `window.print()`, y si el fetch falla el listener de `error` resuelve igual y **se imprime un vale con la firma en blanco, en silencio**. Eso es integridad de recibo.
- **Validación:** `@MaxLength(200_000)` y verificación de magic bytes (`\x89PNG`) tras decodificar. No confiar en el prefijo `data:image/png;base64,`.

---

## 7. Scoping por rol

`findOne(id)` **no tiene scoping** hoy: el filtrado por rol es ad-hoc dentro de cada servicio y solo cubre los listados. Cualquier usuario autenticado puede leer cualquier despacho por ID.

**Decisión:** cerrarlo antes de conectar el portal a datos reales. En cuanto el portal lea despachos reales, un `findOne` sin scoping es fuga de datos **entre clientes corporativos**, firmas incluidas.

El scoping del servidor es la seguridad real. El `cliente_id` que manda el portal es solo UX: el servidor lo ignora y usa el del token. Esto ya estaba anotado como supuesto en `gasolineras-os-frontend/docs/backend-validaciones.md` (ítem 2) y nunca se verificó.

---

## Referencias

- Supuestos originales del frontend (varios ya invalidados): `gasolineras-os-frontend/docs/backend-validaciones.md`
- Plan completo de migración: ver `CLAUDE.md` en la raíz del contenedor.
- La API se documenta en Swagger (`/api/docs`), que queda gateado a `NODE_ENV !== 'production'`.
