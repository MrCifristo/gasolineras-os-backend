# Reimpresión de vales por el cliente y kilometraje visible — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el cliente reimprima los vales de sus despachos desde su portal y vea el kilometraje de cada despacho en su tabla y en su Excel.

**Architecture:** el backend solo agrega `despachador: { id, nombre } | null` al sobre de `GET /despachos/:id` (el alcance por rol ya existe). En el frontend, la reimpresión que hoy está duplicada en admin y supervisor se extrae a un hook compartido; `DespachoTable` gana una columna de kilometraje y un botón de reimpresión opcionales, y el portal del cliente los activa.

**Tech Stack:** NestJS 11 + Drizzle (backend, Jest 30 e2e contra Postgres); Next.js 15 + React 19 + TypeScript + Tailwind v4 (frontend, sin test runner: `type-check`, `lint` y `build` son las compuertas), MSW para el modo demo.

**Spec:** `gasolineras-os-backend/docs/superpowers/specs/2026-10-07-km-anormal-y-reimpresion-cliente-design.md`, **secciones 1 y 2**. La sección 3 (kilometraje anormal) está en pausa y **no** entra en este plan.

**Formato de este plan:** por preferencia de Milton, las tareas llevan firmas, archivos y casos de prueba, no el código literal; el código se escribe una sola vez, al implementar.

## Global Constraints

- Ramas: backend `km-anormal` (ya existe, desde `main`, con la spec); frontend `km-anormal` nueva desde `mock-data-branch`.
- Commits: Conventional Commits, asunto y cuerpo **en español**, autor solo Milton Beltrán. **Nunca** `Co-Authored-By` ni mención de Claude o de herramientas.
- Idioma de dominio en español: identificadores, mensajes de error y textos de UI.
- Toda respuesta del backend pasa por `src/lib/api/mappers.ts`; los numéricos llegan como string.
- Design System (`gasolineras-os-frontend/Design System.md`): amarillo (`variant="yellow"`) solo para acciones físicas, como reimprimir el vale; bordes de `0.5px`; números de tabla con `tabular-nums`; colores siempre por variable CSS, nunca hex en componentes; íconos Tabler outline.
- Vale impreso: no tocar el mecanismo de `ValeImpresion.tsx` ni su comentario de cabecera. `ValeImpresion` se monta fuera de cualquier modal y `imprimirVale()` corre en un `useEffect`, después de que React montó la fuente.
- Si la firma de un despacho que tiene `firma_key` no carga, no se imprime: se avisa (decisión del 30-sep).
- Contrato: `gasolineras-os-backend/docs/contrato-frontend.md` es vinculante y se actualiza en la misma tarea que cambia la API.
- E2E en la Mac: Postgres en el puerto que indica el CLAUDE.md del workspace (5432 ocupado por loyaltyqr; usar override temporal y `DATABASE_URL` en la línea de comandos).

## Review Focus

1. **Despacho sin vehículo (solo canecas o toneles), `kilometraje` nulo**: la tabla, el Excel, la vista previa y el vale impreso muestran "—" o vacío; nunca "0 km" ni un crash por `.toLocaleString()` sobre `null`. → Tarea 2 (el compilador obliga a cubrir cada uso) y Tarea 5 (verificación con un vale de solo contenedores).
2. **Dos reimpresiones seguidas** (doble clic, o clic en dos filas): solo corre una a la vez; los botones quedan deshabilitados mientras `reimprimiendoId` no sea nulo, porque dos fuentes `#vale-print-source` se pisarían. → Tarea 3 (contrato del hook) y Tarea 4 (botón deshabilitado).
3. **Despacho con `firma_key` cuya firma falla al bajar**: aviso con el número de vale, no se imprime sin firma. Despacho viejo sin `firma_key`: se imprime sin firma, como hoy. → Tarea 3.
4. **Despachador ausente** (vale viejo o `despachador` nulo en el sobre): la línea "Despachado por" queda vacía o usa el respaldo; no imprime "undefined". → Tareas 1 y 3.
5. **Vale reimpreso confundido con el original**: toda reimpresión (admin, supervisor o cliente) dice REIMPRESIÓN y su fecha y hora; el vale de la bomba sigue diciendo ORIGINAL. → Tarea 3 (Step 0 y Step 5).
6. **Clic en el botón dentro de una fila clicable**: el botón no dispara `onRowClick` (en admin/despachos la fila abre un modal). → Tarea 4.

