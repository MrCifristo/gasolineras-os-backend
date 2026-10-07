# Pruebas unitarias del backend — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans. Los pasos usan `- [ ]`.
>
> **Por decisión de Milton, este plan no trae código literal.** Cada tarea da las firmas exactas, los casos de prueba (entrada → resultado esperado) y qué se mueve del servicio. Los mensajes de error se copian **del servicio actual, carácter por carácter** (ojo con `—` raya y `–` semirraya); los de este plan son referencia.

**Objetivo:** que las reglas de negocio del backend tengan pruebas rápidas, sin Postgres, para refactorizar sin miedo.

**Arquitectura:** cada regla sale del servicio a una función pura en `<modulo>.reglas.ts` y se prueba sin mocks. El servicio conserva sus consultas y llama a las reglas en el mismo punto y el mismo orden. Los servicios que orquestan colaboradores se prueban con dobles construidos a mano.

**Stack:** NestJS 11, Jest 30 + ts-jest, Drizzle (sólo tipos en las reglas), exceljs, mock de puppeteer existente.

**Spec:** `docs/superpowers/specs/2026-10-07-pruebas-unitarias-backend-design.md`

## Restricciones globales

- Rama `pruebas-unitarias` del backend. El frontend no se toca. Ningún cambio de API.
- **Mover, no rediseñar:** mismas excepciones, mismos mensajes, mismo orden de validaciones, consultas en el servicio.
- Las reglas no leen el reloj: reciben `ahora: Date`. Toda conversión a Guatemala pasa por `ahoraGuatemala()`.
- Las reglas reciben datos simples (filas con los numéricos como string). Para tipar, `Pick<typeof tabla.$inferSelect, ...>` con `import type`.
- Un hallazgo (comportamiento dudoso) **no se corrige**: se fija con una prueba cuyo nombre empieza con `HALLAZGO Hn:` y se anota en la spec (Tarea 16).
- Asertar clase **y** mensaje exacto con el helper `esperarError`/`esperarRechazo` (Tarea 1). `toThrow(new X("m"))` sólo compara el mensaje y `toThrow("m")` acepta substrings.
- Commits: Conventional Commits, asunto y cuerpo en español, **sin `Co-Authored-By`**.

## Puerta de cada tarea (antes del commit)

1. `pnpm test` en verde.
2. `pnpm test:e2e` en verde: **237** pruebas (gasfuel 161, auth-rotacion 8, fase6 68), sin modificar ningún e2e.
3. `pnpm exec tsc --noEmit -p tsconfig.build.json` sin errores. (`tsconfig.json` arrastra 5 errores previos en `test/fase6.e2e-spec.ts`; no son de este trabajo.)
4. `pnpm exec eslint <archivos tocados>` (sin `--fix`): el conteo de problemas no sube respecto al de antes de la tarea. Anotar el conteo previo al empezar.
5. Desde la Tarea 1: `pnpm test:cov` cumple el umbral de los `*.reglas.ts`.

## Antes de empezar

- [ ] Abrir OrbStack (`open -a OrbStack`) y `docker compose up -d postgres rustfs` en el backend. En la Mac hay un `docker-compose.override.yml` local que publica Postgres en **5433**, y `.env` ya apunta ahí.
- [ ] Línea base: `pnpm test` → 36 en verde; `pnpm test:e2e` → 237 en verde. Si algo falla aquí, parar y avisar: no es de este trabajo.

## Foco de revisión

Entradas que la spec implica y que ninguna prueba "natural" ejercitaría; cada una tiene su prueba en la tarea indicada.

1. **El cruce de las 18:00 GT** (la fecha UTC ya es mañana): días permitidos, ventana horaria y llave de la firma deben usar el día de Guatemala. → Tareas 3, 7, 8.
2. **Bordes exactos de los límites** (consumido + nuevo == límite pasa; un centavo más no). → Tareas 5, 6.
3. **Ventana horaria que cruza medianoche** (22:00–06:00), que el DTO acepta. → Tarea 3, como HALLAZGO H1.
4. **Precio por galón 0**, que `@IsNumberString` acepta: galones infinitos. → Tarea 4, como HALLAZGO H2.
5. **Montos no numéricos o negativos en reglas que el DTO normalmente filtra.** → Tareas 4 y 13.

---

### Tarea 1: Helper de pruebas, umbral de cobertura y bloqueos compartidos

Los bloqueos de gasolinera y de cliente, y el chequeo de rol, son idénticos en despachos y ventas de insumos (mismos mensajes). Van a un solo archivo común, que el glob `**/*.reglas.ts` también cubre.

**Archivos:**
- Crear: `test/unit/esperar-error.ts` (fuera de `src/`, así el build no lo empaqueta)
- Crear: `src/common/bloqueos.reglas.ts` y `src/common/bloqueos.reglas.spec.ts`
- Modificar: `package.json` (bloque `jest`)

**Produce:**
- `esperarError(fn: () => unknown, Clase: abstract new (...a: any[]) => Error, mensaje: string): void`
- `esperarRechazo(promesa: Promise<unknown>, Clase, mensaje: string): Promise<void>`
- Ambos fallan si no se lanzó nada, si la clase difiere o si el mensaje no es idéntico. Importación desde `src/modules/x/`: `../../../test/unit/esperar-error`.
- `exigirRol(rol: string | undefined, permitidos: readonly string[], mensaje: string): void` → `ForbiddenException(mensaje)`
- `exigirGasolineraOperable<T extends { bloqueado: boolean }>(gas: T | undefined): asserts gas is T`
- `exigirClienteConCredito<T extends { bloqueado: boolean; credito_bloqueado: boolean }>(cliente: T | undefined): asserts cliente is T`. Conserva el comentario de por qué el crédito va después de la cuenta y con mensaje propio.

