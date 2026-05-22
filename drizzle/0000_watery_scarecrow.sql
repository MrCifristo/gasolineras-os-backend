CREATE TABLE "gasolineras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" varchar NOT NULL,
	"direccion" varchar NOT NULL,
	"ciudad" varchar NOT NULL,
	"activo" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" varchar NOT NULL,
	"nit" varchar,
	"contacto_email" varchar,
	"activo" boolean DEFAULT true
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
	"supabase_user_id" uuid NOT NULL,
	"gasolinera_id" uuid,
	"cliente_id" uuid,
	"email" varchar NOT NULL,
	"nombre" varchar NOT NULL,
	"rol" varchar NOT NULL,
	"activo" boolean DEFAULT true,
	CONSTRAINT "usuarios_supabase_user_id_unique" UNIQUE("supabase_user_id"),
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
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
	"firma_piloto_base64" text,
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
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilotos" ADD CONSTRAINT "pilotos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilotos_vehiculos" ADD CONSTRAINT "pilotos_vehiculos_piloto_id_pilotos_id_fk" FOREIGN KEY ("piloto_id") REFERENCES "public"."pilotos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilotos_vehiculos" ADD CONSTRAINT "pilotos_vehiculos_vehiculo_id_vehiculos_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precios_combustible" ADD CONSTRAINT "precios_combustible_gasolinera_id_gasolineras_id_fk" FOREIGN KEY ("gasolinera_id") REFERENCES "public"."gasolineras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_gasolinera_id_gasolineras_id_fk" FOREIGN KEY ("gasolinera_id") REFERENCES "public"."gasolineras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
CREATE UNIQUE INDEX "precios_combustible_gasolinera_fecha_tipo_idx" ON "precios_combustible" USING btree ("gasolinera_id","fecha","tipo_combustible");--> statement-breakpoint
CREATE UNIQUE INDEX "despachos_gasolinera_serie_vale_idx" ON "despachos" USING btree ("gasolinera_id","serie_vale","numero_vale");