---

### Task 1: `despachador` en el detalle del despacho (backend)

**Files:**
- Modify: `gasolineras-os-backend/src/modules/despachos/despachos.service.ts` (`findOne`, ~líneas 165-222)
- Modify: `gasolineras-os-backend/test/gasfuel.e2e-spec.ts` (bloque "Scoping de findOne (IDOR)", ~1207-1250, y bloque de firma, ~1310-1350)
- Modify: `gasolineras-os-backend/docs/contrato-frontend.md` (§1f, junto a "`operario` en las respuestas", ~línea 296; y la tabla "Alcance del cliente", ~362)

**Interfaces:**
- Produces: `GET /api/v1/despachos/:id` responde, además de lo actual, `despachador: { id: string; nombre: string } | null` al nivel del sobre (junto a `operario`). El listado `GET /despachos` no cambia.

- [ ] **Step 1: Escribir las pruebas e2e que fallan.** En el bloque de scoping de `findOne`:
  - "el detalle trae al despachador → 200": con `adminToken`, `GET /despachos/${despacho1Id}` devuelve `despachador.nombre` igual al nombre del supervisor que creó `despacho1Id` (el usuario creado en la sección 3 con `tag("Operario López")`) y `despachador.id` igual a `despacho.despachador_id`.
  - "cliente de su empresa ve al despachador de su despacho → 200": con `tokenDeClienteLigado(cliente1Id, …)`, mismo chequeo de `despachador.nombre`.
  - En el bloque de firma: "cliente de su empresa baja la firma de su despacho → 200" (sobre `despachoFirmaId`, `content-type` PNG) y "cliente de otra empresa recibe 404 en /firma ajena" (misma técnica de empresa ajena que la prueba de la línea ~1221).
- [ ] **Step 2: Correrlas y ver que fallan las dos de `despachador`.** Run: `DATABASE_URL=… pnpm test:e2e:gasfuel -t "despachador"`. Expected: FAIL, `despachador` es `undefined`. Las dos de firma probablemente ya pasan; se quedan como regresión del alcance.
- [ ] **Step 3: Implementar.** En `findOne`, agregar al `select` la clave `despachador: { id: usuarios.id, nombre: usuarios.nombre }` y un `leftJoin(usuarios, eq(despachos.despachador_id, usuarios.id))` (left: no se debe perder un despacho por un usuario inexistente). `usuarios` ya está importado. No se toca el alcance por rol.
- [ ] **Step 4: Correr la suite completa.** Run: `DATABASE_URL=… pnpm test:e2e` y `pnpm test`. Expected: todo verde (262 e2e más las nuevas; 424 unit).
- [ ] **Step 5: Contrato.** En §1f, junto a la nota de `operario`, documentar `despachador: { id, nombre } | null` en `GET /despachos/:id` y que sirve para la línea "Despachado por" del vale reimpreso por cualquier rol. En la tabla "Alcance del cliente" nada cambia; agregar una línea si hace falta para dejar explícito que el cliente reimprime con `GET /despachos/:id` + `/firma`.
- [ ] **Step 6: Commit.** `feat(despachos): el detalle del despacho trae al despachador` — cuerpo: lo necesita el cliente para reimprimir el vale sin leer `/usuarios`, que es solo del admin.

### Task 2: kilometraje nulo y despachador en los tipos del frontend

**Files:**
- Modify: `gasolineras-os-frontend/src/types/index.ts` (`Despacho`, ~líneas 112-140)
- Modify: `gasolineras-os-frontend/src/lib/api/mappers.ts` (`mapDespacho`, ~190-222)
- Modify: `gasolineras-os-frontend/src/lib/api/despachos.ts` (`getDespacho`, ~163-184)
- Modify: los usos que deje en rojo el compilador; hoy son `src/app/admin/despachos/page.tsx:427`, `src/components/despachos/ValePreview.tsx:69`, `src/components/operario/ValeImpresion.tsx:227` y `:274`
- Modify: `gasolineras-os-frontend/src/mocks/db.ts:185` (`rawDespacho`) y `src/mocks/handlers.ts` (`GET /despachos/:id`, ~261-280)

