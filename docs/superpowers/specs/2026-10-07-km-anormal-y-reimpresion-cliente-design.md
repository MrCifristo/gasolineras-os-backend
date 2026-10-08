# Kilometraje anormal, kilometraje visible y reimpresión de vales por el cliente

Fecha: 2026-10-07 · Estado: en revisión. Ramas propuestas: `km-anormal` en ambos repos (backend desde `main`, frontend desde `mock-data-branch`).

## Objetivo

Tres mejoras que Milton pidió el 2026-10-07:

1. El cliente reimprime los vales de **sus** despachos, como ya lo hace el admin.
2. El cliente ve el kilometraje de cada despacho en su tabla y en el Excel que descarga.
3. El sistema detecta un kilometraje **anormal**, no solo uno menor al anterior: saltos imposibles (error de digitación) y rendimientos sospechosos (posible desvío de combustible).

> **Sección 3 en pausa (2026-10-07).** Antes de implementarla, Milton va a confirmar con el personal de la gasolinera cómo cargan los clientes. El método "tanque a tanque" supone que cada carga llena el tanque; con cargas por monto (Q300 un día, Q1 500 otro) el rendimiento varía más del ±40 % sin que pase nada raro, y la etiqueta, que el cliente ve en su portal, se llenaría de falsas alarmas. Según la respuesta, el rendimiento se mide por carga, sobre una ventana de 3 cargas o se omite y queda solo el salto. Los defaults (1 500 km de salto y la tolerancia) también se confirman con el personal. Las secciones 1 y 2 no dependen de esto y avanzan ya.

**Criterio de éxito:** un despacho con km anormal no pasa en la tablet sin que el supervisor lo confirme; si lo confirma, queda marcado con su motivo y tanto el admin como el cliente lo ven y lo filtran. El cliente imprime el vale de cualquiera de sus despachos y nunca el de otro cliente. Los e2e existentes siguen en verde.

## Decisiones cerradas

| Tema | Decisión |
|---|---|
| Qué se detecta | Ambos casos: salto de km entre cargas y rendimiento (km/gal) fuera de lo normal. |
| Qué pasa al detectarlo | La tablet avisa y pide confirmar. Si el supervisor confirma, se despacha y queda marcado. No se rechaza. |
| Quién lo ve | Admin y cliente: etiqueta con motivo en la tabla, filtro "Solo km anormal" y columnas en el Excel. Sin notificaciones. |
| De dónde sale "lo normal" | Del historial del vehículo, con ajuste manual opcional por vehículo (rendimiento esperado y salto máximo), editable por admin y cliente junto a las demás restricciones. Sin historial ni valor fijado, solo aplica el salto máximo. |
| Método | Rendimiento por carga ("tanque a tanque"): km recorridos desde la carga anterior entre los galones del renglón vehículo de esta carga. |
| Defaults globales | Salto máximo 1 500 km; tolerancia de rendimiento ±40 %. Editables por el admin. |
| Historial mínimo | 5 cargas válidas; se usan las últimas 10. Constantes en código, no configurables. |
| Reimpresión del cliente | Mismo mecanismo que el admin (`ValeImpresion` + `imprimirVale()`); formato ticket de 80 mm. |

## Contexto

