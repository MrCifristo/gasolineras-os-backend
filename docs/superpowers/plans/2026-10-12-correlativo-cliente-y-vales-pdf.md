# Correlativo por cliente y vales en PDF — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Sin código literal** (preferencia de Milton, ver memoria `planes-sin-codigo-literal`): cada tarea da firmas exactas, casos de prueba como entrada → resultado esperado, qué se mueve y la puerta de verificación. El código se escribe una sola vez, al implementar.

**Goal:** Un correlativo propio por cliente ("N° cliente") además del número de vale de la estación, visible en tabla, Excel, estado de cuenta y vale impreso; y un PDF carta con 4 vales por hoja para descargar uno o un lote.

**Architecture:** Backend: columna `despachos.correlativo_cliente` asignada bajo un segundo advisory lock por cliente; endpoint `GET /despachos/vales/pdf` que reutiliza las condiciones del listado, arma HTML con una plantilla pura y lo imprime con Chrome. Frontend: columna nueva en tablas/Excel/estado de cuenta, línea nueva en los dos formatos del vale de la bomba, botón de lote y reimpresión en PC como descarga de PDF.

**Tech Stack:** NestJS 11 + Drizzle (node-postgres), puppeteer, Jest 30; Next.js 15 + React 19, MSW.

**Spec:** `gasolineras-os-backend/docs/superpowers/specs/2026-10-12-correlativo-cliente-y-vales-pdf-design.md`

## Global Constraints

- Ramas: `correlativo-vales-pdf` en **los dos repos**, desde `main`. `main` es producción: se mergea y se sube al final (backend antes que frontend), con permiso de Milton.
- Commits en español, Conventional Commits, **sin `Co-Authored-By`**.
- Backend: `pnpm lint:check` en 0, cero `any`, `tsc --noEmit` limpio; reglas puras en `*.reglas.ts` con 100% de cobertura (`pnpm test:cov`); e2e con `pnpm test:e2e` (Postgres local en 5433).
- Frontend: `pnpm type-check`, `pnpm lint` (sólo el warning previo de `UsuarioModal`), `pnpm build`; toda respuesta pasa por `mappers.ts`.
- Fechas de negocio en días de Guatemala (`fechaGtSql`, `fechaGuatemala`); nunca `toISOString().slice(0, 10)` para un día de negocio.
- Etiqueta visible: **"N° cliente"**. Pie del PDF: **"Copia digital — generada el <fecha y hora GT>"**. Tope: **500** vales por PDF.
- Mensajes exactos: `"Cliente sin empresa asignada"` (403) · `"Son N vales; acota el período o los filtros (máximo 500 por PDF)."` · `"No hay vales con esos filtros"` · `"Firma no disponible"` · `"La descarga de vales en PDF no está disponible en el modo demo"`.
- Diseño UI: `Design System.md` (bordes 0.5px, variables CSS, Tabler outline, amarillo sólo para imprimir/confirmar).

## Review Focus

1. **Dos despachos simultáneos del mismo cliente en estaciones distintas** deben recibir correlativos distintos y seguidos (el lock por cliente es lo único que lo garantiza; el de estación no los serializa). → prueba en Tarea 2.
2. **Un cliente que pide por `ids` vales de otro cliente** no debe obtenerlos ni saber que existen (se omiten; si no queda ninguno, 404 genérico). → prueba en Tarea 6.
3. **Un vale sin firma o con la firma perdida en R2** no debe tumbar el lote. → prueba en Tareas 5 y 6.
4. **Datos con HTML** (nombre de cliente, piloto u operario con `<`, `&`, comillas) deben salir escapados en el PDF. → prueba en Tarea 5.
5. **El total del listado del frontend y el conteo del backend** pueden diferir si llegan despachos entre una y otra petición: el aviso de >500 del botón es orientativo y el 400 del backend manda; su mensaje debe verse. → prueba en Tarea 10.

---

## Tarea 1 (backend): condiciones del listado en un solo lugar

**Files:**
- Create: `src/modules/despachos/despachos.condiciones.ts`
- Modify: `src/modules/despachos/despachos.service.ts` (`findAll`), `src/modules/despachos/despachos-excel.service.ts` (`fetchRows`)

**Interfaces:**
- Produces: `condicionesDespachos(filtros: Omit<DespachoFilters, "page" | "limit">, usuario: UsuarioSesion): SQL[] | null` — `null` significa "fail-closed, sin resultados" (supervisor sin gasolinera, cliente sin empresa). Incluye alcance por rol, los 7 filtros y el `EXISTS` sobre renglones para `tipo_combustible`.