**Interfaces:**
- Consumes: `despachador` del sobre de `GET /despachos/:id` (Task 1).
- Produces:
  - `Despacho.kilometraje: number | null`.
  - `Despacho.despachador?: { id: string; nombre: string } | null` (mismo tipo que `operario`; reusar `mapOperarioRef` o su tipo).
  - `getDespacho(id)` llena `despachador` desde el sobre.
  - Helper de formato `formatKm(km: number | null): string` en `src/lib/utils.ts`: `"187,420 km"` con `toLocaleString("es-GT")` o `"—"` si es nulo. Lo usan la Tarea 4 y los usos de esta tarea.

- [ ] **Step 1: Cambiar el tipo y el mapper.** `kilometraje: number | null` y `toNumOrNull(r.kilometraje)`. Agregar `despachador` al tipo y al mapper, y pasarlo desde el sobre en `getDespacho`, igual que hoy se pasa `operario`.
- [ ] **Step 2: Correr el compilador y ver los errores.** Run: `pnpm type-check`. Expected: FAIL en cada `.toLocaleString()` sobre `kilometraje`. Esa lista es el inventario de usos a corregir.
- [ ] **Step 3: Corregir cada uso con `formatKm`.** En `ValeImpresion.tsx` el km va dentro de HTML escapado con `esc(...)`: conservar `esc` y pasarle el resultado de `formatKm` (o "—"). En el vale, la fila "Kilometraje" se sigue mostrando con "—". No tocar nada más del vale.
- [ ] **Step 4: MSW.** En `rawDespacho`, un km nulo viaja como `null`, no como `"null"`. En el handler de `GET /despachos/:id`, agregar `despachador` con el nombre del usuario demo que despachó (o `null` si no se encuentra), con la misma forma que el backend.
- [ ] **Step 5: Compuertas.** Run: `pnpm type-check && pnpm lint`. Expected: PASS sin errores nuevos.
- [ ] **Step 6: Commit.** `fix(despachos): el kilometraje puede ser nulo y el detalle trae al despachador` — cuerpo: los vales solo de contenedores no tienen km y el mapper los convertía en 0.

### Task 3: hook compartido de reimpresión y marca de REIMPRESIÓN

**Files:**
- Create: `gasolineras-os-frontend/src/hooks/useReimpresionVale.tsx`
- Modify: `gasolineras-os-frontend/src/components/operario/ValeImpresion.tsx` (prop nueva; títulos en ~214 y ~260-266; línea de fecha en ~216 y ~268). **No** tocar `imprimirVale()` ni el comentario de cabecera.
- Modify: `gasolineras-os-frontend/src/app/admin/despachos/page.tsx` (quitar `handleReimprimir`, `valeReimpresion`, el effect de `imprimirVale`, el bloque de `ValeImpresion` del final, y `listUsuarios`/`usuarios`, que solo se usaban para el despachador)
- Modify: `gasolineras-os-frontend/src/app/operario/historial/page.tsx` (quitar `handleReimprimir`, `reprintData`, `reprinting`, `errorReimpresion`, su effect y su bloque de `ValeImpresion`)

**Interfaces:**
- Consumes: `getDespacho`, `firmaDataUrl` (`src/lib/api/despachos.ts`); `ValeImpresion`, `imprimirVale` (`src/components/operario/ValeImpresion.tsx`); `Despacho.despachador` (Task 2).
- Produces: `useReimpresionVale(opciones?: { despachadorRespaldo?: string })`, que devuelve:
  - `reimprimir(d: Despacho): Promise<void>`: no hace nada si ya hay una en curso.
  - `reimprimiendoId: string | null`: id del despacho en curso; nulo cuando termina, falla o `imprimirVale` llama a su `onDone`.
  - `error: string | null` y `limpiarError(): void`.
  - `fuenteVale: ReactNode`: el `<div style={{display:"none"}}>` con `ValeImpresion`, o `null`. La página lo renderiza **fuera** de cualquier modal.

