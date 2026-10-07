# Pruebas unitarias del backend

Fecha: 2026-10-07 · Estado: en revisión. Rama: `pruebas-unitarias`, desde `main` @ `5000f1f`.

Primer paso de "pruebas unitarias para todo". El frontend (test runner y pruebas) es un proyecto aparte, con su propia spec.

## Objetivo

Poder refactorizar la lógica de negocio sin miedo: que las reglas que deciden si un despacho, una venta o una sesión pasan tengan pruebas rápidas, sin Postgres, que no se rompan cuando cambia una consulta.

**Criterio de éxito:** cada regla de negocio de los servicios del nivel 1 vive en una función pura con pruebas que fijan su comportamiento y su mensaje de error exacto; los servicios del nivel 2 tienen pruebas con dobles de sus colaboradores; los 237 e2e siguen en verde sin modificarse.

## Decisiones cerradas

| Tema | Decisión |
|---|---|
| Propósito | Refactorizar sin miedo. No se persigue un porcentaje de cobertura global. |
| Enfoque | Extraer las reglas a funciones puras (`<modulo>.reglas.ts`) y probarlas sin mocks. Nada de simular la cadena de Drizzle. Nada de PGlite. |
| Consultas | Se quedan en el servicio. El SQL crudo (agregados con `FILTER`, `date_trunc`, advisory lock) lo siguen cubriendo los e2e. |
| Servicios CRUD delgados | Sin pruebas unitarias (nivel 3). |
| Bugs que aparezcan | No se corrigen dentro de la extracción. Se anotan, se presentan a Milton y, si decide corregirlos, van en un commit aparte con su prueba. |
| Cambios de API | Ninguno. `docs/contrato-frontend.md` no cambia. |

## Contexto

- `despachos.service.ts` tiene 977 líneas; `create()` ocupa ~490 y alterna ~15 consultas con las reglas que deciden si lanzar.
- Ya hay 36 unit tests (Fase 6) que siguen este mismo patrón: `turnos.util.ts`, `recordatorio.mensaje.ts`, `hora-guatemala.ts` son funciones puras; `recordatorios.service.spec.ts` construye el servicio a mano con dobles.
- Los e2e verifican casi siempre sólo el código HTTP: apenas 14 aserciones miran el mensaje. Un mensaje en español alterado al mover código hoy pasaría inadvertido; las pruebas nuevas lo fijan.

## 1. Alcance

### Nivel 1: extraer reglas y probarlas a fondo

| Servicio | Reglas que se extraen |
|---|---|
| `despachos` | Cascada de bloqueos (sistema, gasolinera, cliente —cuenta y admin—, vehículo); validación de renglones y del par vehículo/piloto; productos permitidos; días permitidos y ventana horaria; galones desde el monto y monto > 0; límites de cuenta (día/semana/mes); límites por transacción; límites acumulados del vehículo (monto, volumen y transacciones × día/semana/mes) y el predicado que decide si se consulta el agregado; kilometraje; validación del PNG de la firma; `normalizarRenglones` y `resumenRenglones`. |
| `ventas-insumos` | Validaciones de rol, gasolinera, bloqueo de cuenta y stock de `create()`. |
| `session` | La decisión de rotación en `rotarEnTx`: inválida, revocada, replay (revoca la familia), expirada (por fecha y por familia), usuario inactivo o inexistente, sesión anterior al último cambio de contraseña. El replay se decide dentro de la transacción pero la familia se revoca fuera de ella; esa separación se conserva. |
| `vehiculos` | Permisos de `updateRestricciones`: el cliente bloquea pero no desbloquea; `bloqueado: null` da 400; coerción de decimales. |
| `usuarios` | Reglas de rol ↔ `cliente_id`/`gasolinera_id`; unicidad de email y teléfono (la decisión, no la consulta). |
| `saldos` | Validaciones de abono y cuadre; el saldo corrido del estado de cuenta si se calcula en JS. |

### Nivel 2: probar tal como están, con dobles de colaboradores

- `token.service`, `password.service`, `AuthGuard`, `RolesGuard` (incluido: sin `@Roles`, cualquier rol autenticado pasa), `all-exceptions.filter` (nunca filtra el stack).
- `auth.service` y `password-reset.service`, con dobles de Session, Mail, Token y Password.
- `r2-storage.service` y `resend-mail.service`, con el cliente del SDK simulado.
- `saldos-pdf`, `reportes-pdf` y `despachos-excel`: se alimentan con filas falsas y se verifica el contenido (textos, totales, celdas), no el diseño.