- `validarKilometraje` (`despachos.reglas.ts`) rechaza con 403 "Inconsistencia de kilometraje detectada" si el km es menor o igual al `MAX(kilometraje)` histórico del vehículo. Solo corre si el DTO trae `kilometraje` y `vehiculo_id`; los despachos solo de contenedores guardan `kilometraje` nulo.
- `vehiculos` no tiene capacidad de tanque, rendimiento ni clase. Las restricciones son columnas de `vehiculos` y se editan con `PATCH /vehiculos/:id/restricciones` (admin y cliente, este solo sobre los suyos).
- `configuracion_sistema` es una fila única (`sistema_bloqueado`, …) con `GET` (admin, supervisor) y `PATCH` (admin).
- `despacho_detalles` guarda cada renglón con `renglon ∈ {vehiculo, caneca, tonel}` y sus `galones`.
- Reimpresión del admin (`admin/despachos/page.tsx`): `getDespacho(id)` + `firmaDataUrl(id)`, monta `ValeImpresion` fuera del modal y llama a `imprimirVale()`. El nombre de quien despachó sale de `listUsuarios()` (`GET /usuarios`, solo admin). El supervisor (`operario/historial`) repite el mismo flujo con `user.nombre`.
- `GET /despachos/:id` y `GET /despachos/:id/firma` ya admiten `cliente` y filtran por su `cliente_id` (404 si es ajeno). El sobre de `findOne` trae despacho, vehículo, piloto, gasolinera, precio, cliente, operario y detalles; **no** trae al despachador.
- `DespachoTable` es compartida por admin/despachos, admin/clientes/[id], el portal del cliente y su dashboard. El Excel del portal se arma en el cliente (`DespachosContent.tsx`, `xlsx`) sin kilometraje; el Excel del backend (`despachos-excel.service.ts`) ya lo trae.
- El mapper convierte `kilometraje` con `toNum`, así que un nulo probablemente se vuelve 0.
- `AllExceptionsFilter` devuelve tal cual el cuerpo de una `HttpException`; `HttpError` del frontend solo conserva `status` y `message`.

## 1. Reimpresión del vale por el cliente

**Backend.** `findOne` agrega al sobre `despachador: { id, nombre } | null` (unión con `usuarios` por `despachador_id`). Es un campo nuevo, no rompe a nadie. El alcance por rol no cambia.

**Frontend.**
- Un hook compartido (`useReimpresionVale`) encapsula lo que hoy está duplicado en admin y supervisor: pedir despacho y firma, avisar si la firma no carga (decisión del 30-sep: no se imprime sin ella), montar el estado para `ValeImpresion` y disparar `imprimirVale()`. Admin y supervisor pasan a usarlo; el admin deja de depender de `listUsuarios()` para el nombre del despachador y toma `despachador.nombre` del sobre.
- `DespachoTable` recibe un `onReimprimir` opcional; cuando está presente, cada fila muestra el botón "Reimprimir vale" (amarillo: es una acción física, según el Design System). El portal del cliente lo pasa; el espejo del portal en el admin lo hereda.
- `ValeImpresion` se monta fuera de cualquier modal, igual que en admin. La regla global de aislamiento de `globals.css` ya cubre cualquier página.

**Riesgo conocido.** En una impresora de oficina el vale sale angosto (formato 80 mm). El diálogo del navegador permite "Guardar como PDF". No se diseña un formato carta en este alcance.

## 2. Kilometraje en la tabla y en el Excel

- `Despacho.kilometraje` pasa a `number | null` en `src/types/index.ts` y el mapper usa `toNumOrNull`. Hay que revisar los usos que asumen número (el vale imprime km; reportes calcula km/gal).
- `DespachoTable` recibe `showKilometraje`; la columna muestra el km con separador de miles y `tabular-nums`, o "—" si es nulo. Se activa en el portal del cliente, su espejo en admin y admin/despachos. El `colSpan` hoy fijo (`7 + …`) se calcula a partir de las columnas visibles.
- El Excel del portal agrega la columna "Kilometraje".

## 3. Kilometraje anormal

### Datos (una migración generada con `pnpm db:generate`)

| Tabla | Columna | Tipo | Notas |
|---|---|---|---|
| `despachos` | `km_anormal` | boolean, not null, default false | |
| `despachos` | `km_anormal_motivo` | text, nullable | Texto en español listo para mostrar. |
| `vehiculos` | `rendimiento_esperado` | numeric(6,2), nullable | km/gal. Nulo = usar historial. |
| `vehiculos` | `km_salto_maximo` | integer, nullable | Nulo = usar el global. |
| `configuracion_sistema` | `km_salto_maximo_default` | integer, not null, default 1500 | |
| `configuracion_sistema` | `tolerancia_rendimiento_pct` | integer, not null, default 40 | Rango válido 5–90. |

