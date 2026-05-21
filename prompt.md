# Prompt Maestro — gasfuel-backend
> Pega este contenido completo en Claude Code dentro de la carpeta donde vas a crear el proyecto.

---

## Instrucción principal

Inicializa un proyecto NestJS completo llamado `Gas-Os-backend` con la siguiente arquitectura. Crea todos los archivos necesarios.

** ACLARACIÓN IMPORTANTE** A lo largo de este prompt se hace referencia a instalar con npm todos los archivos necesarios, pero quiero que utilicemos PNPM en lugar de NPM como manejador de paquetes para todas las dependencias necesarias.

---

## Stack y versiones

- NestJS con TypeScript (strict mode)
- Drizzle ORM + drizzle-kit
- PostgreSQL (driver: pg)
- Supabase Auth (verificación JWT local, sin llamadas a Supabase en cada request)
- @nestjs/config para variables de entorno
- zod para validación de esquemas
- class-validator + class-transformer para DTOs

---

## Estructura de carpetas

```
gasfuel-backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── db/
│   │   ├── db.module.ts
│   │   ├── db.service.ts
│   │   └── schema/
│   │       ├── index.ts
│   │       ├── gasolineras.schema.ts
│   │       ├── clientes.schema.ts
│   │       ├── vehiculos.schema.ts
│   │       ├── pilotos.schema.ts
│   │       ├── pilotos-vehiculos.schema.ts
│   │       ├── precios-combustible.schema.ts
│   │       ├── usuarios.schema.ts
│   │       ├── despachos.schema.ts
│   │       ├── saldos-cliente.schema.ts
│   │       └── movimientos-saldo.schema.ts
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.guard.ts
│   │   ├── roles.decorator.ts
│   │   └── jwt.strategy.ts
│   └── modules/
│       ├── gasolineras/
│       │   ├── gasolineras.module.ts
│       │   ├── gasolineras.controller.ts
│       │   ├── gasolineras.service.ts
│       │   └── dto/
│       │       ├── create-gasolinera.dto.ts
│       │       └── update-gasolinera.dto.ts
│       ├── clientes/
│       │   ├── clientes.module.ts
│       │   ├── clientes.controller.ts
│       │   ├── clientes.service.ts
│       │   └── dto/
│       │       ├── create-cliente.dto.ts
│       │       └── update-cliente.dto.ts
│       ├── vehiculos/
│       │   ├── vehiculos.module.ts
│       │   ├── vehiculos.controller.ts
│       │   ├── vehiculos.service.ts
│       │   └── dto/
│       │       ├── create-vehiculo.dto.ts
│       │       └── update-vehiculo.dto.ts
│       ├── pilotos/
│       │   ├── pilotos.module.ts
│       │   ├── pilotos.controller.ts
│       │   ├── pilotos.service.ts
│       │   └── dto/
│       │       ├── create-piloto.dto.ts
│       │       └── update-piloto.dto.ts
│       ├── precios-combustible/
│       │   ├── precios-combustible.module.ts
│       │   ├── precios-combustible.controller.ts
│       │   ├── precios-combustible.service.ts
│       │   └── dto/
│       │       ├── create-precio.dto.ts
│       │       └── update-precio.dto.ts
│       ├── despachos/
│       │   ├── despachos.module.ts
│       │   ├── despachos.controller.ts
│       │   ├── despachos.service.ts
│       │   └── dto/
│       │       ├── create-despacho.dto.ts
│       │       └── update-despacho.dto.ts
│       └── reportes/
│           ├── reportes.module.ts
│           ├── reportes.controller.ts
│           └── reportes.service.ts
├── docker-compose.yml
├── drizzle.config.ts
├── .env.example
└── package.json
```

---

## Schema de base de datos

El proyecto ya tiene el schema definido en el repo. Léelo desde los archivos `schema.dbml` y `schema.sql` que están en la raíz del repositorio antes de generar cualquier archivo de schema Drizzle. Úsalos como fuente de verdad. Las tablas son:

- `gasolineras` — ubicaciones físicas de la empresa operadora
- `clientes` — empresas cliente (ej. Coca-Cola), globales a todas las gasolineras
- `vehiculos` — flota de cada cliente, global
- `pilotos` — conductores de cada cliente, global
- `pilotos_vehiculos` — relación muchos-a-muchos entre pilotos y vehículos
- `precios_combustible` — precio por tipo de combustible, por gasolinera y por fecha (único por gasolinera+fecha+tipo)
- `usuarios` — usuarios del sistema; `gasolinera_id` es nullable (null = acceso a todas las gasolineras)
- `despachos` — registro central de cada despacho; incluye `firma_piloto_base64` (text), turno, bomba, kilometraje, galones, monto
- `saldos_cliente` — saldo actual por cliente (relación 1-a-1)
- `movimientos_saldo` — historial de débitos y abonos por cliente, incluye `gasolinera_id`