Comportamiento que el hook preserva de los dos flujos actuales (es una mudanza, no un rediseño):
1. Pide `getDespacho(d.id)` y, si `d.firma_key`, `firmaDataUrl(d.id)` en paralelo.
2. Si `d.firma_key` y no hay firma → error "No se pudo cargar la firma del vale {serie}-{numero}; intenta de nuevo." y no imprime.
3. Si el detalle no trae `cliente` o `gasolinera` → error "No se pudo reimprimir el vale {serie}-{numero}: el despacho no trae los datos del cliente o de la gasolinera." y no imprime.
4. Excepción → su mensaje, o "No se pudo preparar el vale {serie}-{numero}".
5. Éxito → monta la fuente y, en un `useEffect` sobre ese estado, llama a `imprimirVale(onDone)`; `onDone` limpia la fuente y `reimprimiendoId`.
6. `despachadorNombre = completo.despachador?.nombre ?? opciones.despachadorRespaldo ?? ""`; `operarioNombre = completo.operario?.nombre ?? null`; `precio = null`.
7. **Siempre** pasa `reimpresoEn = new Date()`, tomado al momento de pedir la reimpresión. Toda reimpresión sale marcada, la pida el admin, el supervisor o el cliente.

Cambio en `ValeImpresion`: prop opcional `reimpresoEn?: Date`. Si viene:
- el título del original es "Vale de Combustible — REIMPRESIÓN";
- la etiqueta de la copia es "COPIA — PILOTO · REIMPRESIÓN";
- ambas páginas agregan, bajo la línea de fecha, "Reimpreso: <formatDate(reimpresoEn.toISOString())>", que es la misma función con que el vale ya formatea `despachado_at`.

Sin la prop, el HTML queda idéntico al actual: el vale de la bomba en `DespachoForm` no la pasa y sigue saliendo ORIGINAL.