### Regla pura

`evaluarKilometraje(entrada) → { anormal: false } | { anormal: true, motivo: string }` en `despachos.reglas.ts`, sin reloj ni BD, con 100 % de cobertura como las demás reglas. Entrada:

- `km`: el kilometraje ingresado.
- `kmAnterior`: el mismo `MAX(kilometraje)` que ya consulta `validarKilometraje` (nulo si no hay cargas previas).
- `galonesVehiculo`: suma de galones de los renglones `vehiculo` de esta carga (0 si el vehículo solo lleva contenedores).
- `historial`: las últimas 11 cargas del vehículo con km no nulo y `km_anormal = false`, ordenadas por `despachado_at`, cada una con su km y sus galones de renglón vehículo. De ahí salen hasta 10 rendimientos por pares consecutivos; se descartan los pares con galones 0 o delta ≤ 0.
- `rendimientoEsperado`, `saltoMaximoVehiculo` (nulos si no se fijaron), `saltoMaximoGlobal`, `toleranciaPct`.

Orden de evaluación (se reporta el primer motivo que aplique):

1. Sin `kmAnterior` → normal (primera carga del vehículo).
2. **Salto:** `km − kmAnterior > (saltoMaximoVehiculo ?? saltoMaximoGlobal)` → motivo "Salto de 2 340 km desde la última carga (máximo 1 500 km)".
3. **Rendimiento:** referencia = `rendimientoEsperado`, o si es nulo la mediana del historial cuando hay al menos 5 rendimientos; sin referencia o con `galonesVehiculo = 0` se omite. Rendimiento actual = `(km − kmAnterior) / galonesVehiculo`. Fuera de `[ref × (1 − t), ref × (1 + t)]` → motivo "Rendimiento de 3.1 km/gal; lo normal para este vehículo es 8.4 km/gal".

Los números del motivo se redondean (km enteros con separador de miles, km/gal a un decimal).

**Por qué se excluyen del historial las cargas ya marcadas:** para que un desvío confirmado no se vuelva "lo normal".

**Limitación aceptada:** con cargas parciales (por monto fijo) el método tanque a tanque da falsos positivos. Como la acción es confirmar y marcar, el costo es un toque del supervisor. Si en la práctica molesta, se ajusta la tolerancia.

### Flujo de creación del despacho

- `CreateDespachoDto` agrega `confirmar_km_anormal?: boolean` (`@IsOptional() @IsBoolean()`; con `forbidNonWhitelisted` es obligatorio decorarlo).
- En `create()`, la evaluación corre justo después de `validarKilometraje` y antes de abrir la transacción (es pre-lock, igual de TOCTOU que las demás validaciones, por diseño). Solo corre si hay `kilometraje` y `vehiculo_id`.
- Anormal y sin confirmación → `ConflictException` (409) con cuerpo `{ statusCode: 409, codigo: "KM_ANORMAL", message: "Kilometraje anormal: <motivo>", motivo }`. No se inserta nada ni se sube la firma. **La subida de la firma a R2 ocurre antes de la transacción; hay que verificar que la evaluación quede antes de esa subida**, para no dejar objetos huérfanos en cada 409.
- Anormal y confirmado → se inserta con `km_anormal = true` y el motivo. Normal → `km_anormal = false`, motivo nulo, aunque venga la bandera.
- La regla existente de km menor sigue igual (403) y va primero.

### Tablet del supervisor

- `HttpError` gana un campo opcional con el cuerpo del error (o al menos `codigo`) sin cambiar su uso actual.
- `DespachoForm`, ante un 409 `KM_ANORMAL`, muestra un diálogo con el motivo y dos acciones: "Corregir kilometraje" (vuelve al campo con la firma conservada) y "Confirmar y despachar" (reenvía la misma carga con `confirmar_km_anormal: true`). Después sigue el flujo normal de impresión.

