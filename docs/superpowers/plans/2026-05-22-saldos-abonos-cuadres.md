# Saldos, Abonos y Cuadres — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `saldos` module that lets admins register credit payments (abonos), query client balances and movement history, and record reconciliation events (cuadres) against the external pump system.

**Architecture:** New NestJS module `src/modules/saldos/` with controller, service, and 4 DTOs. One new Drizzle schema `cuadres` with a Drizzle migration. All endpoints are `admin`-only. The abono flow runs inside a DB transaction that inserts a `movimientos_saldo` row and increments `saldos_cliente.saldo_actual`. Cuadres are append-only audit records — they never mutate balances.

**Tech Stack:** NestJS 11, Drizzle ORM (pg), class-validator, class-transformer, Swagger, Jest + Supertest (e2e).

---

## File Map

| Action | Path |
|--------|------|
| Create | `src/db/schema/cuadres.schema.ts` |
| Modify | `src/db/schema/index.ts` |
| Create | `src/modules/saldos/dto/create-abono.dto.ts` |
| Create | `src/modules/saldos/dto/create-cuadre.dto.ts` |
| Create | `src/modules/saldos/dto/query-movimientos.dto.ts` |
| Create | `src/modules/saldos/dto/query-cuadres.dto.ts` |
| Create | `src/modules/saldos/saldos.service.ts` |
| Create | `src/modules/saldos/saldos.controller.ts` |
| Create | `src/modules/saldos/saldos.module.ts` |
| Modify | `src/app.module.ts` |
| Modify | `test/gasfuel.e2e-spec.ts` |

---

## Task 1: Drizzle schema `cuadres` + migración

**Files:**
- Create: `src/db/schema/cuadres.schema.ts`
- Modify: `src/db/schema/index.ts`

- [ ] **Step 1.1: Crear `cuadres.schema.ts`**

```typescript
// src/db/schema/cuadres.schema.ts
import { pgTable, uuid, varchar, text, date, timestamp } from 'drizzle-orm/pg-core';
import { clientes } from './clientes.schema';
import { gasolineras } from './gasolineras.schema';
import { usuarios } from './usuarios.schema';

export const cuadres = pgTable('cuadres', {
  id: uuid('id').primaryKey().defaultRandom(),
  tipo: varchar('tipo').notNull(),
  gasolinera_id: uuid('gasolinera_id')
    .notNull()
    .references(() => gasolineras.id),
  cliente_id: uuid('cliente_id').references(() => clientes.id),
  fecha_desde: date('fecha_desde').notNull(),
  fecha_hasta: date('fecha_hasta').notNull(),
  cuadrado_por: uuid('cuadrado_por')
    .notNull()
    .references(() => usuarios.id),
  notas: text('notas'),
  created_at: timestamp('created_at').defaultNow(),
});
```

- [ ] **Step 1.2: Exportar desde `index.ts`**

Agregar al final de `src/db/schema/index.ts`:

```typescript
export * from './cuadres.schema';
```

El archivo completo debe quedar:

```typescript
export * from './gasolineras.schema';
export * from './clientes.schema';
export * from './vehiculos.schema';
export * from './pilotos.schema';
export * from './pilotos-vehiculos.schema';
export * from './precios-combustible.schema';
export * from './usuarios.schema';
export * from './despachos.schema';
export * from './saldos-cliente.schema';
export * from './movimientos-saldo.schema';
export * from './cuadres.schema';
```

- [ ] **Step 1.3: Generar y aplicar migración**

```bash
pnpm db:generate
pnpm db:migrate
```

Verificar que el output incluya `cuadres` y termine sin errores.

- [ ] **Step 1.4: Commit**

```bash
git add src/db/schema/cuadres.schema.ts src/db/schema/index.ts drizzle/
git commit -m "feat: add cuadres schema and migration"
```

---

## Task 2: DTOs del módulo saldos

