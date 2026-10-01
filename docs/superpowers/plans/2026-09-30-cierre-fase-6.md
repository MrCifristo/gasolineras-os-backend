# Cierre de la Fase 6: decisiones de Milton y bugs previos — Plan de implementación

**Goal:** Aplicar las decisiones que Milton tomó el 2026-09-30 (H8, permisos del cliente, firma en la reimpresión del supervisor, logout que borra el push, Node 24) y cerrar los bugs previos a la Fase 6 que encontró la revisión final. Después se integran las ramas `fase-6` de los dos repos.

**Repos:** backend `gasolineras-os-backend` (rama `fase-6`, desde `main`) y frontend `gasolineras-os-frontend` (rama `fase-6`, desde `mock-data-branch`). Se trabaja **primero el backend** (Tareas 1–3), luego el frontend (4–8).

**Spec:** `docs/superpowers/specs/2026-09-25-fase-6-turnos-recordatorios-design.md` (Fase 6) y `../gasolineras-os-frontend/docs/auditoria-h8-pantallas-wip.md` (H8). Contrato: `docs/contrato-frontend.md`.

## Decisiones de Milton (vinculantes)

1. `DiagnosticChecklist` y `/admin/control`: **terminar**.
2. `VehiculoRestriccionesModal`: **terminar, y el cliente también edita las restricciones de SUS vehículos** (el admin también).
3. El **cliente puede leer gasolineras y precios** (catálogos) para que sus reportes recuperen el desglose por combustible y por estación.
4. La **reimpresión del supervisor lleva la firma**; si la firma no carga, avisa en vez de imprimir sin ella.
5. **Cerrar sesión borra la suscripción push** del navegador.
6. **Node 24 LTS** como mínimo y **pnpm** como gestor declarado, en los dos repos.

Decisión del controlador (registrada): en el portal del cliente, los botones de **alta, edición y baja de vehículos** se ocultan para el rol `cliente` (el backend los rechaza con 403; Milton sólo autorizó editar restricciones). El admin los conserva.

## Global Constraints

- Dominio en español: identificadores, rutas, DTOs, mensajes de error y textos visibles.
- Backend: `ValidationPipe` con `whitelist` + `forbidNonWhitelisted` (todo campo de DTO con decorador); guards opt-in con `@Auth(...)`; alcance por rol **fail-closed** dentro del servicio (un cliente que pide un recurso ajeno recibe 404, nunca el recurso); excepciones built-in de Nest con mensajes en español. Todo e2e nuevo replica el bootstrap de `test/fase6.e2e-spec.ts`.
- Frontend: toda respuesta pasa por `src/lib/api/mappers.ts`; todo endpoint nuevo o cambiado tiene handler MSW con la misma forma y las mismas reglas de permiso que el backend; Design System (`Design System.md`): sólo variables CSS, bordes 0.5px, Tabler outline `stroke={1.5}` ≤24px, DM Sans, `font-id` sólo para identificadores y precios unitarios, `tabular-nums` en números, amarillo sólo para imprimir/confirmar despacho; textos legibles en tablet (nada menor a 12px en pantallas de la bomba). `ValeImpresion`: el comentario de cabecera de `imprimirVale()` se conserva y **todo** campo interpolado pasa por `esc()`.
- Fecha y hora de Guatemala: UTC−6 fijo. Backend `src/common/hora-guatemala.ts`; frontend `src/lib/fecha.ts`.
- Commits: Conventional Commits, asunto y cuerpo en español, **sin trailers de coautoría ni menciones a herramientas**. Sin push (lo hace el controlador al final).
- Gates: backend `pnpm build`, `pnpm test`, `pnpm test:e2e` (con `DATABASE_URL` al 5433; el `.env` ya apunta ahí); frontend `pnpm type-check`, `pnpm lint` (línea base 0 errores, 1 warning previo), `pnpm build` al final.

---

### Task 1: Node 24 LTS y pnpm declarados en los dos repos

**Files:** `package.json`, `.nvmrc` (nuevo) en ambos repos; `CLAUDE.md` y `README.md` del backend donde mencionen la versión de Node; `CLAUDE.md` del frontend si la menciona.

- En ambos `package.json`: `"engines": { "node": ">=24" }` y `"packageManager": "pnpm@11.11.0"` (la versión instalada; verifícala con `pnpm -v`). Si `pnpm install` con el campo nuevo cambia el lockfile, revisa que el cambio sea sólo de metadatos y repórtalo.
- `.nvmrc` con `24` en ambos repos.
- `@types/node`: si la versión fijada es de una mayor < 24, súbela a la última 24.x **exacta** (sin `^`) y corre los gates; si rompe tipos, déjala y repórtalo.
- Documentación: el backend dice "Node ≥ 22.12" en `CLAUDE.md`/`README.md`; cámbialo a "Node 24 LTS (mínimo 24; `.nvmrc`)".
- Verificación: los gates completos de los dos repos con Node 24.21.0 (`node -v`).
- Un commit por repo, p. ej. `chore: fija Node 24 LTS y pnpm como gestor del proyecto`.