### Tipos y convenciones Drizzle

- Todos los IDs son `uuid('id').primaryKey().defaultRandom()`
- Timestamps usan `timestamp('created_at').defaultNow()` y `timestamp('updated_at')`
- Decimales (galones, monto, precio, saldo) usan `numeric` con precisión: `numeric('galones', { precision: 10, scale: 3 })`
- Booleanos usan `boolean('activo').default(true)`
- El campo `tipo_combustible` es `varchar` con valores posibles: `'diesel' | 'super' | 'regular' | 'gas_lp'`
- El campo `turno` es `varchar` con valores: `'manana' | 'tarde'`
- El campo `rol` en usuarios es `varchar` con valores: `'admin' | 'operario' | 'cliente'`
- El campo `tipo` en movimientos_saldo es `varchar` con valores: `'debito' | 'abono'`
- Exportar todas las tablas y relaciones desde `src/db/schema/index.ts`

---

## Autenticación

Usar Supabase Auth con verificación JWT local. El flujo es:

1. El frontend hace login con Supabase directamente y obtiene un JWT
2. Cada request al backend incluye el JWT en el header `Authorization: Bearer <token>`
3. El backend verifica el JWT localmente usando `SUPABASE_JWT_SECRET` (sin llamar a Supabase en cada request)
4. Del JWT se extrae el `sub` (que es el `supabase_user_id`)
5. Se busca el usuario en la tabla `usuarios` por `supabase_user_id` para obtener rol y `gasolinera_id`

### auth.guard.ts

- Implementar `CanActivate`
- Verificar JWT con `jsonwebtoken` usando `SUPABASE_JWT_SECRET`
- Adjuntar el usuario completo al `request.user`
- Lanzar `UnauthorizedException` si el token es inválido o el usuario no existe en la tabla `usuarios`

### roles.decorator.ts

```typescript
export type Role = 'admin' | 'operario' | 'cliente';

@SetMetadata('roles', roles)
export const Roles = (...roles: Role[]) => ...

@UseGuards(AuthGuard, RolesGuard)
export const Auth = (...roles: Role[]) => applyDecorators(...)
```

### Reglas de acceso por rol

- `admin`: acceso total a todos los endpoints y todas las gasolineras
- `operario`: solo puede crear despachos y consultar datos de su `gasolinera_id`
- `cliente`: solo puede consultar despachos, vehículos y pilotos de su propio `cliente_id`

---

## Módulos — detalle de cada uno

### gasolineras

CRUD completo. Solo `admin` puede crear, editar y desactivar.

Endpoints:
- `GET /gasolineras` — lista todas (admin) o solo la propia (operario)
- `GET /gasolineras/:id` — detalle
- `POST /gasolineras` — crear (admin)
- `PATCH /gasolineras/:id` — editar (admin)
- `DELETE /gasolineras/:id` — soft delete, setea `activo = false` (admin)

### clientes

CRUD completo. Globales, no pertenecen a ninguna gasolinera.

Endpoints:
- `GET /clientes` — lista todos los activos
- `GET /clientes/:id` — detalle con sus vehículos y pilotos
- `POST /clientes` — crear (admin)
- `PATCH /clientes/:id` — editar (admin)
- `DELETE /clientes/:id` — soft delete (admin)

### vehiculos

CRUD completo. Pertenecen a un cliente.

Endpoints:
- `GET /vehiculos` — lista, filtrable por `cliente_id` y `activo`
- `GET /vehiculos/:id` — detalle
- `POST /vehiculos` — crear (admin)
- `PATCH /vehiculos/:id` — editar (admin)
- `DELETE /vehiculos/:id` — soft delete (admin)
- `POST /vehiculos/:id/pilotos/:pilotoId` — asignar piloto a vehículo
- `DELETE /vehiculos/:id/pilotos/:pilotoId` — desasignar piloto

### pilotos

CRUD completo. Pertenecen a un cliente.

Endpoints:
- `GET /pilotos` — lista, filtrable por `cliente_id`
- `GET /pilotos/:id` — detalle con vehículos asignados
- `POST /pilotos` — crear (admin)
- `PATCH /pilotos/:id` — editar (admin)
- `DELETE /pilotos/:id` — soft delete (admin)

### precios-combustible

Gestión del precio diario por gasolinera y tipo de combustible.