**Casos de `bloqueos.reglas.spec.ts`:**
- `exigirRol`: `"supervisor"` y `"admin"` en `["supervisor","admin"]` pasan; `"cliente"` y `undefined` → 403 con el mensaje dado.
- Gasolinera: `undefined` → 404 "Gasolinera no encontrada"; bloqueada → 403 "Gasolinera bloqueada — contacte al administrador"; activa pasa.
- Cliente: `undefined` → 404 "Cliente no encontrado"; `bloqueado` → 403 "Cuenta bloqueada por el cliente"; `credito_bloqueado` → 403 "Crédito suspendido — consulte con administración"; con **los dos** bloqueos gana "Cuenta bloqueada…"; sin bloqueos pasa.

**Umbral:** en `jest` de `package.json`, `coverageThreshold` con la clave `"./src/**/*.reglas.ts"` al 100 en `lines`, `branches`, `functions` y `statements`. Jest resuelve la clave desde el cwd, así que se corre desde la raíz del backend.

- [ ] Escribir `bloqueos.reglas.spec.ts` y el helper; correr `pnpm test --testPathPatterns=bloqueos` → falla (no existe el módulo).
- [ ] Crear `bloqueos.reglas.ts`; la misma corrida pasa.
- [ ] Agregar el umbral; `pnpm test:cov` pasa. Comprobar que el umbral muerde: comentar un caso y verlo fallar; luego restaurarlo.
- [ ] Puerta y commit: `test: helper de errores, umbral de cobertura y bloqueos compartidos`.

### Tarea 2: Despachos — sistema, operario, cliente y renglones

**Archivos:**
- Crear: `src/modules/despachos/despachos.reglas.ts` y `despachos.reglas.spec.ts`
- Modificar: `despachos.service.ts` (`create`, y se eliminan los privados `normalizarRenglones` y `resumenRenglones`)

**Produce (en `despachos.reglas.ts`):**
- `interface LineaDespacho { renglon: Renglon; tipo_combustible: string; monto: string }` (`Renglon` del schema).
- `exigirSistemaActivo(sys: { sistema_bloqueado: boolean } | undefined): void`
- `exigirOperarioDeLaGasolinera<T>(operario: T | undefined): asserts operario is T` → 400 "El operario no pertenece a esta gasolinera o está inactivo."
- `normalizarRenglones(dto: { tipo_combustible?: string | null; monto?: string | null; detalles?: LineaDespacho[] | null }): LineaDespacho[]`. Se mueve tal cual, con su comentario sobre la forma vieja.
- `validarParVehiculoPiloto(dto: { vehiculo_id?: string | null; piloto_id?: string | null }, lineas: LineaDespacho[]): void`. Son los tres chequeos, en su orden.
- `resumenRenglones(renglones: { renglon: string; tipo_combustible: string; galones: number }[]): string`

**En el servicio:**
- El rol pasa por `exigirRol(user.rol, ["supervisor","admin"], …)`.
- Luego, en orden, `exigirSistemaActivo`, `exigirGasolineraOperable`, `exigirOperarioDeLaGasolinera` y `exigirClienteConCredito`.
- Después, `normalizarRenglones` + `validarParVehiculoPiloto`. Se borra `hayRenglonVehiculo`.
- La descripción del movimiento usa `resumenRenglones`.
- Se quitan los imports que queden sin uso (p. ej. `type Renglon`).

**Casos:**
- Sistema: sin fila pasa; `false` pasa; `true` → 403 "Sistema suspendido — contacte al administrador".
- Operario: `undefined` → 400 con el mensaje de arriba; fila presente pasa.
- `normalizarRenglones`:
  - Forma vieja (`tipo_combustible:"diesel", monto:"100"`) → un renglón `vehiculo`.
  - `detalles` con vehículo + caneca → los dos, en el mismo orden.
  - Las dos formas a la vez → 400 "Mandá `detalles`…".
  - Sólo `tipo_combustible` sin `monto` → 400 "Falta el detalle del despacho…".
  - `detalles: []` sin forma vieja → 400 "Falta el detalle…".
  - `detalles: []` con forma vieja → forma vieja.
- `validarParVehiculoPiloto`:
  - Vehículo sin piloto, o piloto sin vehículo → 400 "Vehículo y piloto deben venir juntos o ninguno de los dos".
  - Renglón `vehiculo` sin `vehiculo_id` → 400 "El renglón de vehículo requiere vehiculo_id y piloto_id".
  - `vehiculo_id` con sólo canecas → 400 "Se indicó vehículo pero ningún renglón le despacha combustible".
  - Sólo canecas sin vehículo, o vehículo + piloto + renglón `vehiculo` → pasa.
- `resumenRenglones`: `[vehiculo diesel 80, caneca super 5]` → `"diesel 80.000 gal + caneca super 5.000 gal"`; un renglón → sin `+`.

- [ ] Spec primero → falla; mover; pasa; puerta.
- [ ] Commit: `refactor(despachos): extrae a reglas puras los bloqueos y la normalización de renglones`.

### Tarea 3: Despachos — vehículo, productos, días y horario

**Produce:**
- `DIAS_GT` (los 7 nombres que hoy son `GT_DAYS`, movidos aquí).
- `diaYMinutoGuatemala(ahora: Date): { dia: string; minutos: number }`
- `exigirVehiculoHabilitado<T extends { bloqueado: boolean }>(v: T | undefined): asserts v is T` → 404 "Vehículo no encontrado" / 403 "Vehículo bloqueado — consulte con su administrador"
- `validarProductosPermitidos(v: { productos_permitidos: string[] | null }, lineas: LineaDespacho[]): void`
- `validarHorarioVehiculo(v: { dias_permitidos: string[] | null; hora_inicio: string | null; hora_fin: string | null } | null, ahora: Date): void`. Primero los días y después la hora, como hoy.