- [ ] Mover la construcción de condiciones, idéntica hoy en `findAll` y `fetchRows`, a la función nueva; ambos la llaman y, si es `null`, devuelven su vacío actual (`{ data: [], total: 0, page, limit }` / `[]`).
- [ ] Puerta: sin cambio de comportamiento → `pnpm test`, `pnpm test:e2e` (273 verdes), `tsc`, `lint:check`.
- [ ] Commit `refactor(despachos): las condiciones del listado en un solo lugar`.

## Tarea 2 (backend): correlativo por cliente

**Files:**
- Modify: `src/db/schema/despachos.schema.ts`; Create: `drizzle/0009_*.sql` (+ snapshot y journal de `pnpm db:generate`)
- Modify: `src/modules/despachos/despachos.service.ts` (`create`)
- Test: `test/gasfuel.e2e-spec.ts`

**Interfaces:**
- Produces: columna `correlativo_cliente: integer NOT NULL`, índice único `despachos_cliente_correlativo_idx (cliente_id, correlativo_cliente)`. `GET /despachos`, `GET /despachos/:id` y `POST /despachos` la devuelven (sale sola del `select` de la tabla; verificar).

- [ ] E2E primero (bloque nuevo al final de `17. Despacho multi-renglón`, para no mover conteos):
  - cliente nuevo despacha 3 vales (2 en la estación A, 1 en la B; si el e2e sólo tiene una estación con supervisor, crear la segunda con su supervisor como hace `fase6`) → correlativos `1, 2, 3` en orden de creación.
  - otro cliente nuevo despacha 1 → `1`.
  - `GET /despachos/:id` y el item de `GET /despachos` traen `correlativo_cliente`.
  - **Review Focus 1:** dos `POST /despachos` del mismo cliente lanzados con `Promise.all` desde supervisores de estaciones distintas → `{x, x+1}` sin repetir.
- [ ] Ver fallar.
- [ ] Esquema + `pnpm db:generate`; **editar** la migración generada para: agregar la columna nullable → `UPDATE … FROM (ROW_NUMBER() OVER (PARTITION BY cliente_id ORDER BY despachado_at, id))` → `SET NOT NULL` → crear el índice único.
- [ ] En `create`, dentro de la transacción y **después** del lock de gasolinera+serie: `pg_advisory_xact_lock(hashtext('CLIENTE:' || cliente_id))`, luego `COALESCE(MAX(correlativo_cliente), 0) + 1` del cliente, y guardarlo. Un 23505 de cualquier índice único ya sale como 409 vía `esViolacionUnica`; ajustar el mensaje si el índice es el del correlativo (`"El correlativo del cliente ya existe; intenta de nuevo"`).
- [ ] Migración contra una base temporal `gasfuel_tmp_demo` sembrada con `pnpm seed:demo`: por cliente, `MIN = 1`, `MAX = COUNT`, sin repetidos, y el orden coincide con `despachado_at`. Borrar la base temporal.
- [ ] Puerta completa (unit, e2e, tsc, lint:check). Commit `feat(despachos): correlativo propio por cliente`.

## Tarea 3 (backend): el correlativo en el Excel y el estado de cuenta

**Files:**
- Modify: `src/modules/despachos/despachos-excel.service.ts` (columna `{ header: "N° Cliente", key: "correlativo_cliente" }` junto a "N° Vale"; fila de totales vacía en esa columna)
- Modify: `src/modules/saldos/saldos.service.ts` (`getEstadoCuenta`: `leftJoin(despachos, eq(movimientosSaldo.despacho_id, despachos.id))`, cada movimiento suma `correlativo_cliente: number | null`)
- Modify: `src/modules/saldos/pdf/estado-cuenta-template.ts` (`MovimientoEstadoCuenta.correlativo_cliente: number | null`; columna "N° cliente", "—" si es null)
- Test: `despachos-excel.service.spec.ts`, `estado-cuenta-template.spec.ts`, `test/gasfuel.e2e-spec.ts`

- [ ] Pruebas primero:
  - Excel: el encabezado incluye "N° Cliente" justo después de "N° Vale"; una fila con `correlativo_cliente: 7` lo muestra.
  - Plantilla: movimiento con `correlativo_cliente: 45` → el HTML contiene `45` en su fila; con `null` (abono) → "—".
  - E2E: el estado de cuenta del cliente de la Tarea 2 trae en cada débito el correlativo de su despacho; el abono inicial trae `null`.