### Task 2: El cliente puede leer gasolineras y precios (backend)

**Files:** `src/modules/gasolineras/gasolineras.controller.ts` (y service si hace falta), `src/modules/precios-combustible/precios-combustible.controller.ts`, `test/fase6.e2e-spec.ts` (o un e2e nuevo), `docs/contrato-frontend.md`.

- Agregar `cliente` a `GET /gasolineras`, `GET /gasolineras/:id`, `GET /precios-combustible` y `GET /precios-combustible/hoy`. Para el cliente, `GET /gasolineras` devuelve **la lista** (igual que admin/jefe), sólo gasolineras activas si el servicio ya distingue; `/hoy` le exige `gasolinera_id` igual que al admin.
- Revisa que ninguna de esas respuestas exponga datos de otros clientes (son catálogos). Si el servicio de gasolineras devuelve algo sensible (p. ej. `serie_vale_actual` está bien; datos de usuarios no), dilo.
- Aprovecha para corregir los `summary` de Swagger que todavía dicen "operario" en esos controllers (ahora es "supervisor").
- e2e: cliente lee lista de gasolineras (200, arreglo), una por id (200), precios por gasolinera (200), `/hoy?gasolinera_id=` (200), y sigue sin poder crear/editar precios (403).
- Contrato §1f: actualizar la tabla de permisos.

### Task 3: Restricciones de vehículo editables por admin y por el cliente dueño (backend)

**Files:** `src/modules/vehiculos/vehiculos.controller.ts`, `vehiculos.service.ts`, `dto/` (DTO nuevo), e2e, `docs/contrato-frontend.md`.

- Nuevo `PATCH /vehiculos/:id/restricciones`, `@Auth("admin", "cliente")`. DTO `UpdateRestriccionesVehiculoDto` con **sólo** los campos de restricción: `bloqueado`, los 11 `limite_*`, `productos_permitidos`, `dias_permitidos`, `hora_inicio`, `hora_fin`, con exactamente las mismas validaciones que tienen en `UpdateVehiculoDto` (reutilízalas con `PickType` si encaja). Cualquier otro campo → 400 (`forbidNonWhitelisted`).
- Alcance fail-closed: si el usuario es `cliente` y el vehículo no es de su `cliente_id` (o no existe) → 404 `Vehículo no encontrado`. El admin edita cualquiera.
- `PATCH /vehiculos/:id` (edición general) sigue sólo admin.
- Confirma que `GET /vehiculos` y `GET /vehiculos/:id` ya devuelven todos los campos de restricción al cliente (para que el frontend pueda mostrarlos); si no, agrégalos.
- e2e: admin edita restricciones de cualquier vehículo; cliente edita las de uno suyo (200 y persisten); cliente intenta uno ajeno → 404; supervisor → 403; body con `placa` → 400; `hora_inicio` mal formada → 400; valores `null` limpian un límite.
- Contrato: documentar el endpoint con request/response.

### Task 4: DiagnosticChecklist terminado (frontend)

**Files:** `src/components/operario/DiagnosticChecklist.tsx` (y `DespachoForm.tsx` sólo si hace falta para el aviso de error).

- Emojis → íconos Tabler outline (`stroke={1.5}`, ≤24px). Bordes 0.5px (separadores y spinner). Textos ≥12px (lectura a la intemperie).
- Lógica: evaluar también `horario.dias_permitidos` (día de la semana en hora de Guatemala) y `productos_permitidos` contra el combustible elegido, con mensajes claros, igual que lo validaría `POST /despachos`; no cambies las reglas del backend, sólo anticípalas.
- Si `getConsumoHoy` falla, mostrar un aviso visible ("No se pudo verificar el estado del vehículo") en vez de desaparecer.
- Respeta la distinción `bloqueado` vs `credito_bloqueado` del CLAUDE.md del frontend.

### Task 5: /admin/control terminado (frontend)

**Files:** `src/components/admin/ControlOperaciones.tsx`, `src/lib/api/mappers.ts` (`mapGasolinera`), `src/types/index.ts` (`Gasolinera.bloqueado`), `src/mocks/handlers.ts`/`db.ts` si hace falta.

- Cargar las gasolineras reales con `listGasolineras()`; quitar el import de `mock-data`.
- `mapGasolinera` conserva `bloqueado` (boolean); tipo actualizado; MSW lo devuelve y `PATCH /gasolineras/:id` del mock lo persiste.
- El bloqueo por estación pide confirmación (igual que el paro global) y, si el `PATCH` falla, revierte el interruptor y muestra el error. Igual para el paro global si hoy no maneja errores.
- Design System: bordes 0.5px; el botón de confirmar paro no fuerza `!bg-[var(--red)]` sobre `primary` — usa la variante de peligro si `Button` la tiene; si no la tiene, déjalo y dilo.