**En el servicio:**
- Dentro del `if (dto.vehiculo_id)` van `exigirVehiculoHabilitado(fila)`, `v = fila` y `validarProductosPermitidos(v, lineas)`.
- Fuera del `if`, `validarHorarioVehiculo(v, new Date())`.
- `create` deja de llamar a `getGuatemalaTime()`. La función se queda para `getConsumoHoy` hasta la Tarea 8.

**Instantes de prueba:** el 2026-10-07 es miércoles.
- `14:00Z` = 08:00 GT.
- `2026-10-08T00:30Z` = 18:30 GT, todavía miércoles en Guatemala aunque en UTC ya sea jueves.

**Casos:**
- Vehículo: `undefined` → 404; bloqueado → 403; habilitado pasa.
- Productos:
  - `null` o `[]` → sin restricción.
  - `["diesel"]` con renglón vehículo diesel → pasa.
  - `["diesel"]` con renglón vehículo super → 403 "Este vehículo no puede cargar super".
  - `["diesel"]` con **caneca** super → pasa.
- Horario:
  - Vehículo `null` → pasa.
  - Días `["lunes","miercoles"]` a las 08:00 GT del miércoles → pasa.
  - Días `["jueves"]` a las 18:30 GT del miércoles → 403 "Despacho no permitido hoy (miercoles) para este vehículo". Esta prueba fija el día de Guatemala, no el de UTC.
  - Ventana 06:00–18:00: pasan 06:00, 08:00 y 18:00 en punto (es inclusiva); 05:59 y 18:01 → 403 "Despacho fuera del horario autorizado (06:00–18:00)".
  - Sólo `hora_inicio`, sin `hora_fin` → sin restricción.
  - Día no permitido y además fuera de hora → gana el mensaje del día.
  - **HALLAZGO H1:** con una ventana 22:00–06:00 a las 23:00 GT, hoy rechaza. Una ventana que cruza la medianoche nunca deja despachar.

- [ ] Spec → falla; mover; pasa; puerta.
- [ ] Commit: `refactor(despachos): extrae a reglas puras las restricciones de vehículo y horario`.

### Tarea 4: Despachos — precio, galones y totales

**Produce:**
- `exigirPrecio<T>(precio: T | undefined, tipoCombustible: string): asserts precio is T` → 400 "No hay precio registrado para {tipo} hoy en esta gasolinera"
- `valorizarRenglon(monto: string, precioGalon: string): { monto: number; galones: number }`. Rechaza con `!(monto > 0)`, igual que hoy.
- `totalesDespacho(renglones: { renglon: Renglon; monto: number; galones: number }[]): { montoEstimado: number; galonesEstimado: number; montoTotal: string; montoVehiculo: number; galonesVehiculo: number }`

**En el servicio:**
- En el `map` de renglones: primero `exigirPrecio(precioRow, l.tipo_combustible)` y después `{ ...l, precioRow, ...valorizarRenglon(l.monto, precioRow.precio_galon) }`. Se conserva el orden: la falta de precio va antes que el monto.
- Los totales salen de `totalesDespacho`. Se borran `sumaMonto` y `sumaGalones`.
- El filtro `renglonesVehiculo` se queda, porque lo usa el `precio_id` del insert.

**Casos:**
- Precio: `undefined` → 400 con el tipo en el mensaje; fila presente pasa.
- `valorizarRenglon`:
  - `("100","25")` → `{100, 4}`.
  - `"0"`, `"-5"` y `"abc"` → 400 "El monto de cada renglón debe ser mayor a cero".
  - **HALLAZGO H2:** `("100","0")` → `galones` es `Infinity`.
- `totalesDespacho`:
  - `[vehiculo 100/4, caneca 50/2]` → estimados 150/6, `montoTotal` "150.000", vehículo 100/4.
  - Sólo canecas → vehículo 0/0.
  - `montoTotal` siempre con 3 decimales.

- [ ] Spec → falla; mover; pasa; puerta.
- [ ] Commit: `refactor(despachos): extrae a reglas puras el precio, los galones y los totales del vale`.

### Tarea 5: Despachos — límites de cuenta y por transacción

**Produce:**
- `type Agregado = number | string`. Es lo que devuelven los `sql<number>` de verdad.
- `aNumero(x: unknown): number | null`. Es el `num` de hoy.
- `necesitaAgregadoCliente(c: Pick<ClienteRow, "limite_monto_dia"|"limite_monto_semana"|"limite_monto_mes">): boolean`
- `validarLimitesCliente(c: (mismo Pick), consumo: { monto_dia: Agregado; monto_semana: Agregado; monto_mes: Agregado }, montoEstimado: number): void`
- `validarLimitesTransaccion(v: Pick<VehiculoRow, "limite_monto_transaccion"|"limite_volumen_transaccion"> | null, montoVehiculo: number, galonesVehiculo: number): void`

**En el servicio:**
- `if (necesitaAgregadoCliente(clienteRow)) { consulta; validarLimitesCliente(...) }`.
- Los dos límites por transacción salen a `validarLimitesTransaccion`.

**Casos:**
- `aNumero`: `null` y `undefined` → `null`; `"12.50"` → 12.5; `3` → 3.
- `necesitaAgregadoCliente`: los tres en `null` → `false`; con cualquiera de los tres → `true` (`it.each`).
- Cliente:
  - Límite diario "500.00" con consumo "400" y monto 100 → pasa (justo en el límite).
  - Con monto 100.01 → 403 "Límite diario de la cuenta superado".
  - Lo mismo para la semana ("Límite semanal…") y el mes ("Límite mensual…").
  - Si se pasan el día y el mes a la vez, gana el día.
  - El consumo puede llegar como número (0).
- Transacción:
  - `v` en `null` → pasa.
  - Monto límite "200.00": 200 pasa; 200.5 → 403 "Monto por transacción supera el límite (Q200.00)".
  - Volumen límite "10.5" con 11 → 403 "Volumen por transacción supera el límite (10.50 gal)".
  - Si los dos se exceden, gana el monto.