**Files:**
- Create: `src/modules/saldos/dto/create-abono.dto.ts`
- Create: `src/modules/saldos/dto/create-cuadre.dto.ts`
- Create: `src/modules/saldos/dto/query-movimientos.dto.ts`
- Create: `src/modules/saldos/dto/query-cuadres.dto.ts`

- [ ] **Step 2.1: Crear `create-abono.dto.ts`**

```typescript
// src/modules/saldos/dto/create-abono.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAbonoDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  cliente_id: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  @IsUUID()
  gasolinera_id: string;

  @ApiProperty({ example: '1500.000', description: 'Monto en quetzales, mayor a cero' })
  @IsNumberString()
  @IsNotEmpty()
  monto: string;

  @ApiPropertyOptional({ example: 'Pago transferencia bancaria' })
  @IsOptional()
  @IsString()
  descripcion?: string;
}
```

- [ ] **Step 2.2: Crear `create-cuadre.dto.ts`**

```typescript
// src/modules/saldos/dto/create-cuadre.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

export class CreateCuadreDto {
  @ApiProperty({ enum: ['cliente', 'gasolinera'] })
  @IsIn(['cliente', 'gasolinera'])
  tipo: 'cliente' | 'gasolinera';

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  @IsUUID()
  gasolinera_id: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Requerido cuando tipo = "cliente"',
  })
  @ValidateIf((o) => o.tipo === 'cliente')
  @IsUUID()
  cliente_id?: string;

  @ApiProperty({ example: '2026-05-01' })
  @IsDateString()
  fecha_desde: string;

  @ApiProperty({ example: '2026-05-22' })
  @IsDateString()
  fecha_hasta: string;

  @ApiPropertyOptional({ example: 'Cuadre OK, diferencia 0' })
  @IsOptional()
  @IsString()
  notas?: string;
}
```

- [ ] **Step 2.3: Crear `query-movimientos.dto.ts`**

```typescript
// src/modules/saldos/dto/query-movimientos.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class QueryMovimientosDto {
  @ApiPropertyOptional({ example: '2026-05-01' })
  @IsOptional()
  @IsDateString()
  fecha_desde?: string;

  @ApiPropertyOptional({ example: '2026-05-31' })
  @IsOptional()
  @IsDateString()
  fecha_hasta?: string;

  @ApiPropertyOptional({ enum: ['debito', 'credito'] })
  @IsOptional()
  @IsIn(['debito', 'credito'])
  tipo?: 'debito' | 'credito';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
```

- [ ] **Step 2.4: Crear `query-cuadres.dto.ts`**

```typescript
// src/modules/saldos/dto/query-cuadres.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export class QueryCuadresDto {
  @ApiPropertyOptional({ enum: ['cliente', 'gasolinera'] })
  @IsOptional()
  @IsIn(['cliente', 'gasolinera'])
  tipo?: 'cliente' | 'gasolinera';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cliente_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  gasolinera_id?: string;

  @ApiPropertyOptional({ example: '2026-05-01' })
  @IsOptional()
  @IsDateString()
  fecha_desde?: string;

  @ApiPropertyOptional({ example: '2026-05-31' })
  @IsOptional()
  @IsDateString()
  fecha_hasta?: string;
}
```

- [ ] **Step 2.5: Commit**

```bash
git add src/modules/saldos/dto/
git commit -m "feat: add saldos DTOs"
```

---

## Task 3: SaldosService

**Files:**
- Create: `src/modules/saldos/saldos.service.ts`

- [ ] **Step 3.1: Escribir tests E2E que fallarán** (los tests completos van en Task 5; este paso es solo el marcador TDD — los tests corren hasta 404 porque el módulo no existe aún)

```bash
# Verificar que la suite corre actualmente sin errores
pnpm test:e2e:gasfuel 2>&1 | tail -5
```

Resultado esperado: suite pasa (el bloque de saldos no existe todavía).

- [ ] **Step 3.2: Crear `saldos.service.ts`**