- [ ] Implementar. Puerta completa. Contrato (`docs/contrato-frontend.md` §1c y §1d): `correlativo_cliente` en despachos y en movimientos del estado de cuenta. Commit `feat(saldos): el estado de cuenta y el Excel traen el N° cliente`.

## Tarea 4 (backend): reglas puras del PDF de vales

**Files:**
- Create: `src/modules/despachos/vales-pdf.reglas.ts`, `vales-pdf.reglas.spec.ts`

**Interfaces:**
- Produces:
  - `MAX_VALES_POR_PDF = 500`
  - `exigirTopeVales(total: number): void` — 0 → `NotFoundException("No hay vales con esos filtros")`; > 500 → `BadRequestException("Son N vales; acota el período o los filtros (máximo 500 por PDF).")`.
  - `nombreArchivoVales(p: { cliente: string | null; desde?: string; hasta?: string; unVale?: { serie: string; numero: string } }): string` — `unVale` → `vale-A-000123.pdf`; si no, `vales-<cliente-slug|todos>-<desde|inicio>-a-<hasta|hoy>.pdf` (slug: minúsculas, sin tildes, no alfanumérico → `-`).
  - `deACuatro<T>(items: T[]): T[][]`.
  - `parsearIds(ids: string | undefined): string[] | undefined` — separa por comas, recorta, descarta vacíos, valida UUID; uno inválido → `BadRequestException("ids debe ser una lista de UUID separados por comas")`.
- [ ] Casos (con `esperarError`): tope 0 → 404; 1, 499, 500 → pasa; 501 → 400 con "Son 501 vales…"; nombre con `unVale` → `vale-A-000123.pdf`; cliente "Coca-Cola Ñandú, S.A." + rango → `vales-coca-cola-nandu-s-a-2026-10-01-a-2026-10-12.pdf`; sin cliente ni rango → `vales-todos-inicio-a-hoy.pdf`; `deACuatro` con 0, 4, 5 y 9 elementos → `[]`, `[[4]]`, `[[4],[1]]`, `[[4],[4],[1]]`; `parsearIds` con `undefined`, `""`, `" a , b "` (UUIDs válidos), y uno inválido.
- [ ] Ver fallar, implementar, `pnpm test:cov` (100% en el archivo). Commit `feat(despachos): reglas del PDF de vales`.

## Tarea 5 (backend): plantilla del vale en carta

**Files:**
- Create: `src/modules/despachos/vales-pdf.template.ts`, `vales-pdf.template.spec.ts`

**Interfaces:**
- Consumes: `deACuatro` (Tarea 4), `escaparHtml` (`src/common/escapar-html.ts`).
- Produces: `interface ValePdf { serie_vale; numero_vale; correlativo_cliente: number; despachado_at: Date | string; turno; bomba_numero; gasolinera: { nombre; ciudad | null }; cliente: { nombre; nit | null }; vehiculo: { placa; marca | null; modelo | null } | null; piloto: { nombre_completo } | null; kilometraje: string | null; renglones: { renglon; tipo_combustible; galones: string; precio_galon: string | null; monto: string }[]; monto_total: string; galones: string; operario: string | null; despachador: string | null; firma: string | null /* data-URL PNG */ }` y `buildValesHtml(d: { vales: ValePdf[]; generadoEn: string }): string`.
- [ ] Casos: 5 vales → 2 `.hoja` con 4 y 1 `.vale`; cada vale muestra `A-000123` y "N° cliente 45"; hora en Guatemala; renglón de caneca con su etiqueta; `firma: null` → "Firma no disponible"; **Review Focus 4:** cliente `<b>Ñ&"x"</b>` sale escapado (no aparece `<b>` crudo); una `firma` que no empieza con `data:image/png;base64,` se trata como ausente; el pie dice "Copia digital — generada el …" y **nunca** "ORIGINAL"; CSS `@page { size: letter }` y `break-inside: avoid` en `.vale`.
- [ ] Ver fallar, implementar (HTML+CSS autocontenido, DM Sans/JetBrains Mono con fallback del sistema: Chrome no baja fuentes). Commit `feat(despachos): plantilla carta de vales, 4 por hoja`.

## Tarea 6 (backend): servicio y endpoint del PDF