### Nivel 3: sin pruebas unitarias

`operarios`, `gasolineras`, `pilotos`, `clientes`, `precios-combustible`, `configuracion-sistema`, `inventario`, `reportes.service`, `suscripciones-push`. Son CRUD o agregados SQL sin decisiones propias; los e2e los cubren y una prueba con mocks sólo repetiría la consulta.

## 2. Reglas de la extracción

1. **Ubicación.** `src/modules/<modulo>/<modulo>.reglas.ts` junto al servicio, con `<modulo>.reglas.spec.ts`. En `auth/` el archivo es `src/auth/session.reglas.ts`.
2. **Entradas.** Datos simples: la fila tal como sale de Drizzle, con los numéricos todavía como string, para que el parseo también quede probado. Sin `DbService`, sin `ConfigService`.
3. **Tiempo.** Toda regla que dependa de la hora recibe `ahora: Date` y la convierte con `ahoraGuatemala()`. Ninguna lee el reloj. El servicio pasa `new Date()`. Esto permite probar el cruce de las 18:00 GT y los bordes de la ventana horaria.
4. **Salida.** Las reglas lanzan las mismas excepciones de Nest (`BadRequestException`, `ForbiddenException`, `NotFoundException`, `UnauthorizedException`, `ConflictException`) con el mensaje copiado carácter por carácter. Las reglas de cálculo devuelven valores.
5. **Es un movimiento, no un rediseño.** Las consultas se quedan donde están. El orden de las validaciones no cambia, porque define qué error gana cuando hay dos (p. ej. vehículo bloqueado antes que horario; falta de precio antes que límites). Las condiciones que deciden si se hace una consulta también se extraen como predicados puros (`necesitaAgregadoCliente`, `necesitaAgregadoVehiculo`).
6. **Prueba primero.** Por cada regla: escribir la prueba contra la función nueva, verla fallar, mover el código, verla pasar, correr los e2e.
7. **Nivel 2.** `*.spec.ts` junto a su archivo, construyendo la clase a mano con dobles, como `recordatorios.service.spec.ts`. `Test.createTestingModule` sólo donde haga falta la inyección de Nest (p. ej. el `Reflector` de los guards, si no basta con `new Reflector()`).

### Punto a revisar: `getConsumoHoy`

`getConsumoHoy` (supervisor, cupo restante del vehículo) repite a mano la matemática de límites de `create()`. Durante la extracción se compara con las reglas nuevas. Si coinciden, se reutilizan las mismas funciones. Si no coinciden, se le presenta la diferencia a Milton antes de unificar: un cupo restante distinto del que se aplica confunde al supervisor en la bomba.

## 3. Ejecución

**Orden:**

1. `despachos`, en varias tareas: renglones y bloqueos → productos, días y horario → precio y galones → límites de cuenta → límites del vehículo → kilometraje y firma → revisión de `getConsumoHoy`.
2. `ventas-insumos`
3. `session`
4. `vehiculos`
5. `usuarios`
6. `saldos`
7. Nivel 2: guards, `token`, `password`, filtro → `auth`, `password-reset` → `r2-storage`, `resend-mail` → PDF y Excel.

**Puerta de cada tarea, antes del commit:**

- `pnpm test` en verde.
- Las tres suites e2e en verde (`gasfuel`, `auth-rotacion`, `fase6`; 237 pruebas), sin modificar ninguna.
- `pnpm exec tsc --noEmit` limpio.
- Ningún problema de lint nuevo en los archivos tocados. Los ~518 problemas previos quedan fuera de este proyecto.

**Commits:** uno por extracción, Conventional Commits, asunto y cuerpo en español, sin `Co-Authored-By`.

**Candado:** `coverageThreshold` de Jest al 100 % de líneas y ramas sólo para `**/*.reglas.ts`. Una regla nueva sin prueba hace fallar `pnpm test:cov`. Sin umbral para el resto.

## 4. Terminado significa

- Nivel 1 extraído y probado; nivel 2 con pruebas.
- e2e intactos y en verde; `pnpm test:cov` cumple el umbral de los `*.reglas.ts`.
- Bugs hallados anotados y presentados a Milton.
- `CLAUDE.md` del backend: la sección "Testing" con el conteo nuevo, la convención `*.reglas.ts` y el umbral de cobertura.
- `CLAUDE.md` del workspace corregido: la sección "Testing reality" y la línea que dice que no existe API de saldos ni de reportes (sí existen: `/saldos/*` y `/reportes/*`; lo que falta es que el `useReportes.ts` del frontend las use).