### Task 6: Restricciones de vehículo funcionando para admin y cliente (frontend)

**Files:** `src/lib/api/mappers.ts` (`mapVehiculo`), `src/types/index.ts`, `src/hooks/useFlota.ts`, `src/lib/api/vehiculos.ts` (o donde viva el PATCH), `src/components/flota/VehiculoRestriccionesModal.tsx`, `src/components/cliente-portal/FlotaContent.tsx`, MSW.

- `mapVehiculo` conserva los campos de restricción (los `limite_*` numéricos pueden llegar como string → número o null; arreglos y horas tal cual).
- `updateRestricciones` llama `PATCH /vehiculos/:id/restricciones` (Tarea 3) sólo con campos de restricción.
- El modal abre con los valores reales; guardar refleja el cambio (y la insignia "Bloqueado" de la tarjeta aparece cuando corresponde). Errores del backend visibles tal cual.
- Visible para el cliente en su portal y para el admin en la vista del portal.
- Para el rol `cliente`, ocultar alta/edición/baja de vehículos en Flota (decisión del controlador); el admin las conserva. Determina el rol como lo hace el resto del portal (no por la ruta si hay una forma explícita).
- MSW: `PATCH /vehiculos/:id/restricciones` con el mismo alcance (cliente sólo los suyos → 404) y la misma validación básica.
- Design System del modal: bordes 0.5px, textos ≥12px.

### Task 7: Firma en la reimpresión del supervisor, logout que borra el push, catálogos para el cliente (frontend)

**Files:** `src/app/operario/historial/page.tsx`, `src/lib/auth.ts` (o donde viva el logout), `src/lib/push.ts`, `src/mocks/handlers.ts`, `src/hooks/useReportes.ts` si hace falta.

- Reimpresión del supervisor: si el despacho tiene `firma_key`, obtener la firma con `firmaDataUrl` (ya pasa por el refresh de `http.ts`) y pasarla a `ValeImpresion`; si falla, mostrar error y no imprimir (igual que el admin).
- Logout: antes de borrar la sesión, si no es modo demo y hay una suscripción push de `/sw.js`, llamar `desactivarPush()` (tolerante: un error o un timeout de ~3 s no bloquea el logout). Revisa todos los puntos de logout (botón del navbar, expiración del refresh) y aplica donde tenga sentido; el logout por refresh fallido no puede llamar al backend con token inválido — en ese caso basta con `unsubscribe()` local.
- MSW: quitar el 403 de catálogos para el cliente (el backend ya lo permite, Tarea 2) y confirmar que el portal del cliente recupera el desglose por combustible y por estación en reportes.

### Task 8: Bugs previos restantes (frontend)

**Files:** según hallazgo.

- **Año del vale en la reimpresión:** `ValeImpresion` (u otro) arma el número con `new Date().getFullYear()`; al reimprimir un vale de un año anterior imprime el año actual. Usar el año (en hora de Guatemala) de `despachado_at` del despacho.
- **Fechas y horas impresas/mostradas en la zona del navegador:** `formatDate` (y la hora del vale) usan la zona del navegador; un admin fuera de Guatemala vería otra hora. Formatear en `America/Guatemala` (exacto: sin DST) en los helpers compartidos de `src/lib/utils.ts` o donde estén; no cambies cálculos de negocio, sólo presentación.
- **`enriquecer` baja 5 catálogos en cada llamada:** caché en memoria por catálogo con vigencia corta (p. ej. 60 s) y que respete el usuario de la sesión (invalidar al cambiar de sesión/logout). Sin dependencias nuevas.
- **Reportes por vehículo/piloto:** los vales sólo de contenedores no entran en esos desgloses (correcto), así que sus totales no suman igual que el total general. Mostrar una nota breve en la UI donde se presentan esos desgloses.

### Task 9: Documentación, verificación en vivo e informe H8

**Files:** `docs/contrato-frontend.md` (si quedó algo), `CLAUDE.md` de ambos repos, `../gasolineras-os-frontend/docs/auditoria-h8-pantallas-wip.md` (sección "Decisión de Milton" con las decisiones de arriba y la fecha 2026-09-30).

- Documentar en los CLAUDE.md lo que cambió (permisos del cliente, endpoint de restricciones, Node 24, caché de catálogos, logout y push).
- Verificación en vivo con navegador automatizado (puppeteer + Chrome for Testing, como en las rondas anteriores), backend real en :3000 y frontend en :3001: checklist en la tablet, paro por estación que persiste tras recargar, restricciones editadas por un cliente y por el admin (y 404 sobre un vehículo ajeno), reportes del cliente con desglose, reimpresión del supervisor con firma, logout que borra la fila de `suscripciones_push`. Restaurar datos y apagar todo al terminar.