```typescript
// src/modules/saldos/saldos.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import {
  cuadres,
  movimientosSaldo,
  saldosCliente,
} from '../../db/schema';
import { CreateAbonoDto } from './dto/create-abono.dto';
import { CreateCuadreDto } from './dto/create-cuadre.dto';
import { QueryCuadresDto } from './dto/query-cuadres.dto';
import { QueryMovimientosDto } from './dto/query-movimientos.dto';

@Injectable()
export class SaldosService {
  constructor(private db: DbService) {}

  async getClienteSaldo(clienteId: string) {
    const [saldo] = await this.db.db
      .select()
      .from(saldosCliente)
      .where(eq(saldosCliente.cliente_id, clienteId))
      .limit(1);

    if (!saldo) throw new NotFoundException('Cliente no encontrado');

    const movimientos = await this.db.db
      .select()
      .from(movimientosSaldo)
      .where(eq(movimientosSaldo.cliente_id, clienteId))
      .orderBy(desc(movimientosSaldo.created_at))
      .limit(20);

    return { saldo_actual: saldo.saldo_actual, movimientos };
  }

  async getClienteMovimientos(clienteId: string, query: QueryMovimientosDto) {
    const [saldo] = await this.db.db
      .select()
      .from(saldosCliente)
      .where(eq(saldosCliente.cliente_id, clienteId))
      .limit(1);

    if (!saldo) throw new NotFoundException('Cliente no encontrado');

    const { page = 1, limit = 20, fecha_desde, fecha_hasta, tipo } = query;
    const conditions: ReturnType<typeof eq>[] = [eq(movimientosSaldo.cliente_id, clienteId)];

    if (fecha_desde)
      conditions.push(sql`${movimientosSaldo.created_at}::date >= ${fecha_desde}::date` as any);
    if (fecha_hasta)
      conditions.push(sql`${movimientosSaldo.created_at}::date <= ${fecha_hasta}::date` as any);
    if (tipo) conditions.push(eq(movimientosSaldo.tipo, tipo));

    return this.db.db
      .select()
      .from(movimientosSaldo)
      .where(and(...conditions))
      .orderBy(desc(movimientosSaldo.created_at))
      .limit(limit)
      .offset((page - 1) * limit);
  }

  async createAbono(dto: CreateAbonoDto) {
    if (parseFloat(dto.monto) <= 0) {
      throw new BadRequestException('El monto debe ser mayor a cero');
    }

    const [saldo] = await this.db.db
      .select()
      .from(saldosCliente)
      .where(eq(saldosCliente.cliente_id, dto.cliente_id))
      .limit(1);

    if (!saldo) throw new NotFoundException('Cliente no encontrado');

    return this.db.db.transaction(async (tx) => {
      const [movimiento] = await tx
        .insert(movimientosSaldo)
        .values({
          cliente_id: dto.cliente_id,
          gasolinera_id: dto.gasolinera_id,
          tipo: 'credito',
          monto: dto.monto,
          descripcion: dto.descripcion ?? null,
        })
        .returning();

      await tx
        .update(saldosCliente)
        .set({
          saldo_actual: sql`saldo_actual + ${dto.monto}::numeric`,
          updated_at: new Date(),
        })
        .where(eq(saldosCliente.cliente_id, dto.cliente_id));

      return movimiento;
    });
  }

  async createCuadre(dto: CreateCuadreDto, userId: string) {
    if (dto.tipo === 'cliente' && !dto.cliente_id) {
      throw new BadRequestException('cliente_id es requerido cuando tipo es "cliente"');
    }

    const [cuadre] = await this.db.db
      .insert(cuadres)
      .values({
        tipo: dto.tipo,
        gasolinera_id: dto.gasolinera_id,
        cliente_id: dto.tipo === 'cliente' ? dto.cliente_id : null,
        fecha_desde: dto.fecha_desde,
        fecha_hasta: dto.fecha_hasta,
        cuadrado_por: userId,
        notas: dto.notas ?? null,
      })
      .returning();

    return cuadre;
  }

  async findCuadres(query: QueryCuadresDto) {
    const conditions: any[] = [];

    if (query.tipo) conditions.push(eq(cuadres.tipo, query.tipo));
    if (query.cliente_id) conditions.push(eq(cuadres.cliente_id, query.cliente_id));
    if (query.gasolinera_id) conditions.push(eq(cuadres.gasolinera_id, query.gasolinera_id));
    if (query.fecha_desde)
      conditions.push(sql`${cuadres.fecha_hasta} >= ${query.fecha_desde}::date`);
    if (query.fecha_hasta)
      conditions.push(sql`${cuadres.fecha_desde} <= ${query.fecha_hasta}::date`);

    return this.db.db
      .select()
      .from(cuadres)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(cuadres.created_at));
  }
}
```