**Files:**
- Create: `src/common/render-pdf.ts` (extraer el `renderPdf` que hoy repiten `saldos-pdf.service.ts` y `reportes-pdf.service.ts`, con sus mismas protecciones: JS apagado, red bloqueada salvo `data:`/`about:`, `opcionesChrome()`); los dos servicios pasan a usarlo.
- Create: `src/modules/despachos/vales-pdf.service.ts`; Modify: `despachos.module.ts`, `despachos.controller.ts`
- Test: `vales-pdf.service.spec.ts`, `test/gasfuel.e2e-spec.ts`

**Interfaces:**
- Consumes: `condicionesDespachos` (T1), reglas (T4), `buildValesHtml` (T5), `StorageService.get`.
- Produces: `renderizarPdf(html: string, formato: "A4" | "Letter"): Promise<Buffer>`; `ValesPdfService.generar(filtros: Omit<DespachoFilters, "page"|"limit">, ids: string[] | undefined, usuario: UsuarioSesion): Promise<{ pdf: Buffer; nombre: string }>`; ruta `GET /despachos/vales/pdf` (`@Auth("admin","supervisor","cliente")`), **declarada antes de `@Get(":id")`**, mismos `@Query` que `export/xlsx` + `ids`.
- [ ] Pruebas primero:
  - unit (servicio con `vacio()`/`espiarPrivado`): firma que falla en `storage.get` → ese vale con `firma: null` y el resto sigue (**Review Focus 3**); no más de 10 lecturas de firma en vuelo a la vez.
  - e2e (puppeteer mockeado): cliente pide sus vales → 200, `Content-Type: application/pdf`, `Content-Disposition` con el nombre de la Tarea 4; cliente con `cliente_id` ajeno en el query → 404; **Review Focus 2:** cliente con `ids` de otro cliente → 404, y con una mezcla de propios y ajenos → 200 (el HTML pasado a puppeteer sólo contiene los propios: espiar el mock); filtro sin resultados → 404 con el mensaje; `ids` inválido → 400; supervisor de otra estación no ve vales ajenos; usuario cliente sin empresa (sembrado por BD como en el bloque 10) → 403 `"Cliente sin empresa asignada"`, igual que reportes.
- [ ] Implementar: si `condicionesDespachos` devuelve `null`, cliente sin empresa → 403 `"Cliente sin empresa asignada"`; supervisor sin estación → 404 `"No hay vales con esos filtros"`. Luego contar con `condicionesDespachos` (+ `inArray(despachos.id, ids)` si vienen) y aplicar `exigirTopeVales` **antes** de leer filas y firmas; leer despachos con `leftJoin` a gasolineras, clientes, vehículos, pilotos, operarios y usuarios (despachador), ordenados por `cliente_id, correlativo_cliente`; renglones con un solo `inArray(despacho_detalles.despacho_id, …)` (precio por renglón desde `precios_combustible`); firmas con concurrencia 10.
- [ ] Verificación real: backend contra `gasfuel_demo` (tras migrar 0009), `curl` del PDF de un cliente con filtro de un mes; abrir el archivo y revisar a ojo 2–3 hojas (4 vales por hoja, firmas, N° cliente, pie). Contar páginas = `ceil(N/4)`.
- [ ] Puerta completa. Contrato §1d: el endpoint, filtros, alcance, tope, 404 y nombre de archivo. Commit `feat(despachos): descarga de vales en PDF`.

## Tarea 7 (frontend): el N° cliente en tabla, Excel y estado de cuenta

**Files:**
- Modify: `src/types/index.ts` (`Despacho.correlativo_cliente: number`; `MovimientoSaldo.correlativo_cliente: number | null`), `src/lib/api/mappers.ts` (`mapDespacho`, `mapMovimientoSaldo` con `toNum`/`toNumOrNull`)
- Modify: `src/components/despachos/DespachoTable.tsx` (columna "N° cliente" tras "Vale", `tabular-nums`), `src/components/cliente-portal/DespachosContent.tsx` (columna en el Excel), `src/components/cliente-portal/CuentaContent.tsx` (columna en la tabla de movimientos, "—" si null)
- Modify: `src/lib/mock-data.ts` / `src/mocks/db.ts` (correlativo por cliente en la semilla, por fecha), `src/mocks/handlers.ts` (`POST /despachos` asigna `max+1` del cliente; el estado de cuenta del demo lo trae por `despacho_id`)

- [ ] Implementar; `type-check`, `lint`, `build`.
- [ ] Verificar en el navegador (backend real con `gasfuel_demo`): la columna en Despachos del portal y del admin, en el Excel descargado (abrirlo) y en "Mi cuenta". Verificar el modo demo (MSW): un despacho nuevo toma el siguiente N° del cliente.
- [ ] Commit `feat(despachos): el N° cliente en tabla, Excel y estado de cuenta`.