- [ ] Spec → falla; mover; pasa; puerta.
- [ ] Commit: `refactor(despachos): extrae a reglas puras los límites de cuenta y por transacción`.

### Tarea 6: Despachos — límites acumulados del vehículo y kilometraje

**Produce:**
- `necesitaAgregadoVehiculo(v: LimitesAcumulados | null): boolean`. `LimitesAcumulados` es el `Pick` de los 9 campos `limite_{monto,volumen}_{dia,semana,mes}` y `limite_trans_{dia,semana,mes}`.
- `validarLimitesAcumuladosVehiculo(v: LimitesAcumulados, agg: { monto_dia, monto_semana, monto_mes, vol_dia, vol_semana, vol_mes, trans_dia, trans_semana, trans_mes: Agregado }, montoVehiculo: number, galonesVehiculo: number): void`
- `validarKilometraje(kilometraje: string, maxKm: Agregado | null | undefined): void`

**En el servicio:**
- `if (necesitaAgregadoVehiculo(v) && v) { consulta; validarLimitesAcumuladosVehiculo(...) }`.
- `validarKilometraje(dto.kilometraje, lastKmRow?.max_km)`, dentro del mismo `if (dto.kilometraje && dto.vehiculo_id)`.
- Se borra `num`. Los comentarios sobre `despacho_detalles` y la migración se quedan junto a la consulta.

**Casos:**
- `necesitaAgregadoVehiculo`: `null` → `false`; los 9 campos en `null` → `false`; cada uno de los 9 por separado → `true` (`it.each`).
- Monto diario:
  - Límite "1000.00", consumo "950", monto 50 → pasa.
  - Monto 60 → 403 "Límite diario de monto superado. Consumido: 950.00 — Límite: 1000.00".
- Volumen mensual: límite "100", consumo "99.5", 0.6 gal → 403 "Límite mensual de volumen superado. Consumido: 99.50 — Límite: 100.00".
- Transacciones:
  - Límite diario 3 con consumo "2" → pasa; con "3" → 403 "Límite diario de transacciones alcanzado (3)".
  - Semanal y mensual con su palabra en el mensaje.
  - Límite 0 → siempre 403. Se fija: 0 es un límite válido, no "sin límite".
- Orden de evaluación: montos, luego volúmenes, luego transacciones.
- Kilometraje:
  - Sin máximo previo → pasa.
  - "15000" contra "14999.5" → pasa.
  - Igual o menor → 403 "Inconsistencia de kilometraje detectada".
  - Máximo previo como número → mismo resultado.

- [ ] Spec → falla; mover; pasa; puerta.
- [ ] Commit: `refactor(despachos): extrae a reglas puras los límites acumulados y el kilometraje`.

### Tarea 7: Despachos — firma

**Produce:**
- `decodificarFirmaPng(firmaBase64: string): Buffer`. Quita el prefijo `data:image/png;base64,` y verifica la firma mágica. Se mueven los dos errores y el comentario.
- `claveFirma(gasolineraId: string, ahora: Date, id: string): string` → `firmas/{gas}/{yyyy}/{mm}/{id}.png`, con año y mes de `ahoraGuatemala(ahora).fecha`.

**En el servicio:** `subirFirma` queda en `if (!firmaBase64) return null`, `decodificarFirmaPng`, `claveFirma(gasolineraId, new Date(), crypto.randomUUID())` y `put`.

**Casos:**
- PNG válido (8 bytes mágicos + datos), con y sin prefijo → devuelve los bytes.
- Bytes de JPEG → 400 "La firma debe ser un PNG válido".
- `"iVBORw=="` (sólo 4 bytes) y `""` → el mismo 400.
- Prefijo `data:image/jpeg;base64,` delante de bytes PNG → el mismo 400.
- Un valor cuyo `replace` devuelve algo que no es texto → 400 "Firma inválida". Es la única forma de cubrir el `catch` sin `istanbul ignore`.
- `claveFirma("gas-1", 2026-11-01T03:00Z, "abc")` → `firmas/gas-1/2026/10/abc.png`. En Guatemala todavía es 31 de octubre.

- [ ] Spec → falla; mover; pasa; puerta.
- [ ] Commit: `refactor(despachos): extrae a reglas puras la validación y la llave de la firma`.

### Tarea 8: Despachos — `getConsumoHoy`

**Produce:** `estadoHorario(v: { hora_inicio: string | null; hora_fin: string | null }, ahora: Date): { dentro_de_horario: boolean; minutos_restantes: number }`

**En el servicio:**
- Los dos IIFE de horario se reemplazan por `estadoHorario(v, new Date())`.
- `n` se reemplaza por `aNumero`.
- Se borran `getGuatemalaTime`, `GT_DAYS` y el `void dayName`, junto con los imports que queden sin uso.

**Casos:**
- Sin ventana → `{true, 0}`.
- Ventana 06:00–18:00:
  - A las 08:00 → `{true, 600}`.
  - A las 18:00 → `{true, 0}`.
  - A las 18:30 → `{false, 0}`.
- Sólo `hora_fin` 18:00, a las 08:00 → `{true, 600}`. Se fija como está hoy.

**Hallazgos, sólo para anotar (no tienen prueba unitaria: son SQL o datos que la función no recibe):**
- **H3:** el agregado del vehículo en `getConsumoHoy` suma `despachos.monto_total`/`galones` (el header, que incluye canecas), mientras `create` suma `despacho_detalles` con `renglon='vehiculo'`. En un vale mixto, el supervisor ve un consumo mayor que el que realmente se aplica.
- **H4:** `dentro_de_horario` ignora `dias_permitidos`. Puede decir "dentro de horario" un día en que `create` rechaza.