- [ ] **Step 3.3: Commit**

```bash
git add src/modules/saldos/saldos.service.ts
git commit -m "feat: add SaldosService"
```

---

## Task 4: SaldosController, SaldosModule y registro en AppModule

**Files:**
- Create: `src/modules/saldos/saldos.controller.ts`
- Create: `src/modules/saldos/saldos.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 4.1: Crear `saldos.controller.ts`**

```typescript
// src/modules/saldos/saldos.controller.ts
import { Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../../auth/roles.decorator';
import { CreateAbonoDto } from './dto/create-abono.dto';
import { CreateCuadreDto } from './dto/create-cuadre.dto';
import { QueryCuadresDto } from './dto/query-cuadres.dto';
import { QueryMovimientosDto } from './dto/query-movimientos.dto';
import { SaldosService } from './saldos.service';

@ApiTags('saldos')
@ApiBearerAuth('JWT')
@Controller('saldos')
export class SaldosController {
  constructor(private readonly service: SaldosService) {}

  @Get('cliente/:id')
  @Auth('admin')
  @ApiOperation({ summary: 'Saldo actual + últimos 20 movimientos del cliente' })
  getClienteSaldo(@Param('id') id: string) {
    return this.service.getClienteSaldo(id);
  }

  @Get('cliente/:id/movimientos')
  @Auth('admin')
  @ApiOperation({ summary: 'Historial paginado de movimientos del cliente' })
  getClienteMovimientos(@Param('id') id: string, @Query() query: QueryMovimientosDto) {
    return this.service.getClienteMovimientos(id, query);
  }

  @Post('abonos')
  @Auth('admin')
  @ApiOperation({ summary: 'Registrar abono (crédito) a un cliente' })
  createAbono(@Body() dto: CreateAbonoDto) {
    return this.service.createAbono(dto);
  }

  @Post('cuadres')
  @Auth('admin')
  @ApiOperation({ summary: 'Registrar cuadre de conciliación' })
  createCuadre(@Body() dto: CreateCuadreDto, @Request() req: any) {
    return this.service.createCuadre(dto, req.user.id);
  }

  @Get('cuadres')
  @Auth('admin')
  @ApiOperation({ summary: 'Listar cuadres con filtros opcionales' })
  findCuadres(@Query() query: QueryCuadresDto) {
    return this.service.findCuadres(query);
  }
}
```

- [ ] **Step 4.2: Crear `saldos.module.ts`**

```typescript
// src/modules/saldos/saldos.module.ts
import { Module } from '@nestjs/common';
import { SaldosController } from './saldos.controller';
import { SaldosService } from './saldos.service';

@Module({
  controllers: [SaldosController],
  providers: [SaldosService],
})
export class SaldosModule {}
```

- [ ] **Step 4.3: Registrar `SaldosModule` en `AppModule`**

Modificar `src/app.module.ts` para agregar el import de `SaldosModule`:

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { GasolinerasModule } from './modules/gasolineras/gasolineras.module';
import { ClientesModule } from './modules/clientes/clientes.module';
import { VehiculosModule } from './modules/vehiculos/vehiculos.module';
import { PilotosModule } from './modules/pilotos/pilotos.module';
import { PreciosCombustibleModule } from './modules/precios-combustible/precios-combustible.module';
import { DespachosModule } from './modules/despachos/despachos.module';
import { ReportesModule } from './modules/reportes/reportes.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';
import { SaldosModule } from './modules/saldos/saldos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    AuthModule,
    GasolinerasModule,
    ClientesModule,
    VehiculosModule,
    PilotosModule,
    PreciosCombustibleModule,
    DespachosModule,
    ReportesModule,
    UsuariosModule,
    SaldosModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4.4: Verificar que la app compila**

```bash
pnpm build 2>&1 | tail -10
```

Resultado esperado: sin errores de TypeScript. Si hay errores de tipos en el service (el cast `as any` de los sql conditions), son aceptables.

- [ ] **Step 4.5: Commit**

```bash
git add src/modules/saldos/saldos.controller.ts src/modules/saldos/saldos.module.ts src/app.module.ts
git commit -m "feat: add SaldosController, SaldosModule and register in AppModule"
```

---

## Task 5: Tests E2E

**Files:**
- Modify: `test/gasfuel.e2e-spec.ts`

El spec e2e existente crea una gasolinera, cliente, vehículo, piloto, precios y despachos en bloques previos, y los IDs quedan disponibles en variables del describe externo. El bloque de saldos se añade como Bloque 13, antes de los soft-deletes del Bloque 12 (renombrar Bloque 12 a Bloque 13 no es necesario — simplemente insertar el nuevo bloque antes del cierre del describe).

Insertar **antes** del último `});` que cierra el `describe('GasFuel OS — Suite E2E Completa', ...)`:

- [ ] **Step 5.1: Agregar variables de estado al bloque externo**

En la sección de declaración de IDs (alrededor de la línea 58 del archivo original), agregar:

```typescript
  let saldosCuadreId: string;
