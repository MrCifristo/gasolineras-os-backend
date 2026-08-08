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