- [ ] Spec → falla; mover; pasa; puerta.
- [ ] Commit: `refactor(despachos): getConsumoHoy usa las reglas de horario y de parseo`.

### Tarea 9: Ventas de insumos

**Archivos:** `src/modules/ventas-insumos/ventas-insumos.reglas.ts` (+ spec); modificar `ventas-insumos.service.ts`.

**Produce:**
- `validarFormaPago(dto: { forma_pago: FormaPago; cliente_id?: string | null }): void`
- `exigirProductosSinRepetir(ids: string[]): void`
- `valorizarRenglonVenta<P extends Pick<ProductoRow,"nombre"|"activo"|"stock_actual"|"precio">>(producto: P | undefined, d: { producto_id: string; cantidad: number }): { producto: P; cantidad: number; precioUnitario: number; subtotal: number }`

**En el servicio:**
- `exigirRol`, `validarFormaPago`, `exigirGasolineraOperable`, y `exigirClienteConCredito` sólo si hay `cliente_id`. Luego `exigirProductosSinRepetir`.
- Dentro de la transacción, `dto.detalles.map((d) => valorizarRenglonVenta(porId.get(d.producto_id), d))`.

**Casos:**
- Forma de pago:
  - Cargo sin cliente → 400 "Una venta a cargo del cliente necesita cliente_id".
  - Efectivo con cliente → 400 "Una venta en efectivo no se imputa a ningún cliente".
  - Las dos combinaciones válidas pasan.
- Repetidos: `["a","b","a"]` → 400 "Hay productos repetidos…"; ids distintos pasan.
- Renglón:
  - `undefined` → 404 "Producto p9 no encontrado".
  - Inactivo → 400 "El producto Aceite 20W50 está descontinuado".
  - Stock 2 y se piden 3 → 400 "Stock insuficiente de Aceite 20W50: hay 2 y se piden 3".
  - Stock 3 y se piden 3 → pasa.
  - Precio "45.50" × 2 → unitario 45.5, subtotal 91.
  - Inactivo y sin stock a la vez → gana "descontinuado".

- [ ] Spec → falla; mover; pasa; puerta.
- [ ] Commit: `refactor(ventas-insumos): extrae a reglas puras la forma de pago y los renglones`.

### Tarea 10: Sesiones

**Archivos:** `src/auth/session.reglas.ts` (+ spec); modificar `session.service.ts`.

**Produce (movidos desde el servicio, con sus comentarios):**
- `REFRESH_TTL_DIAS` y `FAMILIA_TTL_DIAS`.
- `class ReplayError` (exportada).
- `vencimientosIniciales(rol: Role, ahoraMs: number): { expira: Date; familiaExpira: Date }`
- `validarSesionParaRotar<S extends Pick<SesionRow,"revocado_at"|"usado_at"|"familia_id"|"expira_at"|"familia_expira_at">>(sesion: S | undefined, ahora: Date): asserts sesion is S`. Orden: inválida → revocada → replay (`throw new ReplayError(familia_id)`) → expirada → familia expirada.
- `validarUsuarioDeSesion<U extends Pick<UsuarioRow,"activo"|"password_actualizado_at">>(usuario: U | undefined, sesionCreadaAt: Date): asserts usuario is U`
- `sesionPosteriorAlPassword(creadoAt: Date, passwordActualizadoAt: Date): boolean`
- `vencimientoRotado(rol: Role, ahora: Date, familiaExpiraAt: Date): Date`

**En el servicio:**
- En `rotarEnTx`, `const ahora = new Date()` sube antes de `validarSesionParaRotar`.
- Se conserva el comentario de por qué la familia se revoca fuera de la transacción.
- `crear` usa `vencimientosIniciales`.
- `usuarioDeSesionViva` usa `sesionPosteriorAlPassword`.

**Casos (con `T` fijo):**
- Vencimientos:
  - Supervisor: +30 días / +90 días.
  - Admin, cliente y jefe de pista: +7 / +30 (`it.each`).
- Rotación:
  - `undefined` → 401 "Sesión inválida".
  - Revocada → 401 "Sesión revocada". Gana aunque también esté usada.
  - Usada → `ReplayError` con su `familiaId`.
  - `expira_at` igual a `ahora` → 401 "Sesión expirada"; lo mismo con `familia_expira_at`.
  - Vigente → pasa.
- Usuario:
  - `undefined` o inactivo → 401 "Usuario inactivo".
  - Sesión creada antes del cambio de contraseña → 401 "Sesión anterior al cambio de contraseña".
  - Creada en el mismo instante → pasa.
- `vencimientoRotado`:
  - Con la familia lejos → `ahora` + 7 días.
  - Con la familia a 2 días → `familiaExpiraAt`.

- [ ] Spec → falla; mover; pasa; puerta. Los 8 e2e de `auth-rotacion` son los que más importan aquí.
- [ ] Commit: `refactor(auth): extrae a reglas puras la validación y los vencimientos de sesión`.

### Tarea 11: Vehículos

**Archivos:** `src/modules/vehiculos/vehiculos.reglas.ts` (+ spec); modificar `vehiculos.service.ts`.

**Produce:**
- `CAMPOS_DECIMALES`
- `coercerDecimales(dto: Record<string, any>): Record<string, any>`
- `rechazarBloqueadoNulo(dto: { bloqueado?: boolean | null }): void`
- `clienteIdDeAlcance(user: { rol: string; cliente_id?: string | null }): string | null`. Devuelve `null` para el admin; para cualquier otro rol sin `cliente_id` lanza 404 "Vehículo no encontrado".
- `intentaDesbloquear(user: { rol: string }, dto: { bloqueado?: boolean | null }): boolean`
- `plantillaDesdeCliente(cli: Pick<ClienteRow, los 12 plantilla_*> | undefined): Partial<CreateVehiculoDto>`