```

- [ ] **Step 5.2: Añadir bloque 13 al final del describe principal**

Insertar el siguiente bloque justo antes del último `});` del archivo:

```typescript
  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 13 — Saldos, Abonos y Cuadres
  // ════════════════════════════════════════════════════════════════════════

  describe('13. Saldos, Abonos y Cuadres', () => {
    it('admin consulta saldo del cliente → 200, saldo negativo por despachos previos', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${cliente1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('saldo_actual');
      expect(res.body).toHaveProperty('movimientos');
      expect(Array.isArray(res.body.movimientos)).toBe(true);
      // El saldo debe ser negativo porque se hicieron despachos en bloques anteriores
      expect(parseFloat(res.body.saldo_actual)).toBeLessThan(0);
    });

    it('admin registra abono al cliente → 201, devuelve movimiento tipo credito', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saldos/abonos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          cliente_id: cliente1Id,
          gasolinera_id: gasolineraId,
          monto: '10000.000',
          descripcion: 'Pago transferencia bancaria E2E',
        });

      expect(res.status).toBe(201);
      expect(res.body.tipo).toBe('credito');
      expect(res.body.monto).toBe('10000.000');
      expect(res.body.cliente_id).toBe(cliente1Id);
    });

    it('saldo del cliente aumentó tras el abono → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${cliente1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // Debe haber al menos un movimiento tipo credito
      const creditos = res.body.movimientos.filter((m: any) => m.tipo === 'credito');
      expect(creditos.length).toBeGreaterThanOrEqual(1);
    });

    it('admin lista movimientos paginados del cliente → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${cliente1Id}/movimientos?page=1&limit=10`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('admin filtra movimientos por tipo=credito → 200, solo créditos', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${cliente1Id}/movimientos?tipo=credito`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      res.body.forEach((m: any) => expect(m.tipo).toBe('credito'));
    });

    it('admin registra cuadre por cliente → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saldos/cuadres')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tipo: 'cliente',
          gasolinera_id: gasolineraId,
          cliente_id: cliente1Id,
          fecha_desde: '2026-05-01',
          fecha_hasta: '2026-05-22',
          notas: 'Cuadre E2E OK',
        });

      expect(res.status).toBe(201);
      expect(res.body.tipo).toBe('cliente');
      expect(res.body.cliente_id).toBe(cliente1Id);
      saldosCuadreId = res.body.id;
    });

    it('admin registra cuadre por gasolinera → 201, sin cliente_id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saldos/cuadres')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tipo: 'gasolinera',
          gasolinera_id: gasolineraId,
          fecha_desde: '2026-05-01',
          fecha_hasta: '2026-05-22',
        });

      expect(res.status).toBe(201);
      expect(res.body.tipo).toBe('gasolinera');
      expect(res.body.cliente_id).toBeNull();
    });

    it('admin lista cuadres → 200, incluye los dos creados', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/saldos/cuadres')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map((c: any) => c.id);
      expect(ids).toContain(saldosCuadreId);
    });

    it('admin filtra cuadres por tipo=cliente → 200, todos son tipo cliente', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/saldos/cuadres?tipo=cliente')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      res.body.forEach((c: any) => expect(c.tipo).toBe('cliente'));
    });

    it('abono con monto=0 → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saldos/abonos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          cliente_id: cliente1Id,
          gasolinera_id: gasolineraId,
          monto: '0',
        });

      expect(res.status).toBe(400);
    });

    it('abono con monto negativo → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saldos/abonos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          cliente_id: cliente1Id,
          gasolinera_id: gasolineraId,
          monto: '-500.000',
        });

      expect(res.status).toBe(400);
    });

    it('saldo de cliente inexistente → 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/saldos/cliente/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('cuadre tipo=cliente sin cliente_id → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saldos/cuadres')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tipo: 'cliente',
          gasolinera_id: gasolineraId,
          fecha_desde: '2026-05-01',
          fecha_hasta: '2026-05-22',
        });

      expect(res.status).toBe(400);
    });

    it('operario no puede acceder a saldos → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${cliente1Id}`)
        .set('Authorization', `Bearer ${operarioToken}`);

      expect(res.status).toBe(403);
    });
  });
