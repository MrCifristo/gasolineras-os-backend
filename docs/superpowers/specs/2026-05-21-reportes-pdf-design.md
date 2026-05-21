# Diseño: Módulo de Reportes PDF

**Fecha:** 2026-05-21  
**Proyecto:** GasFuel OS Backend  
**Estado:** Aprobado por el usuario  

---

## Decisiones de diseño

| Decisión | Elección | Motivo |
|---|---|---|
| Librería de PDF | Puppeteer | Máxima calidad visual, gráficas SVG reales, control total de CSS |
| Estilo visual | Corporate Blue | Header degradado navy, tarjetas blancas, tipografía limpia |
| Estructura | 4 páginas separadas | Cada sección respira, mejor para impresión y lectura |
| Arquitectura de gráficas | Frontend captura → Backend ensambla | Las gráficas del PDF son idénticas a las del UI, sin duplicar lógica |

---

## Endpoint

```
POST /api/v1/reportes/pdf
Auth: Bearer token — roles: admin, cliente
Content-Type: application/json
Response: application/pdf
Content-Disposition: attachment; filename="reporte-gasfuel-{YYYY-MM-DD}.pdf"
```

### Body

```typescript
{
  filtros: {
    cliente_id?:    string  // UUID
    gasolinera_id?: string  // UUID
    fecha_desde?:   string  // YYYY-MM-DD
    fecha_hasta?:   string  // YYYY-MM-DD
  }
  graficas: {
    donut?:     string  // base64 PNG — distribución por tipo de combustible
    linea?:     string  // base64 PNG — tendencia mensual (12 meses)
    vehiculos?: string  // base64 PNG — top vehículos por galones
    pilotos?:   string  // base64 PNG — top pilotos por galones
  }
}
```

Las gráficas son **opcionales**: si el frontend no las envía, ese espacio en el PDF se omite o muestra un placeholder. Esto permite generar el PDF sin el frontend (útil en tests o integraciones API directas).

### Control de acceso por rol

- **admin**: puede generar reporte sin restricciones, usando `filtros` libremente.
- **cliente**: el `cliente_id` se toma del token — el campo `filtros.cliente_id` se ignora si viene en el body; se fuerza el del usuario autenticado.

---

## Archivos nuevos

```
src/modules/reportes/
  pdf/
    reportes-pdf.service.ts    ← orquestación: datos + HTML + Puppeteer
    html-template.ts           ← construye el HTML completo (4 páginas)
    reportes-pdf.dto.ts        ← DTO de validación del body del POST
```

**Archivos modificados:**
- `src/modules/reportes/reportes.controller.ts` — nuevo endpoint `POST /pdf`
- `src/modules/reportes/reportes.module.ts` — registrar `ReportesPdfService`

**Dependencia nueva:** `puppeteer`

---

## Las 4 páginas del PDF

### Página 1 — Portada y KPIs ejecutivos

- Header full-width con degradado navy (`#0f2044` → `#2563eb`)
- Logo/nombre del sistema: "⛽ GASFUEL OS"
- Nombre de la empresa cliente (si se filtró por `cliente_id`)
- Período del reporte: "01 mayo 2026 – 21 mayo 2026"
- Fecha de generación
- **4 KPI cards** en una fila con fondo semitransparente:
  - Total galones despachados
  - Total monto (Q)
  - Total despachos
  - Promedio galones/despacho
- Tabla chica de resumen por gasolinera (id → galones → monto)

### Página 2 — Análisis de combustible

- Sección superior: gráfica donut (imagen PNG recibida del frontend) a la izquierda, tabla de desglose por tipo (diesel/super/regular/gas_lp con galones, monto y %) a la derecha.
- Sección inferior: gráfica de línea full-width (imagen PNG recibida del frontend) — tendencia de consumo de los últimos 12 meses. Si no hay datos históricos suficientes, se muestra el rango del filtro.

### Página 3 — Vehículos y Pilotos

**Mitad superior — Vehículos:**
- Gráfica de barras horizontales (imagen PNG recibida del frontend) — top 10 vehículos por galones
- Tabla: placa, marca, modelo, total despachos, total galones, total monto, km/galón promedio (si hay kilometraje)

**Mitad inferior — Pilotos:**
- Gráfica de barras horizontales (imagen PNG recibida del frontend) — top 10 pilotos por galones
- Tabla: código, nombre, total despachos, total galones, total monto

### Página 4 — Consolidado de Despachos

- Tabla completa de despachos en el período filtrado
- Columnas: N° Vale, Fecha/Hora, Gasolinera, Vehículo (placa), Piloto, Tipo, Galones, Monto (Q)
- Máximo 200 filas (si hay más, se indica al pie cuántos quedan fuera)
- Fila de totales al pie: suma de galones y monto
- Footer en cada página: nombre del sistema, fecha de generación, número de página (Pág. X de Y)

---

## Comportamiento de las imágenes de gráficas

El frontend envía cada gráfica como un string `data:image/png;base64,...`. El template HTML las inserta con un `<img src="...">` directamente. Puppeteer renderiza el HTML completo (con las imágenes inline) y exporta a PDF.

Si una imagen no viene en el body (`undefined` o `null`):
- Su espacio en el PDF se omite limpiamente — no queda un hueco vacío
- El resto de la sección sigue siendo funcional (la tabla de datos siempre se genera desde el backend)

---

## Datos que genera el backend (independiente del frontend)

El backend siempre consulta estos datos directamente de la DB para poblar las tablas y KPIs — no depende del frontend para los números:

- `ReportesService.resumen(filtros)` → KPIs, por_tipo, por_gasolinera
- `ReportesService.consumoPorVehiculo(filtros)` → tabla de vehículos
- `ReportesService.consumoPorPiloto(filtros)` → tabla de pilotos
- `ReportesService.tendenciaMensual(filtros)` → (para pie de página si no hay imagen)
- `DespachosService.findAll(filtros)` → tabla consolidada (max 200)

---

## Configuración de Puppeteer

```typescript
const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  headless: true,
});
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0' });
const pdf = await page.pdf({
  format: 'A4',
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});
await browser.close();
return pdf;
```

La instancia de Puppeteer se crea y destruye por request — no se mantiene una instancia global. Esto es seguro para cargas bajas/medias. Si en el futuro hay alta concurrencia, se puede implementar un pool.

---

## DTO de validación

```typescript
class FiltrosReporteDto {
  @IsOptional() @IsUUID()    cliente_id?:    string
  @IsOptional() @IsUUID()    gasolinera_id?: string
  @IsOptional() @IsDateString() fecha_desde?: string
  @IsOptional() @IsDateString() fecha_hasta?: string
}

class GraficasDto {
  @IsOptional() @IsString()  donut?:     string  // base64 PNG
  @IsOptional() @IsString()  linea?:     string  // base64 PNG
  @IsOptional() @IsString()  vehiculos?: string  // base64 PNG
  @IsOptional() @IsString()  pilotos?:   string  // base64 PNG
}

class GenerarPdfDto {
  @IsOptional() @ValidateNested() @Type(() => FiltrosReporteDto)
  filtros?: FiltrosReporteDto

  @IsOptional() @ValidateNested() @Type(() => GraficasDto)
  graficas?: GraficasDto
}
```

---

## Lo que NO incluye este spec

- Lógica del frontend para capturar gráficas con `html2canvas` (eso es trabajo del frontend)
- Pool de instancias Puppeteer para alta concurrencia
- Caché de PDFs generados
- Firma digital o marca de agua en el PDF