## Tarea 8 (frontend): el N° cliente en el vale de la bomba

**Files:**
- Modify: `src/lib/impresion-termica.ts` (`valeEnXml`: renglón `N° cliente: 45` después del número, en original y copia), `src/components/operario/ValeImpresion.tsx` (lo mismo en el HTML, original y copia; `esc()` sobre el valor)

- [ ] Los dos formatos a la vez (regla del CLAUDE.md del frontend). Verificar el XML generado para un despacho de prueba (contiene la línea dos veces) y el HTML (`#vale-print-source` la tiene en original y copia).
- [ ] Commit `feat(vales): el vale de la bomba imprime el N° cliente`. Pendiente para Milton: probar una impresión real en la tablet.

## Tarea 9 (frontend): API de vales en PDF y helper de descarga

**Files:**
- Create: `src/lib/descargar-archivo.ts`; Modify: `src/lib/api/despachos.ts`, `src/components/cliente-portal/CuentaContent.tsx` (usar el helper), `src/mocks/handlers.ts`

**Interfaces:**
- Produces: `descargarArchivo(blob: Blob, nombre: string): void`; `descargarValesPdf(p: { filtros?: DespachoFilters; ids?: string[] }): Promise<{ blob: Blob; nombre: string }>` — por `http.blob` (refresh incluido); el nombre sale de `Content-Disposition` (si `http.blob` no expone headers, agregar a `http.ts` una variante `blobConNombre(path): Promise<{ blob; nombre: string | null }>` y nombre de respaldo `vales.pdf`).
- [ ] MSW: `GET */despachos/vales/pdf` → 400 con el mensaje del modo demo.
- [ ] `type-check`/`lint`. Commit `feat(vales): API de descarga de vales en PDF`.

## Tarea 10 (frontend): botón de descarga por lote

**Files:**
- Modify: `src/components/despachos/DespachoTable.tsx` (props `onDescargarVales?: () => void`, `descargandoVales?: boolean`; botón "Descargar vales (PDF)" junto a "Exportar Excel", ícono Tabler outline, sin amarillo)
- Modify: `src/components/cliente-portal/DespachosContent.tsx` y `src/app/admin/despachos/page.tsx` (pasan los filtros activos; si `total > 500`, avisan sin pedir; muestran el error del backend)

- [ ] Verificar en el navegador contra `gasfuel_demo`: un mes de un cliente descarga un PDF válido (`%PDF`, páginas = `ceil(N/4)`); un filtro de más de 500 muestra el aviso sin pedir; **Review Focus 5:** forzar el 400 del backend (filtro de 501+ con el aviso del frontend desactivado temporalmente o vía `curl`) y comprobar que el mensaje se muestra; en modo demo aparece el mensaje del demo.
- [ ] Commit `feat(vales): descarga de vales por lote en PDF`.

## Tarea 11 (frontend): reimpresión en PC como PDF

**Files:**
- Modify: `src/hooks/useReimpresionVale.tsx`

- [ ] Fuera de Android: `reimprimir(d)` descarga `descargarValesPdf({ ids: [d.id] })` con `descargarArchivo` en lugar de montar `ValeImpresion` y llamar a `imprimirVale()`; mantiene `reimprimiendoId` y `error`. En Android no cambia (TM Print Assistant). Actualizar el comentario de cabecera del hook.
- [ ] Verificar: en PC (admin y portal) "Reimprimir" baja `vale-A-xxxxxx.pdf` con un solo vale y su firma; el historial del supervisor en Android sigue por la térmica (revisión de código: la rama Android no cambió).
- [ ] Commit `feat(vales): en PC la reimpresión baja el vale en PDF carta`.

## Tarea 12: documentación, revisión final y entrega

- [ ] `CLAUDE.md` del backend (correlativo, endpoint, `render-pdf`), del frontend (N° cliente, botón, reimpresión en PC, MSW) y raíz (sección de impresión de vales); conteos de pruebas.
- [ ] Revisión de toda la rama en los dos repos; puertas completas otra vez.
- [ ] Merge a `main` en los dos repos y **pedir permiso a Milton** para subir (backend primero; frontend cuando Railway termine bien; la migración 0009 corre en el pre-deploy).
- [ ] Nota de memoria `donde-quedo-el-desarrollo` actualizada.