## Hallazgos

Comportamientos dudosos hallados al extraer las reglas. Ninguno se corrigió en este trabajo: cada uno quedó fijado por una prueba o anotado como "sin prueba unitaria". Milton aprobó corregirlos todos y se corrigieron el 2026-10-07 (cada uno lleva su nota **Corregido**); el análisis original se conserva.

### H1. Una ventana horaria que cruza la medianoche nunca deja despachar

**Corregido (2026-10-07):** `dentroDeVentana` acepta `minutos >= inicio || minutos <= fin` cuando `inicio > fin` (bordes inclusivos); `estadoHorario` calcula los minutos restantes hasta el cierre del día siguiente.

- **Qué pasa:** con `hora_inicio` 22:00 y `hora_fin` 06:00 el vehículo rechaza todo despacho, incluso a las 23:00 GT, con "Despacho fuera del horario autorizado (22:00–06:00)". El DTO acepta esa ventana.
- **Dónde:** `despachos.reglas.ts`, `validarHorarioVehiculo` (compara `inicio <= minutos <= fin` sin contemplar `inicio > fin`).
- **Prueba:** `HALLAZGO H1` en `despachos.reglas.spec.ts`.
- **Para corregirlo:** si `inicio > fin`, aceptar `minutos >= inicio || minutos <= fin`; aplicar lo mismo en `estadoHorario`; o bien hacer que el DTO rechace ventanas con `inicio > fin`.
- **Un solo lugar:** `validarHorarioVehiculo` y `estadoHorario` comparten el helper interno `dentroDeVentana` (`despachos.reglas.ts`), así que corregir H1 toca una sola función.

### H2. Precio por galón 0 produce galones infinitos

**Corregido (2026-10-07):** nueva regla `validarPrecioGalon` (400 "El precio por galón debe ser mayor a cero") en el alta y la corrección de precios; `valorizarRenglon` rechaza un precio no válido como defensa, después del chequeo del monto.

- **Qué pasa:** `@IsNumberString` acepta "0" como precio; `valorizarRenglon` divide el monto entre 0 y da `Infinity` galones, lo que probablemente termina en un 500 al insertar en `numeric`.
- **Dónde:** `despachos.reglas.ts`, `valorizarRenglon`.
- **Prueba:** `HALLAZGO H2` en `despachos.reglas.spec.ts`.
- **Para corregirlo:** rechazar precio <= 0 con 400 al crear o al fijar el precio del día, o validarlo en `valorizarRenglon`.

### H3. El consumo del vehículo en `getConsumoHoy` no coincide con el que aplica `create`

**Corregido (2026-10-07):** `consumoVehiculo` y `consumoCliente` son privados compartidos por `create` y `getConsumoHoy`; el consumo del vehículo ya cuenta sólo el renglón `vehiculo`.

- **Qué pasa:** `getConsumoHoy` suma el encabezado (`despachos.monto_total` / `galones`, que incluye canecas y toneles); `create` suma `despacho_detalles` con `renglon = 'vehiculo'`. En vales mixtos el supervisor ve más consumo del que realmente se aplica al límite.
- **Dónde:** `despachos.service.ts`, `getConsumoHoy` (SQL).
- **Prueba:** sin prueba unitaria, porque es SQL y lo cubren los e2e.
- **Para corregirlo:** que `getConsumoHoy` agregue sobre `despacho_detalles` filtrado a `renglon = 'vehiculo'`, igual que `create`.

### H4. `dentro_de_horario` de `getConsumoHoy` ignora `dias_permitidos`

**Corregido (2026-10-07):** `estadoHorario` recibe `dias_permitidos`; en un día no permitido devuelve fuera de horario con 0 minutos restantes. Documentado en el contrato.

- **Qué pasa:** el indicador sólo mira la ventana horaria; un vehículo en un día no permitido aparece "dentro de horario" y `create` luego lo rechaza.
- **Dónde:** `despachos.service.ts`, `getConsumoHoy`, vía `estadoHorario` (`despachos.reglas.ts`), que no recibe los días.
- **Prueba:** sin prueba unitaria: `estadoHorario` no recibe los días, no hay nada que fijar.
- **Para corregirlo:** pasar `dias_permitidos` y `ahora` a `estadoHorario` (o componerlo con `validarDiaVehiculo`).

