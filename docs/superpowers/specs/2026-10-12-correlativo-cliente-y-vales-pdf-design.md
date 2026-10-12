# Correlativo por cliente y vales en PDF para el cliente

**Fecha:** 2026-10-12 · **Repos:** backend y frontend · **Estado:** diseño aprobado por Milton, pendiente de plan.

## Por qué

1. **Conciliación del cliente.** El número de vale (`A-000123`) es un correlativo **por gasolinera y serie**: un cliente recibe números salteados, porque entre un vale suyo y el siguiente hay vales de otros clientes. Al revisar su estado de cuenta no puede saber si le falta un vale.
2. **Impresión fuera de la bomba.** En una PC, la reimpresión usa `window.print()` con el vale de 80 mm pensado para la térmica: en una impresora carta sale una tira en la esquina de la hoja, y sólo de a uno. Los clientes usan los vales para su **archivo contable**, para **conciliar el estado de cuenta** y para el **control por vehículo o piloto**.

## Decisiones de Milton (2026-10-12)

- **Numeración B: dos números.** Se conserva el de la estación (control de la bomba) y se agrega un **correlativo propio por cliente** ("N° cliente"), sin huecos, compartido por las dos estaciones. Se descartaron "dejarlo como está" y "un solo número por cliente" (la estación perdería su secuencia y cambiaría lo impreso).
- **Lote: un PDF tamaño carta con 4 vales por hoja**, ordenado por N° cliente. Se descartaron un vale por hoja (cientos de hojas al mes) y un ZIP de PDFs (incómodo para revisar).
- **Generación en el backend con Chrome (puppeteer)**, la misma infraestructura del estado de cuenta y del reporte PDF. Se descartaron `jspdf` + `html2canvas` en el navegador (rasteriza, una descarga por firma, se traba con lotes grandes) y `pdfkit` (dependencia nueva y rehacer el diseño a mano).

## 1. Correlativo por cliente (backend)

- **Columna** `despachos.correlativo_cliente` (entero, NOT NULL tras el backfill) e **índice único** `(cliente_id, correlativo_cliente)`. Es por cliente en todo el sistema, no por estación.
- **Asignación** en `create` de despachos, dentro de la misma transacción y **después** del advisory lock de gasolinera+serie: un segundo `pg_advisory_xact_lock` con una clave por cliente (`hashtext('CLIENTE:' || cliente_id)`), y `MAX(correlativo_cliente) + 1` del cliente. Orden fijo de los locks (estación → cliente) en todas las transacciones que los tomen, para que no puedan trabarse. Un 23505 del índice nuevo se traduce a 409, igual que el del número de vale (`esViolacionUnica`).
- **Migración 0009:** agrega la columna nullable, numera los vales existentes por cliente ordenados por `despachado_at` y `id` (`ROW_NUMBER() OVER (PARTITION BY cliente_id ORDER BY despachado_at, id)`), la pasa a NOT NULL y crea el índice único. Corre en el pre-deploy de Railway como las anteriores.
- **Respuestas:** `GET /despachos` (lista y detalle) devuelven `correlativo_cliente`. El Excel del admin (`despachos-excel.service`) suma la columna **"N° Cliente"**.
- **Estado de cuenta** (`GET /saldos/cliente/:id/estado-cuenta` y su PDF): cada movimiento de débito con `despacho_id` trae el `correlativo_cliente` de su despacho por JOIN. El texto guardado en el ledger **no** se reescribe.
- **Ventas de insumos:** no llevan correlativo de cliente (tienen su propia serie y su lock).

## 2. Dónde se ve (frontend)

- `Despacho.correlativo_cliente: number` en `src/types/index.ts`, coercionado en `mappers.ts`.
- **`DespachoTable`** (admin, historial del supervisor, portal del cliente): columna **"N° cliente"** junto a "Vale". No se agrega ordenamiento: la tabla no ordena columnas (el backend entrega por fecha descendente) y, como el correlativo se asigna en orden de despacho, para un cliente ese orden ya es su secuencia.
- **Excel del portal del cliente** (`DespachosContent`): columna "N° cliente".
- **Estado de cuenta** (`CuentaContent` y su PDF): el N° cliente en cada débito.
- **Vale de la bomba:** la línea "N° cliente: 45" bajo el número de vale, en original y copia, **en los dos formatos a la vez**: `valeEnXml` (térmica) y `ValeImpresion` (HTML). Regla vigente: cambiar uno es cambiar el otro.
- **MSW:** los datos semilla y el `POST /despachos` del demo numeran por cliente, para que el modo demo muestre lo mismo.

## 3. PDF de vales (backend)