**En el servicio:**
- `create` usa `plantillaDesdeCliente(cli)`.
- `updateRestricciones` usa `clienteIdDeAlcance` (empuja la condición si no es `null`) y `if (intentaDesbloquear(user, dto))`.
- Se borran los privados `coerceDecimals`, `rechazarBloqueadoNulo` y `DECIMAL_FIELDS`.

**Casos:**
- `coercerDecimales`:
  - Los decimales pasan a string (`100.5` → `"100.5"`).
  - `limite_trans_dia` y `placa` no cambian.
  - `null` sigue `null`.
  - No muta la entrada.
- `rechazarBloqueadoNulo`: `null` → 400 "bloqueado debe ser verdadero o falso"; `undefined`, `true` y `false` pasan.
- `clienteIdDeAlcance`:
  - Admin → `null`.
  - Cliente `"c1"` → `"c1"`.
  - Cliente sin empresa → 404.
  - Supervisor sin `cliente_id` → 404 (falla cerrado).
- `intentaDesbloquear`: sólo cliente + `false` → `true`. Cliente + `true`, admin + `false` y cliente sin `bloqueado` → `false`.
- `plantillaDesdeCliente`:
  - `undefined` → `{}`.
  - Decimales parseados (`"500.00"` → 500).
  - Enteros copiados.
  - `null` omitidos.
  - Productos `[]` omitidos; `["diesel"]` copiados.

- [ ] Spec → falla; mover; pasa; puerta.
- [ ] Commit: `refactor(vehiculos): extrae a reglas puras el alcance, la plantilla y la coerción`.

### Tarea 12: Usuarios

**Archivos:** `src/modules/usuarios/usuarios.reglas.ts` (+ spec); modificar `usuarios.service.ts`.

**Produce:**
- `exigirEmpresaSiEsCliente(rol: string | undefined, clienteId: string | null | undefined): void`. Se mueve con su comentario.
- `identificadoresDeAlta(datos: { email?: string | null; telefono?: string | null }): { email: string | null; telefono: string | null }`
- `exigirNoRegistrado(existente: unknown, campo: "email" | "teléfono"): void`
- `normalizarCambios<T extends { email?: string | null; telefono?: string | null }>(cambios: T): T`
- `clienteIdResultante(resto: { cliente_id?: string | null }, actual: { cliente_id: string | null }): string | null | undefined`
- `debeEnviarEnlaceDeAlta(u: { rol: string; email: string | null }): boolean`

**En el servicio:** `create` y `update` llaman a estas reglas en los mismos puntos. Las dos consultas de unicidad se quedan en `create`, seguidas de `exigirNoRegistrado`.

**Casos:**
- `identificadoresDeAlta`:
  - `"Ana@X.COM"` → `"ana@x.com"` con teléfono `null`.
  - `" 5555-1234 "` → `"5555-1234"`.
  - Nada, o los dos vacíos → 400 "Debe indicar un correo o un número de teléfono".
- `exigirEmpresaSiEsCliente`:
  - Cliente sin empresa → 400 "Un usuario cliente debe tener una empresa (cliente_id) asignada".
  - Cliente con empresa, admin sin empresa y rol `undefined` → pasan.
- `exigirNoRegistrado`: con fila → "El email ya está registrado" o "El teléfono ya está registrado"; `undefined` pasa.
- `normalizarCambios`:
  - Baja el correo a minúsculas y recorta el teléfono.
  - Sin `email` no agrega la clave.
  - No muta la entrada.
- `clienteIdResultante`:
  - Sin la clave → la empresa actual.
  - `cliente_id: null` → `null`. Quitar la empresa cuenta.
  - Otro id → ese id.
- `debeEnviarEnlaceDeAlta`: cliente con correo → `true`; cliente sin correo o admin → `false`.

- [ ] Spec → falla; mover; pasa; puerta.
- [ ] Commit: `refactor(usuarios): extrae a reglas puras los identificadores y el alcance del cliente`.

### Tarea 13: Saldos

**Archivos:** `src/modules/saldos/saldos.reglas.ts` (+ spec); modificar `saldos.service.ts`.

**Produce:**
- `validarMontoAbono(monto: string): void`
- `validarCuadre(dto: { tipo: string; cliente_id?: string | null }): void`
- `resumenEstadoCuenta(saldoPrevio: string | null | undefined, movimientos: { tipo: string; monto: string }[]): { saldo_inicial: string; total_abonos: string; total_debitos: string; saldo_final: string }`

**En el servicio:** en el `return` de `getEstadoCuenta`, `...resumenEstadoCuenta(previo?.saldo, movimientos)` va en la misma posición, para que el orden de las claves no cambie.

**Casos:**
- Abono:
  - `"100"` pasa.
  - `"0"`, `"0.000"` y `"-1"` → 400 "El monto debe ser mayor a cero".
  - **HALLAZGO H5 (menor):** `"abc"` pasa la regla. Hoy lo frena `@IsNumberString` del DTO.
- Cuadre: tipo `cliente` sin id → 400 `cliente_id es requerido cuando tipo es "cliente"`. Tipo `gasolinera`, y `cliente` con id, pasan.
- Resumen:
  - Previo `"100.000"` con crédito 50, débito 30.5 y débito 0.5 → `100.000 / 50.000 / 31.000 / 119.000`.
  - Previo `undefined` → saldo inicial `"0.000"`.
  - Sin movimientos → total de abonos y de débitos `"0.000"`.
  - Previo negativo `"-20"` se arrastra.
  - Siempre se cumple `inicial + abonos − débitos = final`.

- [ ] Spec → falla; mover; pasa; puerta.
- [ ] Commit: `refactor(saldos): extrae a reglas puras el abono, el cuadre y el resumen del estado de cuenta`.

### Tarea 14: Nivel 2 — token, password, guards, filtro y autenticación

Aquí no se mueve código salvo en `auth.service` y `password-reset.service`.