- [ ] **Step 0: Marca de reimpresión en `ValeImpresion`** con la prop de arriba. Run: `pnpm type-check`. Expected: PASS; ningún uso existente cambia.
- [ ] **Step 1: Crear el hook** con la firma y el comportamiento de arriba.
- [ ] **Step 2: Migrar admin/despachos.** El botón del modal llama a `reimprimir(selectedDespacho)`; `loading` = `reimprimiendoId === selectedDespacho.id`; el error del hook ocupa el lugar de `errorVale`; `{fuenteVale}` va donde estaba el bloque oculto. Se borran `listUsuarios`, `usuarios` y `Usuario` de los imports si quedan sin uso.
- [ ] **Step 3: Migrar operario/historial.** `useReimpresionVale({ despachadorRespaldo: user?.nombre })`; el botón de cada fila queda deshabilitado mientras `reimprimiendoId !== null`; el error se muestra donde estaba `errorReimpresion`.
- [ ] **Step 4: Compuertas.** Run: `pnpm type-check && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Verificación manual en modo demo** (`NEXT_PUBLIC_USE_MOCK=true pnpm dev -p 3001`): como admin, reimprimir desde el modal abre el diálogo de impresión con el vale; las dos páginas dicen REIMPRESIÓN, traen la línea "Reimpreso:" y "Despachado por" lleva nombre. Un despacho nuevo desde la tablet sigue imprimiendo "ORIGINAL", sin la línea. como supervisor, igual desde el historial. Cancelar el diálogo deja los botones habilitados otra vez.
- [ ] **Step 6: Commit.** `feat(vales): toda reimpresión sale marcada y vive en un hook compartido` — cuerpo:
  - una reimpresión ya no se puede confundir con el vale original, porque el cliente podrá reimprimir en su oficina;
  - admin y supervisor tenían el mismo flujo copiado, y el portal del cliente será el tercer uso;
  - el nombre del despachador sale del detalle.

### Task 4: kilometraje y reimpresión en la tabla y el portal del cliente

**Files:**
- Modify: `gasolineras-os-frontend/src/components/despachos/DespachoTable.tsx`
- Modify: `gasolineras-os-frontend/src/components/cliente-portal/DespachosContent.tsx`
- Modify: `gasolineras-os-frontend/src/app/admin/despachos/page.tsx` (solo activar `showKilometraje`)

**Interfaces:**
- Consumes: `useReimpresionVale` (Task 3), `formatKm` (Task 2).
- Produces: props nuevas y opcionales de `DespachoTable`, sin efecto si no se pasan:
  - `showKilometraje?: boolean` (default `false`): columna "Km" después de "Piloto", alineada a la derecha, `tabular` (la clase que ya usa la tabla), con `formatKm(d.kilometraje)`.
  - `onReimprimir?: (d: Despacho) => void` y `reimprimiendoId?: string | null`: si `onReimprimir` existe, última columna con un `Button` `variant="yellow"` pequeño, "Reimprimir" (ícono Tabler outline de impresora si el resto de botones lleva ícono). El botón llama a `stopPropagation()` antes de `onReimprimir(d)`, queda deshabilitado si `reimprimiendoId` no es nulo y muestra `loading` en su propia fila.
  - El `colSpan` de "Sin registros" se calcula sumando las columnas visibles (base 7 + cliente + gasolinera + km + acciones), no a mano.

- [ ] **Step 1: `DespachoTable`.** Agregar las tres props, la columna de km, la de acción y el `colSpan` calculado.
- [ ] **Step 2: Portal del cliente.** En `DespachosContent`, usar `useReimpresionVale()`; pasar `showKilometraje`, `onReimprimir={reimprimir}` y `reimprimiendoId`; mostrar `error` en un `Alert variant="err"` (como el error de exportación) y renderizar `{fuenteVale}` al final del contenedor. El espejo del admin (`admin/clientes/[id]/portal/despachos`) lo hereda solo, porque usa el mismo componente.
- [ ] **Step 3: Excel del portal.** En `handleExportExcel`, agregar la columna "Kilometraje" después de "Piloto": el número tal cual (celda numérica) o cadena vacía si es nulo.
- [ ] **Step 4: Admin.** En `admin/despachos/page.tsx`, pasar `showKilometraje` a su `DespachoTable` (sin `onReimprimir`: el admin sigue reimprimiendo desde el modal).
- [ ] **Step 5: Compuertas.** Run: `pnpm type-check && pnpm lint && pnpm build`. Expected: PASS.
- [ ] **Step 6: Commit.** `feat(cliente): reimpresión de vales y kilometraje en sus despachos` — cuerpo: el cliente reimprime el vale de cualquiera de sus despachos con el mismo mecanismo que el admin, y ve el km en la tabla y en el Excel.

### Task 5: verificación en vivo, MSW y documentación

**Files:**
- Modify (si hace falta): `gasolineras-os-frontend/src/mocks/handlers.ts`
- Modify: `estacionflow/CLAUDE.md` (workspace; sección "Voucher printing", última línea sobre la reimpresión del admin)

- [ ] **Step 1: Modo demo (MSW).** Con `NEXT_PUBLIC_USE_MOCK=true`, entrar como cliente: la columna Km aparece, un vale de solo contenedores muestra "—", "Reimprimir" abre el diálogo con el vale y el Excel trae la columna "Kilometraje".
- [ ] **Step 2: En vivo contra `gasfuel_demo`** (backend con `RECORDATORIOS_ACTIVOS=false`, frontend `NEXT_PUBLIC_USE_MOCK=false` en el 3001), como `flota@transatlantico.demo`:
  - reimprimir un vale con firma: aparecen la firma y "Despachado por" con nombre;
  - reimprimir dos filas seguidas rápido: solo corre una;
  - en la pestaña de red, ningún 403 (en particular, ninguna llamada a `/usuarios`);
  - descargar el Excel y abrirlo: la columna "Kilometraje" es numérica.
  
  Repetir la reimpresión desde el espejo del admin (`/admin/clientes/:id/portal/despachos`) y desde el historial del supervisor.
- [ ] **Step 3: Documentación.** En el CLAUDE.md del workspace, la nota de reimpresión pasa a decir que admin, supervisor y cliente reimprimen con `useReimpresionVale`, y que el despachador sale del detalle. Commit en el repo workspace: `docs: la reimpresión de vales la comparten admin, supervisor y cliente`.
- [ ] **Step 4: Cierre de rama.** Usar superpowers:finishing-a-development-branch en ambos repos. El merge y el push se hacen solo con el visto bueno de Milton.