Endpoints:
- `GET /precios-combustible` — lista, filtrable por `gasolinera_id` y `fecha`
- `GET /precios-combustible/hoy` — precios de hoy para la gasolinera del operario autenticado
- `POST /precios-combustible` — registrar precio del día (admin)
- `PATCH /precios-combustible/:id` — corregir precio (admin)

### despachos

El módulo central. Operarios crean despachos, clientes y admins los consultan.

Endpoints:
- `GET /despachos` — lista con filtros: `gasolinera_id`, `cliente_id`, `vehiculo_id`, `piloto_id`, `fecha_desde`, `fecha_hasta`, `turno`, `tipo_combustible`. Paginación con `page` y `limit`.
- `GET /despachos/:id` — detalle completo con joins a vehículo, piloto, gasolinera, precio
- `POST /despachos` — crear despacho (operario). Al crear:
  1. Buscar el precio del día para el tipo de combustible y gasolinera
  2. Calcular `monto_total = galones * precio_galon`
  3. Generar `numero_vale` correlativo por gasolinera y serie
  4. Crear un `movimiento_saldo` de tipo `debito` por el monto
  5. Actualizar `saldos_cliente.saldo_actual`
  Todo en una transacción.
- `PATCH /despachos/:id` — solo corrección de `kilometraje` y `firma_piloto_base64` (admin)

### reportes

Agregaciones para el portal cliente y panel admin.

Endpoints:
- `GET /reportes/resumen` — query params: `cliente_id`, `gasolinera_id`, `fecha_desde`, `fecha_hasta`. Retorna:
  - total galones despachados
  - total monto
  - desglose por tipo de combustible
  - desglose por gasolinera
- `GET /reportes/consumo-por-vehiculo` — ranking de vehículos por galones consumidos en el período
- `GET /reportes/consumo-por-piloto` — ranking de pilotos por galones consumidos
- `GET /reportes/tendencia-mensual` — consumo agrupado por mes (últimos 12 meses)
- `GET /reportes/rendimiento-vehiculo/:vehiculoId` — historial de km/galón por despacho para un vehículo

Todos los endpoints de reportes usan Drizzle con agregaciones SQL (sum, count, avg, group by). No calcular en JavaScript.

---

## docker-compose.yml

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: gasfuel_db
      POSTGRES_USER: gasfuel_user
      POSTGRES_PASSWORD: gasfuel_pass
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

---

## .env.example

```env
# Base de datos
DATABASE_URL=postgresql://gasfuel_user:gasfuel_pass@localhost:5432/gasfuel_db

# Supabase
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
SUPABASE_JWT_SECRET=tu-jwt-secret

# App
PORT=3000
NODE_ENV=development
```

---

## drizzle.config.ts

```typescript
import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
dotenv.config();

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
```

---

## package.json — scripts requeridos

```json
{
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "db:push": "drizzle-kit push"
  }
}
```

---

## main.ts

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  await app.listen(process.env.PORT ?? 3000);
  console.log(`gasfuel-backend corriendo en puerto ${process.env.PORT ?? 3000}`);
}
bootstrap();
```

---

## Convenciones de código

- Todos los servicios inyectan `DbService` para acceder a Drizzle
- Todos los controllers usan el decorador `@Auth()` con los roles permitidos
- Los DTOs usan `class-validator`: `@IsString()`, `@IsUUID()`, `@IsEnum()`, `@IsOptional()`, etc.
- Los `UpdateDto` extienden `PartialType(CreateDto)`
- Los errores usan las excepciones de NestJS: `NotFoundException`, `BadRequestException`, `ForbiddenException`
- Soft delete en todas las tablas con `activo = false`, nunca `DELETE` físico
- Todas las queries filtran por `activo = true` por defecto salvo que se indique lo contrario

---

## Dependencias a instalar

```bash
npm install @nestjs/common @nestjs/core @nestjs/platform-express @nestjs/config
npm install drizzle-orm drizzle-kit pg
npm install @supabase/supabase-js jsonwebtoken
npm install class-validator class-transformer zod
npm install reflect-metadata rxjs
npm install --save-dev @types/pg @types/jsonwebtoken @nestjs/cli typescript ts-node
```

---

## Instrucciones finales

1. Leer `schema.dbml` y `schema.sql` de la raíz del repo antes de generar los schemas Drizzle
2. Instalar todas las dependencias con npm
3. Crear todos los archivos según la estructura definida
4. Asegurarse de que el proyecto compila sin errores con `npm run build`
5. Al final mostrar los comandos para levantar el proyecto:

```bash
docker compose up -d      # Levanta PostgreSQL local
npm run db:generate       # Genera migraciones desde el schema Drizzle
npm run db:migrate        # Aplica migraciones a la DB
npm run start:dev         # Arranca en localhost:3000
```