**Archivos:**
- Crear specs junto a: `src/auth/token.service.ts`, `password.service.ts`, `auth.guard.ts`, `roles.guard.ts`, `src/common/all-exceptions.filter.ts`, `src/auth/auth.service.ts` y `password-reset.service.ts`.
- Crear `src/auth/auth.reglas.ts` (+ spec).
- Modificar `auth.service.ts` y `password-reset.service.ts`.

**Produce (`auth.reglas.ts`):**
- `normalizarIdentificador(texto: string): string`. Recorta, y baja a minúsculas sólo si tiene `@`. Hoy está duplicada en login y en `solicitar`.
- `exigirTokenResetVigente<T extends { usado_at: Date | null; expira_at: Date }>(fila: T | undefined, ahora: Date): asserts fila is T`
- `exigirUsuarioActivoParaReset<T extends { activo: boolean }>(u: T | undefined): asserts u is T`
- Las dos últimas dan 400 "El enlace de recuperación no es válido o ya venció".

**En los servicios:**
- La consulta por identificador pasa a un privado `buscarPorIdentificador(id: string): Promise<Usuario | undefined>` en cada servicio. Así las pruebas lo espían, como hace `recordatorios.service.spec.ts`, sin simular Drizzle.
- `reset()` usa las dos reglas.

**Casos:**
- `auth.reglas`:
  - `normalizarIdentificador`: `"  Ana@X.com "` → `"ana@x.com"`; `" 5555-1234 "` → `"5555-1234"` (sin bajar).
  - Token:
    - `undefined`, usado, o vencido (con `expira_at` igual a `ahora` incluido) → 400.
    - Vigente → pasa.
  - Usuario `undefined` o inactivo → 400.
- `TokenService`:
  - No arranca sin secreto, ni con uno de 31 caracteres.
  - Firmar y verificar devuelve los mismos claims, con `iss`/`aud`.
  - Devuelven `null`, sin lanzar:
    - otro secreto;
    - token vencido: con fake timers vale a los 14:59 y es `null` a los 15:01;
    - `alg: none` armado a mano;
    - otra audiencia u otro emisor;
    - basura.
- `PasswordService`:
  - El hash empieza con `$argon2id$` y lleva `m=19456,t=2,p=1`.
  - La contraseña correcta da `true` y la incorrecta `false`.
  - Un hash corrupto da `false`, sin lanzar.
  - Dos hashes de la misma contraseña difieren.
  - La temporal tiene 14 caracteres por defecto y respeta el largo pedido.
  - En 50 temporales de 40 caracteres no aparece ningún carácter ambiguo (`/^[A-HJ-NP-Za-km-np-z2-9]+$/`).
- `AuthGuard` (con un `ExecutionContext` de mentira):
  - Sin token, o con un header `Basic` → 401 "Token requerido".
  - Toma el Bearer.
  - La cookie `ef_at` gana sobre el header.
  - Token inválido → 401 "Token inválido", sin consultar la sesión.
  - Sesión muerta → 401 "Sesión no vigente", consultada con `claims.sid`.
  - Caso válido → `true` y deja `req.user`.
- `RolesGuard` (con el `Reflector` de mentira):
  - Sin metadata, o con `[]` → `true`. Fija que `@Auth()` sin roles admite a cualquier autenticado.
  - Rol incluido → `true`.
  - Rol ajeno, o sin usuario → 403 "Permisos insuficientes".
- `AllExceptionsFilter`:
  - 400 → mismo status y `getResponse()`, sin log.
  - 403 → `warn` con "POST /api/v1/despachos 403".
  - `HttpException` 503 → `error`.
  - `Error` con texto de la base → 500 con cuerpo exacto `{statusCode:500, message:"Error interno del servidor"}`, sin el texto original, y el stack al log.
  - Un string lanzado → 500.
- `AuthService` (dobles de Password, Token y Session; `buscarPorIdentificador` espiado):
  - Busca el correo normalizado.
  - Usuario inexistente → igual verifica contra el señuelo y responde 401 "Credenciales inválidas".
  - El señuelo se hashea una sola vez en dos intentos.
  - Contraseña mala → 401, sin abrir sesión.
  - Usuario inactivo con la contraseña correcta → el mismo 401.
  - Login correcto:
    - abre la sesión con `meta`;
    - firma con `{sub, rol, gasolinera_id, cliente_id, sid}`;
    - responde con `expires_in` 900;
    - el perfil no trae `password_hash`.
  - El refresh firma con el `sid` y el refresh token de la sesión rotada.
- `PasswordResetService` (`emitirToken` y `buscarPorIdentificador` espiados; Mail y Config de mentira):
  - `enviarEnlace`:
    - Sin correo → 400 "El usuario no tiene correo registrado; usá el modo de contraseña generada", sin emitir token.
    - Con `FRONTEND_URL` terminada en `/`, el enlace queda sin doble barra (`…/reset?token=tok-123`).
    - Sin `FRONTEND_URL`, el enlace es relativo. Se fija como está.
    - El nombre `<b>Ana</b>` va escapado en el HTML y crudo en el texto.
  - `solicitar`:
    - Normaliza el identificador.
    - Usuario inexistente, inactivo o sin correo → no envía y resuelve sin error.
    - Si el proveedor falla → resuelve igual y registra el error.

- [ ] Specs → corren (los de nivel 2 pasan desde el inicio; los de `auth.reglas` fallan hasta crear el archivo); mover lo de `auth`; todo pasa; puerta.
- [ ] Commit: `test(auth): pruebas de tokens, contraseñas, guards, filtro de excepciones y login`.

### Tarea 15: Nivel 2 — almacenamiento, correo, PDF y Excel

