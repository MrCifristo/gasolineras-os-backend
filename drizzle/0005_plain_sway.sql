CREATE TYPE "public"."tipo_movimiento_inventario" AS ENUM('entrada', 'salida');--> statement-breakpoint
CREATE TYPE "public"."forma_pago_insumo" AS ENUM('efectivo', 'cargo_cliente');--> statement-breakpoint
CREATE TABLE "productos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" varchar NOT NULL,
	"sku" varchar,
	"precio" numeric(10, 2) NOT NULL,
	"stock_actual" integer DEFAULT 0 NOT NULL,
	"stock_minimo" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "productos_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "inventario_movimientos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producto_id" uuid NOT NULL,
	"tipo" "tipo_movimiento_inventario" NOT NULL,
	"cantidad" integer NOT NULL,
	"motivo" varchar,
	"referencia" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venta_insumo_detalles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venta_id" uuid NOT NULL,
	"producto_id" uuid NOT NULL,
	"cantidad" integer NOT NULL,
	"precio_unitario" numeric(10, 2) NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ventas_insumos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gasolinera_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"operario_id" uuid,
	"cliente_id" uuid,
	"forma_pago" "forma_pago_insumo" NOT NULL,
	"numero_vale" varchar NOT NULL,
	"serie_vale" varchar NOT NULL,
	"bomba_numero" integer,
	"monto_total" numeric(12, 2) NOT NULL,
	"vendido_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventario_movimientos" ADD CONSTRAINT "inventario_movimientos_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venta_insumo_detalles" ADD CONSTRAINT "venta_insumo_detalles_venta_id_ventas_insumos_id_fk" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas_insumos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venta_insumo_detalles" ADD CONSTRAINT "venta_insumo_detalles_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ventas_insumos" ADD CONSTRAINT "ventas_insumos_gasolinera_id_gasolineras_id_fk" FOREIGN KEY ("gasolinera_id") REFERENCES "public"."gasolineras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ventas_insumos" ADD CONSTRAINT "ventas_insumos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ventas_insumos" ADD CONSTRAINT "ventas_insumos_operario_id_operarios_id_fk" FOREIGN KEY ("operario_id") REFERENCES "public"."operarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ventas_insumos" ADD CONSTRAINT "ventas_insumos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventario_movimientos_producto_idx" ON "inventario_movimientos" USING btree ("producto_id");--> statement-breakpoint
CREATE INDEX "venta_insumo_detalles_venta_idx" ON "venta_insumo_detalles" USING btree ("venta_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ventas_insumos_gasolinera_serie_vale_idx" ON "ventas_insumos" USING btree ("gasolinera_id","serie_vale","numero_vale");