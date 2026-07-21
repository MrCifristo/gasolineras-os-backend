CREATE TYPE "public"."rol" AS ENUM('admin', 'operario', 'cliente');--> statement-breakpoint
CREATE TYPE "public"."cuadres_tipo" AS ENUM('cliente', 'gasolinera');--> statement-breakpoint
CREATE TABLE "gasolineras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" varchar NOT NULL,
	"direccion" varchar NOT NULL,
	"ciudad" varchar NOT NULL,
	"serie_vale_actual" varchar DEFAULT 'A' NOT NULL,
	"activo" boolean DEFAULT true,
	"bloqueado" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" varchar NOT NULL,
	"nit" varchar,
	"contacto_email" varchar,
	"activo" boolean DEFAULT true,
	"bloqueado" boolean DEFAULT false NOT NULL,
	"limite_monto_dia" numeric(10, 2),
	"limite_monto_semana" numeric(10, 2),
	"limite_monto_mes" numeric(10, 2),
	"plantilla_monto_transaccion" numeric(10, 2),
	"plantilla_monto_dia" numeric(10, 2),
	"plantilla_monto_semana" numeric(10, 2),
	"plantilla_monto_mes" numeric(10, 2),
	"plantilla_volumen_transaccion" numeric(10, 3),
	"plantilla_volumen_dia" numeric(10, 3),
	"plantilla_volumen_semana" numeric(10, 3),
	"plantilla_volumen_mes" numeric(10, 3),
	"plantilla_trans_dia" integer,
	"plantilla_trans_semana" integer,
	"plantilla_trans_mes" integer,
	"plantilla_productos_permitidos" text[]
);
--> statement-breakpoint
CREATE TABLE "vehiculos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"placa" varchar NOT NULL,
	"marca" varchar,
	"modelo" varchar,
	"ruta" varchar,
	"tipo_vehiculo" varchar,
	"activo" boolean DEFAULT true,
	"bloqueado" boolean DEFAULT false NOT NULL,
	"limite_monto_transaccion" numeric(10, 2),
	"limite_monto_dia" numeric(10, 2),
	"limite_monto_semana" numeric(10, 2),
	"limite_monto_mes" numeric(10, 2),
	"limite_volumen_transaccion" numeric(10, 3),
	"limite_volumen_dia" numeric(10, 3),
	"limite_volumen_semana" numeric(10, 3),
	"limite_volumen_mes" numeric(10, 3),
	"limite_trans_dia" integer,
	"limite_trans_semana" integer,
	"limite_trans_mes" integer,
	"productos_permitidos" text[],
	"dias_permitidos" text[],
	"hora_inicio" varchar(5),
	"hora_fin" varchar(5),
	CONSTRAINT "vehiculos_placa_unique" UNIQUE("placa")
);
--> statement-breakpoint
CREATE TABLE "pilotos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"nombre_completo" varchar NOT NULL,
	"codigo" varchar,
	"activo" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "pilotos_vehiculos" (
	"piloto_id" uuid NOT NULL,
	"vehiculo_id" uuid NOT NULL,
	CONSTRAINT "pilotos_vehiculos_piloto_id_vehiculo_id_pk" PRIMARY KEY("piloto_id","vehiculo_id")
);
--> statement-breakpoint
CREATE TABLE "precios_combustible" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gasolinera_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"tipo_combustible" varchar NOT NULL,
	"precio_galon" numeric(10, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gasolinera_id" uuid,
	"cliente_id" uuid,
	"email" varchar NOT NULL,
	"nombre" varchar NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"password_actualizado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rol" "rol" NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sesiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"refresh_token_hash" varchar(64) NOT NULL,
	"familia_id" uuid NOT NULL,
	"usado_at" timestamp with time zone,
	"revocado_at" timestamp with time zone,
	"expira_at" timestamp with time zone NOT NULL,
	"familia_expira_at" timestamp with time zone NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_uso_at" timestamp with time zone,
	"user_agent" varchar(255),
	"ip" varchar(45),
	CONSTRAINT "sesiones_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "despachos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gasolinera_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"vehiculo_id" uuid NOT NULL,
	"piloto_id" uuid NOT NULL,
	"despachador_id" uuid NOT NULL,
	"precio_id" uuid NOT NULL,
	"numero_vale" varchar NOT NULL,
	"serie_vale" varchar NOT NULL,
	"turno" varchar NOT NULL,
	"bomba_numero" integer,
	"kilometraje" numeric(10, 3),
	"galones" numeric(10, 3) NOT NULL,
	"monto_total" numeric(10, 3) NOT NULL,
	"firma_key" varchar(255),
	"despachado_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "saldos_cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"saldo_actual" numeric(14, 3) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "saldos_cliente_cliente_id_unique" UNIQUE("cliente_id")
);
--> statement-breakpoint
CREATE TABLE "movimientos_saldo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"gasolinera_id" uuid NOT NULL,
	"despacho_id" uuid,
	"tipo" varchar NOT NULL,
	"monto" numeric(14, 3) NOT NULL,
	"descripcion" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cuadres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "cuadres_tipo" NOT NULL,
	"gasolinera_id" uuid NOT NULL,
	"cliente_id" uuid,
	"fecha_desde" date NOT NULL,
	"fecha_hasta" date NOT NULL,
	"cuadrado_por" uuid NOT NULL,
	"notas" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "configuracion_sistema" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sistema_bloqueado" boolean DEFAULT false NOT NULL,
	"bloqueado_por" varchar(255),
	"bloqueado_en" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilotos" ADD CONSTRAINT "pilotos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilotos_vehiculos" ADD CONSTRAINT "pilotos_vehiculos_piloto_id_pilotos_id_fk" FOREIGN KEY ("piloto_id") REFERENCES "public"."pilotos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilotos_vehiculos" ADD CONSTRAINT "pilotos_vehiculos_vehiculo_id_vehiculos_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precios_combustible" ADD CONSTRAINT "precios_combustible_gasolinera_id_gasolineras_id_fk" FOREIGN KEY ("gasolinera_id") REFERENCES "public"."gasolineras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_gasolinera_id_gasolineras_id_fk" FOREIGN KEY ("gasolinera_id") REFERENCES "public"."gasolineras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despachos" ADD CONSTRAINT "despachos_gasolinera_id_gasolineras_id_fk" FOREIGN KEY ("gasolinera_id") REFERENCES "public"."gasolineras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despachos" ADD CONSTRAINT "despachos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despachos" ADD CONSTRAINT "despachos_vehiculo_id_vehiculos_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despachos" ADD CONSTRAINT "despachos_piloto_id_pilotos_id_fk" FOREIGN KEY ("piloto_id") REFERENCES "public"."pilotos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despachos" ADD CONSTRAINT "despachos_despachador_id_usuarios_id_fk" FOREIGN KEY ("despachador_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despachos" ADD CONSTRAINT "despachos_precio_id_precios_combustible_id_fk" FOREIGN KEY ("precio_id") REFERENCES "public"."precios_combustible"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldos_cliente" ADD CONSTRAINT "saldos_cliente_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_saldo" ADD CONSTRAINT "movimientos_saldo_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_saldo" ADD CONSTRAINT "movimientos_saldo_gasolinera_id_gasolineras_id_fk" FOREIGN KEY ("gasolinera_id") REFERENCES "public"."gasolineras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_saldo" ADD CONSTRAINT "movimientos_saldo_despacho_id_despachos_id_fk" FOREIGN KEY ("despacho_id") REFERENCES "public"."despachos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuadres" ADD CONSTRAINT "cuadres_gasolinera_id_gasolineras_id_fk" FOREIGN KEY ("gasolinera_id") REFERENCES "public"."gasolineras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuadres" ADD CONSTRAINT "cuadres_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuadres" ADD CONSTRAINT "cuadres_cuadrado_por_usuarios_id_fk" FOREIGN KEY ("cuadrado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "precios_combustible_gasolinera_fecha_tipo_idx" ON "precios_combustible" USING btree ("gasolinera_id","fecha","tipo_combustible");--> statement-breakpoint
CREATE INDEX "sesiones_usuario_idx" ON "sesiones" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "sesiones_familia_idx" ON "sesiones" USING btree ("familia_id");--> statement-breakpoint
CREATE INDEX "sesiones_expira_idx" ON "sesiones" USING btree ("expira_at");--> statement-breakpoint
CREATE UNIQUE INDEX "despachos_gasolinera_serie_vale_idx" ON "despachos" USING btree ("gasolinera_id","serie_vale","numero_vale");