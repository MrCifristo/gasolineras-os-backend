# Saldos, Abonos y Cuadres — Design Spec

**Date:** 2026-05-22  
**Status:** Approved

## Overview

Agregar gestión completa del ciclo de saldo de clientes: registro de abonos (créditos) por parte del admin, consulta de saldo y movimientos, y conciliación (cuadre) de períodos contra el sistema externo de bombas.

## Context

El sistema ya descuenta automáticamente cada despacho del `saldo_actual` del cliente e inserta un `movimientos_saldo` con `tipo: 'debito'`. Sin embargo no existe ningún endpoint para:
- Registrar abonos/pagos que aumenten el saldo
- Consultar el saldo actual o el historial de movimientos
- Marcar un período como conciliado contra el sistema externo de bombas

## Schema Changes

### Sin cambios a tablas existentes

`movimientos_saldo.tipo` es `varchar` libre — se usará `'credito'` para abonos (los despachos ya usan `'debito'`).

### Nueva tabla: `cuadres`

```sql
CREATE TABLE cuadres (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo           VARCHAR NOT NULL,          -- 'cliente' | 'gasolinera'
  gasolinera_id  UUID NOT NULL REFERENCES gasolineras(id),
  cliente_id     UUID REFERENCES clientes(id),  -- NULL cuando tipo = 'gasolinera'
  fecha_desde    DATE NOT NULL,
  fecha_hasta    DATE NOT NULL,
  cuadrado_por   UUID NOT NULL REFERENCES usuarios(id),
  notas          TEXT,
  created_at     TIMESTAMP DEFAULT NOW()
);
```

**Invariante:** si `tipo = 'cliente'` entonces `cliente_id IS NOT NULL`; si `tipo = 'gasolinera'` entonces `cliente_id IS NULL`.

## Module Structure

Nuevo módulo NestJS en `src/modules/saldos/`:

```
src/modules/saldos/
  saldos.module.ts
  saldos.controller.ts
  saldos.service.ts
  dto/
    create-abono.dto.ts
    create-cuadre.dto.ts
    query-movimientos.dto.ts
    query-cuadres.dto.ts
```

Schema Drizzle en `src/db/schema/cuadres.schema.ts`, exportado desde `src/db/schema/index.ts`.

## API Endpoints

Todos requieren `@Auth('admin')`.

### POST `/api/v1/saldos/abonos`

Registra un pago/crédito a un cliente.

**Body:**
```json
{
  "cliente_id": "uuid",
  "gasolinera_id": "uuid",
  "monto": "1500.000",
  "descripcion": "Pago transferencia bancaria"  // opcional
}
```

**Lógica (transacción):**
1. Verifica que exista `saldos_cliente` para el cliente.
2. Inserta `movimientos_saldo` con `tipo: 'credito'`, sin `despacho_id`.
3. Actualiza `saldos_cliente.saldo_actual += monto`.

**Respuesta:** el `movimientos_saldo` insertado.

### GET `/api/v1/saldos/cliente/:id`

Retorna saldo actual + últimos 20 movimientos del cliente.

**Respuesta:**
```json
{
  "saldo_actual": "-4500.000",
  "movimientos": [ ...movimientos_saldo ordenados por created_at DESC ]
}
```

### GET `/api/v1/saldos/cliente/:id/movimientos`

Historial paginado con filtros opcionales.

**Query params:** `fecha_desde`, `fecha_hasta`, `tipo` (`debito`|`credito`), `page`, `limit`.

### POST `/api/v1/saldos/cuadres`

Registra un evento de conciliación.

**Body:**
```json
{
  "tipo": "cliente",           // 'cliente' | 'gasolinera'
  "gasolinera_id": "uuid",
  "cliente_id": "uuid",        // requerido si tipo = 'cliente'
  "fecha_desde": "2026-05-01",
  "fecha_hasta": "2026-05-22",
  "notas": "Cuadre OK, diferencia 0"  // opcional
}
```

**Lógica:**
1. Valida invariante `tipo`/`cliente_id`.
2. Inserta en `cuadres` con `cuadrado_por = request.user.id`.

**Respuesta:** el `cuadre` insertado.

### GET `/api/v1/saldos/cuadres`

Lista cuadres con filtros opcionales.

**Query params:** `tipo`, `cliente_id`, `gasolinera_id`, `fecha_desde`, `fecha_hasta`.

## Authorization

Solo `admin`. Los roles `operario` y `cliente` no tienen acceso a ningún endpoint de este módulo.

## Error Handling

- `POST /abonos`: `404` si `cliente_id` no existe; `400` si `monto <= 0`.
- `POST /cuadres`: `400` si `tipo = 'cliente'` y `cliente_id` ausente.
- `GET /cliente/:id`: `404` si el cliente no existe.

## Out of Scope

- Notificaciones al cliente al recibir un abono.
- Bloqueo de despachos cuando el saldo está muy negativo.
- Integración directa con el sistema de bombas (el cuadre es un marcador manual).