**Archivos:**
- Specs junto a `src/storage/r2-storage.service.ts`, `src/mail/resend-mail.service.ts`, `src/modules/saldos/pdf/estado-cuenta-template.ts`, `saldos-pdf.service.ts`, `src/modules/reportes/pdf/html-template.ts`, `reportes-pdf.service.ts` y `src/modules/despachos/despachos-excel.service.ts`.
- `package.json`: en `jest.moduleNameMapper`, `"^puppeteer$": "<rootDir>/../test/__mocks__/puppeteer.js"`. Es el mismo mock de los e2e: registra `jsHabilitado`, `interceptacionActiva`, `eventos` y `html` en `__paginas`.

**Técnica de los dobles:**
- R2: tras `onModuleInit`, se reemplaza `client` por `{ send: jest.fn() }`. `NoSuchKey` se instancia del SDK real.
- Resend: `jest.spyOn(global, "fetch")` con `Response` reales.
- PDF: con el mock de puppeteer.
- Excel: se espían los privados `fetchRows` y `fetchRenglones`, y el buffer resultante se lee con `ExcelJS.Workbook().xlsx.load`.

**Casos:**
- R2:
  - Sin cualquiera de las 4 variables no arranca (`it.each`): "Faltan variables de R2…".
  - `put` manda un `PutObjectCommand` con `{Bucket, Key, Body, ContentType}`.
  - Si `put` falla → 500 "No se pudo guardar la firma".
  - `get` devuelve el cuerpo y el content type; sin content type → `application/octet-stream`.
  - `NoSuchKey` → `null`. Otro error → 500 "No se pudo leer la firma".
  - `delete` fallido no lanza y registra un `warn`.
- Resend:
  - Sin `RESEND_API_KEY` o sin `MAIL_FROM` no arranca.
  - Hace un POST a `https://api.resend.com/emails` con `Authorization: Bearer …` y el cuerpo `{from, to:[para], subject, html, text}`.
  - Fallo de red → 500 "No se pudo enviar el correo".
  - Un 403 con cuerpo "dominio no verificado" → el mismo 500, y el log lleva el status y el detalle.
- Plantilla del estado de cuenta:
  - El saldo corrido sale de las celdas `num strong`: con inicial 100, +50, −30.5 y −0.5 da `150.00`, `119.50` y `119.00`.
  - `<script>` y `'` en el nombre y en la descripción van escapados.
  - Sin NIT no aparece "NIT".
  - Sin movimientos → "Sin movimientos en el período".
  - `2026-10-08T03:00Z` se imprime como `07/10/2026` (fecha de Guatemala).
- `SaldosPdfService`:
  - Devuelve un buffer que empieza con `%PDF-`.
  - La página queda con JS apagado, interceptación activa y un listener de `request`.
  - Los cuatro rótulos de período aparecen en el HTML (`it.each`): rango, "Desde …", "Hasta …" y "Histórico completo".
- Plantilla de reportes:
  - Una placa `<img src=x onerror=alert(1)>` sale escapada.
  - El nombre del cliente y el período se escapan.
  - Sin gráficas no hay `chart-img`. Con la gráfica donut, el data URL va en el `src`.
- `ReportesPdfService` (resumen, vehículos y pilotos de mentira; `fetchDespachos` espiado):
  - Cliente sin empresa → 403 "Cliente sin empresa asignada", sin llamar a reportes ni abrir el navegador.
  - Cliente → el `cliente_id` del token pisa el del DTO, en el resumen y en `fetchDespachos`.
  - Admin → respeta el `cliente_id` del DTO.
  - Sin fechas → "Todos los períodos".
- Excel:
  - Un vale sólo de canecas aparece, sin placa ni piloto, con su texto de renglones en la columna 15.
  - Fecha y hora salen en hora de Guatemala (`2026-10-08T03:00Z` → día 7, 21 h).
  - El subtítulo dice "2 registros", o "1 registro" con uno solo.
  - Resumen: B2 = cantidad, B3 = galones, B4 = monto.
  - Filtros: "(todos)" o "(sin límite)" por defecto, y el valor cuando viene.
  - Un cliente sin empresa exporta un libro vacío sin tocar la base (`db` vacío, sin espías).

- [ ] Specs + mapper; todo pasa; puerta.
- [ ] Commit: `test: pruebas de R2, Resend, plantillas PDF y export a Excel`.

### Tarea 16: Documentación, hallazgos y verificación final

**Archivos:**
- La spec: agregar la sección `## Hallazgos`.
- `gasolineras-os-backend/CLAUDE.md`, sección "Testing".
- `../CLAUDE.md` (workspace): la sección de la costura y la de backend.

- [ ] Agregar a la spec la sección `## Hallazgos`, con H1–H5. Cada uno lleva qué pasa, dónde, la prueba que lo fija (nombre `HALLAZGO Hn`) y qué haría falta para corregirlo. Ninguno se corrige aquí.
- [ ] `CLAUDE.md` del backend, sección "Testing":
  - el conteo nuevo de unit tests;
  - la convención `*.reglas.ts` (puras, reciben `ahora`, mensajes exactos);
  - el umbral de `pnpm test:cov`;
  - el helper `test/unit/esperar-error.ts`;
  - el mapper de puppeteer en las pruebas unitarias.
- [ ] `CLAUDE.md` del workspace:
  - Corregir "there is no `saldos` or `reportes` API": las dos existen (`/saldos/*`, `/reportes/*`), y lo que falta es que `useReportes.ts` las use.
  - Corregir "Testing reality: one trivial unit spec".
  - Este cambio va en el repo del workspace, con su propio commit y push aparte, sólo si Milton lo pide.
- [ ] Verificación final completa: `pnpm test`, `pnpm test:cov`, `pnpm test:e2e` (237), `tsc` del build y `pnpm build`. Pegar los conteos en el resumen.
- [ ] Commit del backend: `docs: pruebas unitarias del backend, convención de reglas y hallazgos`.
- [ ] Presentarle a Milton los hallazgos H1–H5 para que decida cuáles se corrigen. No hacer merge ni push sin que lo pida.
