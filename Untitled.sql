CREATE TABLE "gasolineras" (
  "id" uuid PRIMARY KEY,
  "nombre" varchar,
  "direccion" varchar,
  "ciudad" varchar,
  "activo" boolean,
  "created_at" timestamp
);

CREATE TABLE "clientes" (
  "id" uuid PRIMARY KEY,
  "nombre" varchar,
  "nit" varchar,
  "contacto_email" varchar,
  "activo" boolean
);

CREATE TABLE "vehiculos" (
  "id" uuid PRIMARY KEY,
  "cliente_id" uuid,
  "placa" varchar UNIQUE,
  "marca" varchar,
  "modelo" varchar,
  "ruta" varchar,
  "tipo_vehiculo" varchar,
  "activo" boolean
);

CREATE TABLE "pilotos" (
  "id" uuid PRIMARY KEY,
  "cliente_id" uuid,
  "nombre_completo" varchar,
  "codigo" varchar,
  "activo" boolean
);

CREATE TABLE "pilotos_vehiculos" (
  "piloto_id" uuid,
  "vehiculo_id" uuid,
  PRIMARY KEY ("piloto_id", "vehiculo_id")
);

CREATE TABLE "precios_combustible" (
  "id" uuid PRIMARY KEY,
  "gasolinera_id" uuid,
  "fecha" date,
  "tipo_combustible" varchar,
  "precio_galon" decimal
);

CREATE TABLE "usuarios" (
  "id" uuid PRIMARY KEY,
  "gasolinera_id" uuid,
  "email" varchar UNIQUE,
  "nombre" varchar,
  "rol" varchar,
  "activo" boolean
);

CREATE TABLE "despachos" (
  "id" uuid PRIMARY KEY,
  "gasolinera_id" uuid,
  "cliente_id" uuid,
  "vehiculo_id" uuid,
  "piloto_id" uuid,
  "despachador_id" uuid,
  "precio_id" uuid,
  "numero_vale" varchar,
  "serie_vale" varchar,
  "turno" varchar,
  "bomba_numero" int,
  "kilometraje" decimal,
  "galones" decimal,
  "monto_total" decimal,
  "firma_piloto_base64" text,
  "despachado_at" timestamp
);

CREATE TABLE "saldos_cliente" (
  "id" uuid PRIMARY KEY,
  "cliente_id" uuid,
  "saldo_actual" decimal,
  "updated_at" timestamp
);

CREATE TABLE "movimientos_saldo" (
  "id" uuid PRIMARY KEY,
  "cliente_id" uuid,
  "gasolinera_id" uuid,
  "despacho_id" uuid,
  "tipo" varchar,
  "monto" decimal,
  "descripcion" text,
  "created_at" timestamp
);

CREATE UNIQUE INDEX ON "precios_combustible" ("gasolinera_id", "fecha", "tipo_combustible");

CREATE UNIQUE INDEX ON "despachos" ("gasolinera_id", "serie_vale", "numero_vale");

COMMENT ON COLUMN "precios_combustible"."tipo_combustible" IS 'diesel | super | regular | gas_lp';

COMMENT ON COLUMN "usuarios"."gasolinera_id" IS 'null = acceso a todas las gasolineras';

COMMENT ON COLUMN "usuarios"."rol" IS 'admin | operario | cliente';

COMMENT ON COLUMN "despachos"."turno" IS 'manana | tarde';

COMMENT ON COLUMN "movimientos_saldo"."tipo" IS 'debito | abono';

ALTER TABLE "vehiculos" ADD FOREIGN KEY ("cliente_id") REFERENCES "clientes" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "pilotos" ADD FOREIGN KEY ("cliente_id") REFERENCES "clientes" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "pilotos_vehiculos" ADD FOREIGN KEY ("piloto_id") REFERENCES "pilotos" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "pilotos_vehiculos" ADD FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "precios_combustible" ADD FOREIGN KEY ("gasolinera_id") REFERENCES "gasolineras" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "usuarios" ADD FOREIGN KEY ("gasolinera_id") REFERENCES "gasolineras" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "despachos" ADD FOREIGN KEY ("gasolinera_id") REFERENCES "gasolineras" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "despachos" ADD FOREIGN KEY ("cliente_id") REFERENCES "clientes" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "despachos" ADD FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "despachos" ADD FOREIGN KEY ("piloto_id") REFERENCES "pilotos" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "despachos" ADD FOREIGN KEY ("despachador_id") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "despachos" ADD FOREIGN KEY ("precio_id") REFERENCES "precios_combustible" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "saldos_cliente" ADD FOREIGN KEY ("cliente_id") REFERENCES "clientes" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "movimientos_saldo" ADD FOREIGN KEY ("cliente_id") REFERENCES "clientes" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "movimientos_saldo" ADD FOREIGN KEY ("gasolinera_id") REFERENCES "gasolineras" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "movimientos_saldo" ADD FOREIGN KEY ("despacho_id") REFERENCES "despachos" ("id") DEFERRABLE INITIALLY IMMEDIATE;