### H5 (menor). `validarMontoAbono` deja pasar texto no numérico

**Corregido (2026-10-07):** `validarMontoAbono` usa `!(Number(monto) > 0)`.

- **Qué pasa:** "abc" da `NaN` y `NaN <= 0` es falso, así que la regla no lanza. Hoy lo frena `@IsNumberString` del DTO.
- **Dónde:** `saldos.reglas.ts`, `validarMontoAbono`.
- **Prueba:** `HALLAZGO H5` en `saldos.reglas.spec.ts`.
- **Para corregirlo:** `if (!(Number(monto) > 0)) throw …`.

### H6. Un teléfono de sólo espacios se guarda como "" en vez de null

**Corregido (2026-10-07):** `identificadoresDeAlta` y `normalizarCambios` recortan y convierten el vacío en `null`; la migración `0007_telefono_vacio_a_null` limpia los `""` ya guardados en `usuarios.telefono` y `usuarios.email`.

- **Qué pasa:** `"   "` es truthy, se recorta a `""` y se guarda `""` cuando hay correo. En `usuarios.service.ts` (`create`) la comprobación de unicidad está dentro de `if (telefono)` y `""` es falsy, así que `exigirNoRegistrado` no corre: el segundo alta con teléfono vacío llega al INSERT y choca con `telefono UNIQUE` (`usuarios.schema.ts:26`). El servicio no captura el `23505`, así que el resultado es un error de base de datos sin mensaje en español (probablemente un 500; no verificado, igual que en H2). En `update` no hay comprobación de unicidad. `normalizarCambios` tiene el mismo recorte.
- **Dónde:** `usuarios.reglas.ts`, `identificadoresDeAlta` y `normalizarCambios`.
- **Mismo origen en la autenticación:** `LoginDto` (`@IsNotEmpty`) y `SolicitarResetDto` (`@MinLength(3)`) aceptan `"   "`; `normalizarIdentificador` lo reduce a `""`, que coincide con el usuario que tenga `telefono = ""`. No es una vulnerabilidad: el login exige contraseña y el reset llega al dueño de la cuenta.
- **Prueba:** `HALLAZGO H6` en `usuarios.reglas.spec.ts` (fija `identificadoresDeAlta({ email: "a@b.c", telefono: "   " })` con `telefono: ""`).
- **Para corregirlo:** recortar primero y convertir el resultado vacío en `null` (`datos.telefono?.trim() || null`), también en `normalizarCambios`.

### H7. `PATCH /usuarios/:id` a un cliente sin reenviar `cliente_id` responde 400

**Corregido (2026-10-07):** `clienteIdResultante` usa `resto.cliente_id !== undefined`; un `null` explícito sigue quitando la empresa. E2E nuevo del `PATCH` sin `cliente_id`.

- **Qué pasa:** `clienteIdResultante` usa `"cliente_id" in resto`. Con `target: ES2023`, `UpdateUsuarioDto` emite sus campos como class fields, y tras el `ValidationPipe` de producción (whitelist + forbidNonWhitelisted + transform) un body `{ nombre: "Ana" }` llega con `cliente_id` como clave propia con valor `undefined` (verificado con `plainToInstance`: `Object.keys` incluye `cliente_id`). La condición es siempre verdadera, el resultado es `undefined` y `exigirEmpresaSiEsCliente` responde 400 "Un usuario cliente debe tener una empresa (cliente_id) asignada". El frontend siempre reenvía `cliente_id`, y ningún e2e cubre este caso.
- **Dónde:** `usuarios.reglas.ts`, `clienteIdResultante`, llamada desde `usuarios.service.ts` (`update`).
- **Prueba:** `HALLAZGO H7` en `usuarios.reglas.spec.ts` (fija `clienteIdResultante({ cliente_id: undefined }, { cliente_id: "c1" })` con `undefined`).
- **Para corregirlo:** `resto.cliente_id !== undefined ? resto.cliente_id : actual.cliente_id`.

### Nota menor (no es un hallazgo)

El `catch` que lanza "Firma inválida" en `decodificarFirmaPng` es inalcanzable con una entrada `string`: `Buffer.from(…, "base64")` no lanza. Sólo se cubre con un doble que fuerce el error.