```

- [ ] **Step 5.3: Correr la suite E2E completa**

```bash
pnpm test:e2e:gasfuel 2>&1 | tail -30
```

Resultado esperado: todos los tests del Bloque 13 pasan. Si algún test falla, revisar el error e iterar.

- [ ] **Step 5.4: Commit**

```bash
git add test/gasfuel.e2e-spec.ts
git commit -m "test: add saldos/abonos/cuadres e2e tests"
```

---

## Self-Review

**Spec coverage check:**

| Requisito del spec | Cubierto en |
|---|---|
| POST /saldos/abonos — insertar crédito + actualizar saldo en transacción | Task 3 (SaldosService.createAbono) + Task 5 |
| GET /saldos/cliente/:id — saldo + movimientos | Task 3 (getClienteSaldo) + Task 5 |
| GET /saldos/cliente/:id/movimientos — paginado + filtros | Task 3 (getClienteMovimientos) + Task 5 |
| POST /saldos/cuadres — insertar cuadre con cuadrado_por | Task 3 (createCuadre) + Task 5 |
| GET /saldos/cuadres — listar con filtros | Task 3 (findCuadres) + Task 5 |
| Tabla cuadres con todos los campos del spec | Task 1 |
| Solo admin puede acceder | Task 4 (@Auth('admin') en todos los endpoints) + Task 5 |
| 404 si cliente no existe | Task 3 + Task 5 |
| 400 si monto <= 0 | Task 3 + Task 5 |
| 400 si tipo=cliente y cliente_id ausente | Task 3 + Task 5 |
| Migración Drizzle | Task 1 |