- **Endpoint** `GET /despachos/vales/pdf`, roles admin, supervisor y cliente.
  - **Filtros:** los mismos de `GET /despachos` (cliente, gasolinera, vehículo, piloto, tipo de combustible, `fecha_desde`/`fecha_hasta` en días de Guatemala) **o** `ids` (lista separada por comas) para uno o varios vales concretos.
  - **Alcance:** exactamente el del listado. Cliente sólo lo suyo (ignora un `cliente_id` ajeno; sin empresa, 403 como en reportes); supervisor sólo su estación; fail-closed. Un `id` fuera de alcance no aparece (no se filtra su existencia).
- **Orden:** `cliente`, luego `correlativo_cliente` ascendente.
- **Tope:** 500 vales. Con más, **400** `"Son N vales; acota el período o los filtros (máximo 500 por PDF)."`. Sin vales, **404** `"No hay vales con esos filtros"`.
- **Plantilla** (función pura, al estilo de `html-template.ts` y `estado-cuenta-template.ts`): hoja carta, **4 vales por hoja** (2×2) con líneas de corte, sin partir un vale entre hojas. Cada vale: estación y ciudad, N° de vale de la estación, **N° cliente**, fecha y hora de Guatemala, turno, bomba, cliente y NIT, vehículo, piloto, kilometraje (o "—"), cada renglón (tipo, galones, precio/galón, monto), total, operario, "Despachado por" y la firma. Pie: **"Copia digital — generada el <fecha y hora GT>"**: nunca dice ORIGINAL.
- **Firmas:** se leen de `StorageService` en el servidor, con concurrencia acotada (10 a la vez). Si una falla o el vale no tiene, ese vale muestra **"Firma no disponible"** y el lote sigue. (Difiere a propósito de la reimpresión individual de la bomba, que no imprime sin firma.)
- **Seguridad:** todo dato interpolado pasa por `escapar-html`; la firma sólo entra como data-URL de imagen PNG. Chrome con `CHROME_SIN_SANDBOX` (`src/common/chrome.ts`), como los otros PDF.
- **Respuesta:** `application/pdf`, `Content-Disposition: attachment; filename="vales-<cliente>-<desde>-a-<hasta>.pdf"` (con `ids` de un solo vale: `vale-<serie>-<numero>.pdf`).

## 4. Interfaz (frontend)

- **Despachos del portal del cliente** (y su espejo en el admin): botón **"Descargar vales (PDF)"** junto al Excel, con los filtros activos. El listado ya trae `total`: si pasa de 500, el botón avisa sin pedir nada. Estado de carga mientras genera; error visible (el mensaje del backend).
- **Despachos del admin:** el mismo botón con los filtros del admin.
- **Reimpresión en PC** (admin, portal del cliente): `useReimpresionVale` deja de llamar a `window.print()` fuera de Android y **descarga el PDF de ese vale** (`ids=<id>`). En **Android** (tablet de la bomba) no cambia: térmica por TM Print Assistant. `ValeImpresion` (HTML de 80 mm) queda sólo para el formulario de la bomba fuera de Android; no se toca.
- **Helper de descarga** compartido (blob → archivo con nombre), extraído de la descarga del PDF del estado de cuenta, que pasa a usarlo.
- **MSW (modo demo sin backend):** `GET /despachos/vales/pdf` responde 400 `"La descarga de vales en PDF no está disponible en el modo demo"`. La demo con `gasfuel_demo` y el backend real la tiene completa.

## Pruebas

- **Unitarias (backend):** la plantilla escapa HTML, muestra los dos números, pone "Firma no disponible" y el pie de copia digital, y agrupa de a 4 por hoja; el cálculo del nombre de archivo; la regla del tope (499, 500 → pasa; 501 → 400 con el mensaje exacto). Las reglas puras van en `*.reglas.ts` con 100% de cobertura.
- **E2E (backend):** un cliente que despacha en las dos estaciones recibe 1, 2, 3 seguidos; dos clientes no comparten secuencia; la respuesta y el detalle traen `correlativo_cliente`; el estado de cuenta trae el correlativo en cada débito; el endpoint de PDF respeta el alcance (cliente ajeno no ve vales ajenos, ni por filtro ni por `ids`), ordena por correlativo, aplica el tope y responde `application/pdf` (puppeteer va mockeado en e2e).
- **Migración:** contra la base demo, después de migrar, cada cliente tiene correlativos 1..N sin huecos ni repetidos y en el orden de `despachado_at`.
- **Frontend:** type-check, lint y build; verificación en el navegador contra `gasfuel_demo`: la columna en tabla, Excel y estado de cuenta; el botón descarga un PDF válido con el número de hojas esperado (`ceil(N/4)`); la reimpresión en PC baja el vale correcto; un PDF real generado con Chrome se revisa a ojo.

## Fuera de alcance

- Numerar por cliente las ventas de insumos.
- Que el admin elija gasolinera para despachar (decisión del 12-oct: el admin no despacha).
- Descargar vales sueltos en un ZIP.