### Visibilidad

- `GET /despachos` y `GET /despachos/:id` devuelven `km_anormal` y `km_anormal_motivo` (ya salen con `getTableColumns`); el mapper los incorpora al tipo `Despacho`.
- `GET /despachos` acepta `km_anormal=true` como filtro, con el mismo alcance por rol. El frontend lo usa con un interruptor "Solo km anormal" junto a los filtros existentes (o filtra en el cliente si así funcionan hoy los demás filtros; se decide en el plan leyendo `DespachoTable`).
- En la columna de kilometraje, un despacho marcado lleva una etiqueta "Km anormal" (tokens del Design System, no solo color: lleva el texto) y el motivo como texto secundario.
- Excel del portal y Excel del backend: columnas "Km anormal" (Sí / vacío) y "Motivo km".

### Configuración

- `UpdateRestriccionesVehiculoDto` acepta `rendimiento_esperado` (decimal > 0 o null) y `km_salto_maximo` (entero > 0 o null). `VehiculoRestriccionesModal` agrega una sección "Control de kilometraje" con ambos campos y el texto de ayuda "Vacío: se calcula del historial / se usa el valor general".
- `UpdateConfiguracionDto` acepta `km_salto_maximo_default` (entero ≥ 100) y `tolerancia_rendimiento_pct` (5–90). `/admin/control` agrega una tarjeta con ambos.

## Contrato y demo

- `docs/contrato-frontend.md` documenta: `despachador` en `findOne`, campos `km_anormal*`, el 409 `KM_ANORMAL` y su bandera, el filtro `km_anormal`, los campos nuevos de vehículo y de configuración.
- Handlers MSW: reproducen el 409 cuando el salto supera el default y aceptan la bandera; las respuestas incluyen los campos nuevos (kilometraje como string, igual que hoy).
- `seed:demo` no cambia en este alcance.

## Pruebas

**Unitarias (`despachos.reglas.spec.ts`)** de `evaluarKilometraje`: primera carga; salto justo en el límite y uno por encima; salto con máximo del vehículo frente al global; rendimiento con valor fijado (dentro, en el borde y fuera por arriba y por abajo); mediana con 4 rendimientos (se omite) y con 5 o más; pares inválidos descartados; `galonesVehiculo = 0`; prioridad del salto sobre el rendimiento; texto exacto de los motivos. Las reglas nuevas de validación de los DTO de restricciones y configuración que vivan en `*.reglas.ts` se prueban igual, con `esperarError` (clase y mensaje exacto). `pnpm test:cov` debe seguir en 100 % sobre `*.reglas.ts`.

**E2E** (en la suite que corresponda, con `--runInBand`):
- Un salto mayor al default da 409 `KM_ANORMAL` y no crea el despacho, no mueve el saldo ni consume número de vale.
- Con la bandera → 201, `km_anormal = true` y el motivo guardado.
- Rendimiento fuera de tolerancia con 5 cargas sembradas → 409; con 4 → 201 sin marca.
- Valores por vehículo: mandan sobre los globales; el cliente los edita en su vehículo y recibe 403/404 en uno ajeno.
- `PATCH /configuracion-sistema` valida rangos; el supervisor no puede cambiarlos.
- El filtro `km_anormal=true` respeta el alcance del cliente.
- `GET /despachos/:id` trae `despachador`; un cliente recibe 404 al pedir el despacho o la firma de otro cliente.
- La regla de km menor sigue dando 403 antes que la nueva.

**Frontend:** `pnpm type-check`, `pnpm lint` y `pnpm build`; verificación manual en vivo de reimpresión desde el portal, el diálogo de la tablet y las columnas del Excel.

## Fuera de alcance

Notificaciones por correo o push; cambio de odómetro o reinicio del historial; revalidar el km en el `PATCH /despachos/:id` del admin; formato carta del vale; marcar anomalías en la semilla de demo.
