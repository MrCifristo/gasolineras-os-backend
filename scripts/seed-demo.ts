/**
 * Siembra una base de DEMO con datos ficticios pero creíbles para presentar
 * EstacionFlow a clientes: ~120 días de historia (precios, despachos, abonos,
 * insumos, cuadres) más los despachos de hoy hasta la hora actual de Guatemala.
 *
 *   DATABASE_URL=postgresql://…/gasfuel_demo pnpm seed:demo
 *
 * Se niega a correr si el nombre de la base no termina en `_demo`: antes de
 * sembrar vacía TODAS las tablas de la app (TRUNCATE … RESTART IDENTITY
 * CASCADE). La tabla de migraciones vive en el esquema `drizzle` y no se toca.
 *
 * Inserta directo con Drizzle y no por la API porque hace falta historia con
 * fechas pasadas. Replica a mano lo que hacen los servicios (numeración de
 * vales por gasolinera+serie, débito en el ledger por despacho con la misma
 * descripción, kardex por cada movimiento de stock) para que la base quede
 * como si todo hubiera entrado por la API. El generador es determinista
 * (semilla fija): dos corridas el mismo día dejan los mismos conteos.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as s from '../src/db/schema';
import {
  ahoraGuatemala,
  fechaGuatemala,
  sumarDias,
} from '../src/common/hora-guatemala';

// Mismos parámetros que PasswordService (Argon2id === 2 en el const enum).
const ARGON2 = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Demo2026!';
const DIAS_HISTORIA = 120; // incluye hoy
const DIAS_GT = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const LUN_VIE = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];

// ── Aleatoriedad determinista ────────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(20261007);
// Cada sección reinicia su propia secuencia: así los despachos de hoy (que
// dependen de la hora) no corren la aleatoriedad del inventario ni los abonos.
const semilla = (n: number) => {
  rnd = mulberry32(20261007 + n);
};
const entre = (a: number, b: number) => a + rnd() * (b - a);
const entero = (a: number, b: number) => Math.floor(entre(a, b + 1));
const elegir = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const prob = (p: number) => rnd() < p;

// ── Fechas: negocio en hora de Guatemala, guardado en UTC ────────────────
/** Instante UTC de una fecha GT y un minuto del día GT (UTC−6 fijo). */
function instante(fecha: string, minuto: number): Date {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + (minuto + 360) * 60_000);
}
const diaSemana = (fecha: string) => new Date(`${fecha}T00:00:00Z`).getUTCDay();
function lunesDe(fecha: string): string {
  const d = diaSemana(fecha);
  return sumarDias(fecha, d === 0 ? -6 : 1 - d);
}
const mesDe = (fecha: string) => fecha.slice(0, 7);
const turnoDe = (minuto: number) => (minuto >= 840 ? 'tarde' : 'manana');

const n2 = (x: number) => x.toFixed(2);
const n3 = (x: number) => x.toFixed(3);
const redondear = (x: number, paso: number) => Math.round(x / paso) * paso;

// ── Catálogos ────────────────────────────────────────────────────────────
type Combustible = 'diesel' | 'super' | 'regular' | 'gas_lp';
const COMBUSTIBLES: Combustible[] = ['diesel', 'super', 'regular', 'gas_lp'];
// [inicio, mínimo, máximo] del precio por galón en Morales.
const RANGO_PRECIO: Record<Combustible, [number, number, number]> = {
  diesel: [29.45, 28.5, 30.5],
  super: [32.85, 32.0, 33.8],
  regular: [30.85, 30.0, 31.8],
  gas_lp: [15.8, 15.2, 16.4],
};
// Puerto Barrios: unos centavos distinto.
const DIFERENCIA_BARRIOS: Record<Combustible, number> = {
  diesel: 0.08,
  super: 0.06,
  regular: 0.1,
  gas_lp: -0.05,
};

type Clase = 'pesado' | 'mediano' | 'pickup';
const CLASE: Record<Clase, { monto: [number, number]; p: number; rend: [number, number]; extra: number }> = {
  // monto en Q, probabilidad de cargar un día hábil, km/galón, prob. de 2.ª carga
  pesado: { monto: [1600, 3000], p: 0.86, rend: [8, 11], extra: 0.2 },
  mediano: { monto: [800, 1800], p: 0.85, rend: [13, 17], extra: 0.12 },
  pickup: { monto: [200, 600], p: 0.8, rend: [30, 40], extra: 0.12 },
};

interface VehiculoDef {
  placa: string;
  marca: string;
  modelo: string;
  tipo: string;
  ruta: string;
  clase: Clase;
  combustible: Combustible;
  restr?: Partial<typeof s.vehiculos.$inferInsert>;
  nocturno?: boolean;
  bloqueadoDesde?: number; // días antes de hoy
}

interface ClienteDef {
  clave: string;
  nombre: string;
  nit: string;
  email: string;
  usuario: { email: string; nombre: string };
  base: 'morales' | 'barrios';
  saldoObjetivo: number;
  ultimoAbonoHace: number; // días antes de hoy
  creditoBloqueadoHace?: number;
  cliente?: Partial<typeof s.clientes.$inferInsert>;
  pilotos: string[];
  vehiculos: VehiculoDef[];
}

const PLANTILLA_TA = {
  limite_monto_transaccion: '3000.00',
  limite_monto_dia: '3500.00',
  limite_trans_dia: 2,
  productos_permitidos: ['diesel'],
};

const CLIENTES: ClienteDef[] = [
  {
    clave: 'TA',
    nombre: 'Transportes del Atlántico, S.A.',
    nit: '4827319-5',
    email: 'flota@transatlantico.demo',
    usuario: { email: 'flota@transatlantico.demo', nombre: 'Rodrigo Paz Castellanos' },
    base: 'barrios',
    saldoObjetivo: 48600,
    ultimoAbonoHace: 4,
    // Plantilla para vehículos nuevos: la flota pesada carga sólo diésel.
    cliente: {
      plantilla_monto_transaccion: '3000.00',
      plantilla_monto_dia: '3500.00',
      plantilla_trans_dia: 2,
      plantilla_productos_permitidos: ['diesel'],
    },
    pilotos: ['Edgar Rolando Pérez Monroy', 'Marvin Estuardo Chinchilla Ruiz', 'José Luis Ac Caal', 'Wilson Arnoldo Mejía Sosa', 'Byron Alexander Cruz Lima', 'Selvin Orlando Morán Pineda', 'Carlos Humberto Xol Tiul', 'Elmer Giovanni Sandoval Paz', 'Juan Carlos Cuc Bol'],
    vehiculos: [
      { placa: 'C-412BKR', marca: 'Freightliner', modelo: 'Cascadia 2019', tipo: 'Trailer', ruta: 'Puerto Barrios – Ciudad de Guatemala (CA-9)', clase: 'pesado', combustible: 'diesel', restr: PLANTILLA_TA },
      { placa: 'C-418BKR', marca: 'Freightliner', modelo: 'M2 106 2020', tipo: 'Camión de Carga', ruta: 'Puerto Barrios – Morales – Zacapa', clase: 'pesado', combustible: 'diesel', restr: PLANTILLA_TA },
      // Ruta nocturna a la capital: sólo carga de 22:00 a 06:00.
      { placa: 'C-527DLM', marca: 'International', modelo: 'LT625 2021', tipo: 'Trailer', ruta: 'Nocturna Santo Tomás – Ciudad de Guatemala', clase: 'pesado', combustible: 'diesel', restr: { ...PLANTILLA_TA, hora_inicio: '22:00', hora_fin: '06:00' }, nocturno: true },
      { placa: 'C-233FHG', marca: 'Hino', modelo: '500 FM 2018', tipo: 'Camión de Carga', ruta: 'Puerto Barrios – Río Dulce', clase: 'mediano', combustible: 'diesel', restr: PLANTILLA_TA },
      { placa: 'C-781GMN', marca: 'Isuzu', modelo: 'FVR 2017', tipo: 'Camión de Carga', ruta: 'Puerto Barrios – Morales', clase: 'mediano', combustible: 'diesel', restr: PLANTILLA_TA },
      { placa: 'C-102JTP', marca: 'Kenworth', modelo: 'T680 2022', tipo: 'Trailer', ruta: 'Puerto Barrios – Frontera Corinto', clase: 'pesado', combustible: 'diesel', restr: PLANTILLA_TA },
      { placa: 'P-645BBW', marca: 'Toyota', modelo: 'Hilux 2022', tipo: 'Pick-up', ruta: 'Supervisión de patio', clase: 'pickup', combustible: 'diesel', restr: { productos_permitidos: ['diesel'], limite_monto_mes: '9000.00' } },
      { placa: 'C-339KLS', marca: 'Hino', modelo: '300 Dutro 2019', tipo: 'Camión Repartidor', ruta: 'Puerto Barrios urbano', clase: 'mediano', combustible: 'diesel', restr: PLANTILLA_TA },
    ],
  },
  {
    clave: 'RD',
    nombre: 'Agroindustrias Río Dulce, S.A.',
    nit: '6935124-K',
    email: 'compras@agroriodulce.demo',
    usuario: { email: 'compras@agroriodulce.demo', nombre: 'Ana Lucía Morales Ortiz' },
    base: 'morales',
    saldoObjetivo: 31250,
    ultimoAbonoHace: 9,
    // Límites de cuenta: tope de gasto diario, semanal y mensual de la empresa.
    cliente: { limite_monto_dia: '12000.00', limite_monto_semana: '60000.00', limite_monto_mes: '220000.00' },
    pilotos: ['Héctor Rubén Caal Choc', 'Mario Alberto Ical Pop', 'Luis Fernando Barrios Ramos', 'Óscar René Tzul Coc', 'Fredy Antonio Lemus Oliva', 'Santos Abelino Ramírez Juárez', 'Gerson David Ochoa Velásquez'],
    vehiculos: [
      { placa: 'C-845HPT', marca: 'Isuzu', modelo: 'FTR 2020', tipo: 'Camión de Carga', ruta: 'Fincas Río Dulce – planta Morales', clase: 'mediano', combustible: 'diesel', restr: { limite_monto_transaccion: '1800.00', limite_volumen_dia: '70.000' } },
      { placa: 'C-846HPT', marca: 'Isuzu', modelo: 'FTR 2020', tipo: 'Camión de Carga', ruta: 'Fincas Río Dulce – planta Morales', clase: 'mediano', combustible: 'diesel', restr: { limite_monto_transaccion: '1800.00', limite_volumen_dia: '70.000' } },
      { placa: 'C-290MRS', marca: 'Hino', modelo: '500 GH 2016', tipo: 'Camión Cisterna', ruta: 'Riego fincas El Estor', clase: 'pesado', combustible: 'diesel', restr: { productos_permitidos: ['diesel'] } },
      { placa: 'P-318DFG', marca: 'Toyota', modelo: 'Hilux 2021', tipo: 'Pick-up', ruta: 'Administración de fincas', clase: 'pickup', combustible: 'super', restr: { dias_permitidos: LUN_VIE, limite_monto_mes: '7000.00' } },
      { placa: 'P-772GHJ', marca: 'Mitsubishi', modelo: 'L200 2020', tipo: 'Pick-up', ruta: 'Mantenimiento de canales', clase: 'pickup', combustible: 'diesel', restr: { dias_permitidos: LUN_VIE } },
      { placa: 'P-551BCN', marca: 'Isuzu', modelo: 'D-Max 2023', tipo: 'Pick-up', ruta: 'Mensajería fincas', clase: 'pickup', combustible: 'regular', restr: { limite_monto_transaccion: '400.00', limite_trans_dia: 1 } },
    ],
  },
  {
    clave: 'DC',
    nombre: 'Distribuidora Caribe, S.A.',
    nit: '3152846-7',
    email: 'flota@distcaribe.demo',
    usuario: { email: 'flota@distcaribe.demo', nombre: 'Karla Vanessa Recinos Flores' },
    base: 'morales',
    saldoObjetivo: 22480,
    ultimoAbonoHace: 2,
    pilotos: ['Kevin Alexander Gómez Vásquez', 'Erick Manuel Portillo Aldana', 'Walter Ovidio Cardona Paz', 'Julio César Hernández Mus', 'Brayan Josué Ramos Ac'],
    vehiculos: [
      { placa: 'C-614BRT', marca: 'Hino', modelo: '300 Dutro 2021', tipo: 'Camión Repartidor', ruta: 'Morales – Bananera – Los Amates', clase: 'mediano', combustible: 'diesel' },
      { placa: 'C-615BRT', marca: 'Isuzu', modelo: 'NPR 2019', tipo: 'Camión Repartidor', ruta: 'Morales – Puerto Barrios', clase: 'mediano', combustible: 'diesel' },
      { placa: 'P-903KMN', marca: 'Nissan', modelo: 'Frontier 2022', tipo: 'Pick-up', ruta: 'Ventas Izabal norte', clase: 'pickup', combustible: 'gas_lp' },
      { placa: 'P-904KMN', marca: 'Nissan', modelo: 'Frontier 2022', tipo: 'Pick-up', ruta: 'Ventas Izabal sur', clase: 'pickup', combustible: 'gas_lp' },
      { placa: 'P-127LPQ', marca: 'Toyota', modelo: 'Hiace Panel 2018', tipo: 'Panel', ruta: 'Reparto Morales centro', clase: 'pickup', combustible: 'regular', restr: { limite_monto_dia: '700.00' } },
    ],
  },
  {
    clave: 'CI',
    nombre: 'Constructora Izabal, S.A.',
    nit: '8810452-3',
    email: 'administracion@constructoraizabal.demo',
    usuario: { email: 'administracion@constructoraizabal.demo', nombre: 'Sergio Iván Pinto Galdámez' },
    base: 'morales',
    saldoObjetivo: 1850,
    ultimoAbonoHace: 16,
    pilotos: ['Rony Eduardo Lima Guerra', 'Mynor Augusto Orellana Cruz', 'Darwin Estuardo Choc Xi', 'Henry Rolando Sagastume Paz'],
    vehiculos: [
      { placa: 'C-708NRB', marca: 'Mack', modelo: 'Granite 2015', tipo: 'Camión de Carga', ruta: 'Proyecto carretera Morales – Livingston', clase: 'pesado', combustible: 'diesel', restr: { productos_permitidos: ['diesel'], limite_monto_mes: '42000.00' } },
      { placa: 'C-709NRB', marca: 'International', modelo: 'WorkStar 2016', tipo: 'Camión de Carga', ruta: 'Banco de materiales Río Motagua', clase: 'pesado', combustible: 'diesel', restr: { productos_permitidos: ['diesel'] } },
      { placa: 'P-210SVX', marca: 'Mitsubishi', modelo: 'L200 2019', tipo: 'Pick-up', ruta: 'Supervisión de obra', clase: 'pickup', combustible: 'diesel' },
      // Bloqueado por la empresa hace tres semanas (unidad en taller).
      { placa: 'P-588TWZ', marca: 'Nissan', modelo: 'Frontier 2017', tipo: 'Pick-up', ruta: 'Ingeniería residente', clase: 'pickup', combustible: 'diesel', bloqueadoDesde: 21 },
    ],
  },
  {
    clave: 'BV',
    nombre: 'Bananera Valle del Motagua, S.A.',
    nit: '5274903-1',
    email: 'transporte@bananeramotagua.demo',
    usuario: { email: 'transporte@bananeramotagua.demo', nombre: 'Lesbia Marisol Castañeda Ruano' },
    base: 'morales',
    saldoObjetivo: -12650,
    ultimoAbonoHace: 13,
    pilotos: ['Arnulfo de Jesús Pop Caal', 'Nery Estuardo Villeda Ponce', 'Germán Alfredo Coy Ico', 'Rigoberto Ixim Tzi', 'Edwin Leonel Chávez Montenegro', 'Pablo Emilio Matta Godoy', 'Ángel Gabriel Asig Coc'],
    vehiculos: [
      { placa: 'C-150PZK', marca: 'Freightliner', modelo: 'M2 112 2018', tipo: 'Trailer', ruta: 'Fincas Motagua – muelle Santo Tomás', clase: 'pesado', combustible: 'diesel', restr: { productos_permitidos: ['diesel'] } },
      { placa: 'C-151PZK', marca: 'Freightliner', modelo: 'M2 112 2018', tipo: 'Trailer', ruta: 'Fincas Motagua – muelle Santo Tomás', clase: 'pesado', combustible: 'diesel', restr: { productos_permitidos: ['diesel'] } },
      { placa: 'C-482QWB', marca: 'Hino', modelo: '500 FC 2019', tipo: 'Camión de Carga', ruta: 'Empacadora Bananera – fincas', clase: 'mediano', combustible: 'diesel' },
      { placa: 'C-913RTD', marca: 'Toyota', modelo: 'Hiace Commuter 2019', tipo: 'Panel', ruta: 'Transporte de personal Morales – fincas', clase: 'pickup', combustible: 'diesel', restr: { limite_trans_dia: 2 } },
      { placa: 'P-336VCH', marca: 'Toyota', modelo: 'Hilux 2020', tipo: 'Pick-up', ruta: 'Caporales finca Arapahoe', clase: 'pickup', combustible: 'diesel' },
      { placa: 'P-337VCH', marca: 'Toyota', modelo: 'Hilux 2020', tipo: 'Pick-up', ruta: 'Caporales finca Omagua', clase: 'pickup', combustible: 'diesel' },
      { placa: 'P-774DKP', marca: 'Mazda', modelo: 'BT-50 2022', tipo: 'Pick-up', ruta: 'Inspección de cultivo', clase: 'pickup', combustible: 'regular', restr: { limite_monto_transaccion: '450.00' } },
    ],
  },
  {
    clave: 'LS',
    nombre: 'Logística Santo Tomás, S.A.',
    nit: '2398615-4',
    email: 'operaciones@logisticast.demo',
    usuario: { email: 'operaciones@logisticast.demo', nombre: 'Fernando José Alvarado Quan' },
    base: 'barrios',
    saldoObjetivo: -4780,
    ultimoAbonoHace: 41,
    creditoBloqueadoHace: 12,
    pilotos: ['Mauricio Iván Solís Arana', 'Cristian Omar Juárez Teo', 'Alex Eduardo Sam Pop', 'Josué Daniel Linares Cuz'],
    vehiculos: [
      { placa: 'C-660XBN', marca: 'Volvo', modelo: 'VNL 2017', tipo: 'Trailer', ruta: 'Portuaria Santo Tomás – Ciudad de Guatemala', clase: 'pesado', combustible: 'diesel', restr: { productos_permitidos: ['diesel'], limite_volumen_transaccion: '110.000' } },
      { placa: 'C-661XBN', marca: 'Volvo', modelo: 'VNL 2017', tipo: 'Trailer', ruta: 'Portuaria Santo Tomás – Ciudad de Guatemala', clase: 'pesado', combustible: 'diesel', restr: { productos_permitidos: ['diesel'], limite_volumen_transaccion: '110.000' } },
      { placa: 'C-245YHG', marca: 'Isuzu', modelo: 'NQR 2018', tipo: 'Camión Repartidor', ruta: 'Puerto Barrios – Santo Tomás', clase: 'mediano', combustible: 'diesel' },
      { placa: 'P-480ZMK', marca: 'Mitsubishi', modelo: 'L200 2021', tipo: 'Pick-up', ruta: 'Coordinación de patio', clase: 'pickup', combustible: 'diesel' },
    ],
  },
];

const OPERARIOS = {
  morales: [
    ['Juan Pablo Choc Caal', 'OPM-01'],
    ['María Fernanda Ical Pop', 'OPM-02'],
    ['Luis Alberto Guzmán Ramos', 'OPM-03'],
    ['Rosa Elvira Tiul Xol', 'OPM-04'],
  ],
  barrios: [
    ['Carlos Enrique Mejía Paz', 'OPB-01'],
    ['Sandra Patricia Coc Bol', 'OPB-02'],
    ['Pedro Antonio Lemus Orellana', 'OPB-03'],
  ],
} as const;

const PRODUCTOS = [
  { nombre: 'Aceite motor diésel 15W-40 (galón)', sku: 'ACE-1540-GL', precio: 245, inicial: 40, minimo: 10, rotacion: 3 },
  { nombre: 'Aceite motor 20W-50 (cuarto)', sku: 'ACE-2050-QT', precio: 48, inicial: 72, minimo: 18, rotacion: 3 },
  { nombre: 'Aceite sintético 5W-30 (cuarto)', sku: 'ACE-0530-QT', precio: 72, inicial: 36, minimo: 12, rotacion: 1 },
  { nombre: 'Refrigerante verde (galón)', sku: 'REF-VER-GL', precio: 85, inicial: 30, minimo: 8, rotacion: 2 },
  { nombre: 'Líquido de frenos DOT-4 (12 oz)', sku: 'FRE-DOT4-12', precio: 55, inicial: 24, minimo: 6, rotacion: 1 },
  { nombre: 'Aditivo limpiador de inyectores diésel', sku: 'ADI-INY-DSL', precio: 95, inicial: 30, minimo: 8, rotacion: 1 },
  { nombre: 'Filtro de aceite camión pesado', sku: 'FIL-ACE-HD', precio: 165, inicial: 20, minimo: 6, rotacion: 1 },
  { nombre: 'Filtro de aire pick-up', sku: 'FIL-AIR-PU', precio: 140, inicial: 16, minimo: 5, rotacion: 1 },
  { nombre: 'Agua desmineralizada (galón)', sku: 'AGU-DES-GL', precio: 18, inicial: 60, minimo: 15, rotacion: 2 },
];
// Estos dos no se reponen en la última compra: quedan en "stock bajo".
const SIN_ULTIMA_REPOSICION = new Set(['FRE-DOT4-12', 'FIL-AIR-PU']);

const BANCOS = [
  (r: number) => `Abono — transferencia Banco Industrial ref. ${r}`,
  (r: number) => `Abono — depósito Banrural boleta ${r}`,
  (r: number) => `Abono — transferencia BAM ref. ${r}`,
  (r: number) => `Abono — cheque G&T Continental No. ${String(r).slice(-6)}`,
];

// ── Utilidades de BD ────────────────────────────────────────────────────
async function insertarPorLotes(db: any, tabla: any, filas: any[], lote = 1000) {
  for (let i = 0; i < filas.length; i += lote) {
    await db.insert(tabla).values(filas.slice(i, i + lote));
  }
}

const TABLAS_APP = [
  'venta_insumo_detalles', 'ventas_insumos', 'inventario_movimientos', 'productos',
  'cuadres', 'movimientos_saldo', 'despacho_detalles', 'despachos', 'saldos_cliente',
  'pilotos_vehiculos', 'pilotos', 'vehiculos', 'precios_combustible', 'operarios',
  'sesiones', 'tokens_reset', 'suscripciones_push', 'recordatorios_turno',
  'turnos_gasolinera', 'usuarios', 'clientes', 'gasolineras', 'configuracion_sistema',
];

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL.');
  const nombreBase = new URL(url).pathname.replace(/^\//, '');
  if (!nombreBase.endsWith('_demo')) {
    console.error(`❌ Me niego a sembrar "${nombreBase}": la base debe terminar en "_demo" (se vacían todas las tablas).`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  const t0 = Date.now();

  const hoy = fechaGuatemala();
  const { minutos: minutoAhora } = ahoraGuatemala();
  const inicio = sumarDias(hoy, -(DIAS_HISTORIA - 1));
  const fechas = Array.from({ length: DIAS_HISTORIA }, (_, i) => sumarDias(inicio, i));
  const diaIdx = (haceDias: number) => DIAS_HISTORIA - 1 - haceDias;

  try {
    await db.execute(sql.raw(`TRUNCATE ${TABLAS_APP.join(', ')} RESTART IDENTITY CASCADE`));

    // ── Sistema, gasolineras, turnos ────────────────────────────────────
    await db.insert(s.configuracionSistema).values({ sistema_bloqueado: false });

    const gas = {
      morales: { id: randomUUID(), serie: 'A' },
      barrios: { id: randomUUID(), serie: 'B' },
    };
    await db.insert(s.gasolineras).values([
      { id: gas.morales.id, nombre: 'La Estación Morales', direccion: 'Km 245 Carretera al Atlántico (CA-9), Barrio El Centro', ciudad: 'Morales, Izabal', serie_vale_actual: gas.morales.serie, created_at: instante(inicio, 0) },
      { id: gas.barrios.id, nombre: 'La Estación Puerto Barrios', direccion: '6a Avenida y 15 Calle, Barrio El Rastro', ciudad: 'Puerto Barrios, Izabal', serie_vale_actual: gas.barrios.serie, created_at: instante(inicio, 0) },
    ]);
    await db.insert(s.turnosGasolinera).values(
      Object.values(gas).flatMap((g) => [
        { gasolinera_id: g.id, turno: 'manana', hora_inicio: '06:00', hora_fin: '14:00' },
        { gasolinera_id: g.id, turno: 'tarde', hora_inicio: '14:00', hora_fin: '22:00' },
      ]),
    );

    // ── Operarios ───────────────────────────────────────────────────────
    const operarios: Record<'morales' | 'barrios', string[]> = { morales: [], barrios: [] };
    const filasOperarios: (typeof s.operarios.$inferInsert)[] = [];
    for (const k of ['morales', 'barrios'] as const) {
      for (const [nombre, codigo] of OPERARIOS[k]) {
        const id = randomUUID();
        operarios[k].push(id);
        filasOperarios.push({ id, gasolinera_id: gas[k].id, nombre, codigo });
      }
    }
    await db.insert(s.operarios).values(filasOperarios);

    // ── Clientes, saldos, vehículos, pilotos ────────────────────────────
    interface VehRt extends VehiculoDef {
      id: string;
      clienteId: string;
      cliKey: string;
      pilotos: string[];
      km: number;
      base: 'morales' | 'barrios';
    }
    const vehiculos: VehRt[] = [];
    const clienteId: Record<string, string> = {};
    const filasClientes: any[] = [];
    const filasVeh: any[] = [];
    const filasPil: any[] = [];
    const filasPV: any[] = [];
    for (const c of CLIENTES) {
      const id = randomUUID();
      clienteId[c.clave] = id;
      filasClientes.push({ id, nombre: c.nombre, nit: c.nit, contacto_email: c.email, credito_bloqueado: c.creditoBloqueadoHace !== undefined, ...(c.cliente ?? {}) });
      const pilIds = c.pilotos.map((nombre, i) => {
        const pid = randomUUID();
        filasPil.push({ id: pid, cliente_id: id, nombre_completo: nombre, codigo: `${c.clave}-${String(i + 1).padStart(3, '0')}` });
        return pid;
      });
      c.vehiculos.forEach((v, i) => {
        const vid = randomUUID();
        // Cada vehículo con su piloto titular y, a veces, un suplente.
        const asignados = [pilIds[i % pilIds.length]];
        if (pilIds.length > c.vehiculos.length && i < pilIds.length - c.vehiculos.length) asignados.push(pilIds[c.vehiculos.length + i]);
        else if (prob(0.3)) asignados.push(pilIds[(i + 1) % pilIds.length]);
        asignados.forEach((pid) => filasPV.push({ piloto_id: pid, vehiculo_id: vid }));
        filasVeh.push({ id: vid, cliente_id: id, placa: v.placa, marca: v.marca, modelo: v.modelo, ruta: v.ruta, tipo_vehiculo: v.tipo, bloqueado: v.bloqueadoDesde !== undefined, ...(v.restr ?? {}) });
        const kmBase = { pesado: [180000, 520000], mediano: [90000, 260000], pickup: [25000, 140000] }[v.clase];
        vehiculos.push({ ...v, id: vid, clienteId: id, cliKey: c.clave, pilotos: asignados, km: entero(kmBase[0], kmBase[1]), base: c.base });
      });
    }
    await db.insert(s.clientes).values(filasClientes);
    await db.insert(s.vehiculos).values(filasVeh);
    await db.insert(s.pilotos).values(filasPil);
    await db.insert(s.pilotosVehiculos).values(filasPV);

    // ── Usuarios ────────────────────────────────────────────────────────
    const passwordHash = await hash(PASSWORD, ARGON2);
    const usuariosDef = [
      { email: 'admin@laestacion.demo', nombre: 'Milton Beltrán', rol: 'admin' as const },
      { email: 'jefe.pista@laestacion.demo', nombre: 'Marco Antonio Leiva Rosales', rol: 'jefe_pista' as const },
      { email: 'supervisor.morales@laestacion.demo', nombre: 'Gladys Noemí Pineda Arriaza', rol: 'supervisor' as const, gasolinera_id: gas.morales.id },
      { email: 'supervisor.barrios@laestacion.demo', nombre: 'Otto René Salguero Paiz', rol: 'supervisor' as const, gasolinera_id: gas.barrios.id },
      ...CLIENTES.map((c) => ({ email: c.usuario.email, nombre: c.usuario.nombre, rol: 'cliente' as const, cliente_id: clienteId[c.clave] })),
    ];
    const usuarioId: Record<string, string> = {};
    await db.insert(s.usuarios).values(
      usuariosDef.map((u) => {
        const id = randomUUID();
        usuarioId[u.email] = id;
        return { id, password_hash: passwordHash, password_actualizado_at: instante(inicio, 0), ...u };
      }),
    );
    const supervisor = { morales: usuarioId['supervisor.morales@laestacion.demo'], barrios: usuarioId['supervisor.barrios@laestacion.demo'] };
    const adminId = usuarioId['admin@laestacion.demo'];

    // ── Precios: uno por gasolinera, fecha y combustible ────────────────
    semilla(1);
    const precio: Record<string, { id: string; valor: number }> = {};
    const filasPrecios: any[] = [];
    for (const comb of COMBUSTIBLES) {
      const [ini, min, max] = RANGO_PRECIO[comb];
      let p = ini;
      for (const f of fechas) {
        // Ajuste semanal (los lunes) con leve deriva, como se mueven en GT.
        if (diaSemana(f) === 1) p = Math.min(max, Math.max(min, p + entre(-0.35, 0.35)));
        const morales = Math.round(p * 100) / 100;
        for (const k of ['morales', 'barrios'] as const) {
          const valor = k === 'morales' ? morales : Math.round((morales + DIFERENCIA_BARRIOS[comb]) * 100) / 100;
          const id = randomUUID();
          precio[`${gas[k].id}|${f}|${comb}`] = { id, valor };
          filasPrecios.push({ id, gasolinera_id: gas[k].id, fecha: f, tipo_combustible: comb, precio_galon: n3(valor) });
        }
      }
    }
    await insertarPorLotes(db, s.preciosCombustible, filasPrecios);

    // ── Despachos ───────────────────────────────────────────────────────
    interface Renglon { renglon: 'vehiculo' | 'caneca' | 'tonel'; comb: Combustible; monto: number; galones: number; precioId: string }
    interface Desp { id: string; at: Date; fecha: string; minuto: number; g: 'morales' | 'barrios'; veh: VehRt; piloto: string; renglones: Renglon[] }
    const despachos: Desp[] = [];
    // Acumulados para respetar límites: clave → suma.
    const acum = new Map<string, number>();
    const sumar = (k: string, x: number) => acum.set(k, (acum.get(k) ?? 0) + x);
    const leer = (k: string) => acum.get(k) ?? 0;
    const num = (x: unknown) => (x === undefined || x === null ? Infinity : Number(x));

    for (let d = 0; d < DIAS_HISTORIA; d++) {
      const f = fechas[d];
      const dow = diaSemana(f);
      const esHoy = f === hoy;
      const sem = lunesDe(f);
      const mes = mesDe(f);
      for (const v of vehiculos) {
        const cli = CLIENTES.find((c) => c.clave === v.cliKey)!;
        if (v.bloqueadoDesde !== undefined && d >= diaIdx(v.bloqueadoDesde)) continue;
        if (cli.creditoBloqueadoHace !== undefined && d >= diaIdx(cli.creditoBloqueadoHace)) continue;
        const r = v.restr ?? {};
        if (r.dias_permitidos && !r.dias_permitidos.includes(DIAS_GT[dow])) continue;
        const cl = CLASE[v.clase];
        const veces = prob(cl.p * (dow === 0 ? 0.35 : dow === 6 ? 0.8 : 1)) ? (prob(cl.extra) ? 2 : 1) : 0;
        for (let n = 0; n < veces; n++) {
          // Hora: más movimiento en la mañana. El nocturno carga de 22:00 a 06:00.
          let minuto: number;
          if (v.nocturno) minuto = prob(0.5) ? entero(22 * 60, 23 * 60 + 40) : entero(4 * 60 + 30, 5 * 60 + 59);
          else {
            const u = rnd();
            minuto = u < 0.55 ? entero(360, 660) : u < 0.85 ? entero(660, 960) : entero(960, 1305);
          }
          if (esHoy && minuto > minutoAhora - 3) continue;
          const g = prob(0.8) ? v.base : v.base === 'morales' ? 'barrios' : 'morales';
          const kv = `v|${v.id}`;
          const kc = `c|${v.clienteId}`;
          // Límites del vehículo: cuánto le queda hoy, esta semana y este mes.
          const pr = precio[`${gas[g].id}|${f}|${v.combustible}`];
          if (Number(r.limite_trans_dia ?? Infinity) <= leer(`${kv}|td|${f}`)) continue;
          let tope = Math.min(
            num(r.limite_monto_transaccion),
            num(r.limite_monto_dia) - leer(`${kv}|md|${f}`),
            num(r.limite_monto_semana) - leer(`${kv}|ms|${sem}`),
            num(r.limite_monto_mes) - leer(`${kv}|mm|${mes}`),
            (num(r.limite_volumen_transaccion)) * pr.valor,
            (num(r.limite_volumen_dia) - leer(`${kv}|vd|${f}`)) * pr.valor,
            num(cli.cliente?.limite_monto_dia) - leer(`${kc}|md|${f}`),
            num(cli.cliente?.limite_monto_semana) - leer(`${kc}|ms|${sem}`),
            num(cli.cliente?.limite_monto_mes) - leer(`${kc}|mm|${mes}`),
          );
          let monto = entre(cl.monto[0], cl.monto[1]);
          monto = prob(0.7) ? redondear(monto, monto >= 500 ? 50 : 10) : redondear(monto, 0.5);
          if (monto > tope) monto = Math.floor(tope / 10) * 10;
          if (monto < cl.monto[0] * 0.6) continue;
          const renglones: Renglon[] = [{ renglon: 'vehiculo', comb: v.combustible, monto, galones: monto / pr.valor, precioId: pr.id }];
          // ~10 % de vales mixtos: una caneca (planta, motosierra) o un tonel.
          if (prob(0.11)) {
            const tonel = prob(0.4);
            const comb: Combustible = tonel || prob(0.6) ? 'diesel' : 'super';
            const pc = precio[`${gas[g].id}|${f}|${comb}`];
            const m = tonel ? redondear(entre(1400, 1650), 50) : redondear(entre(120, 320), 10);
            const restanteCli = Math.min(
              num(cli.cliente?.limite_monto_dia) - leer(`${kc}|md|${f}`),
              num(cli.cliente?.limite_monto_semana) - leer(`${kc}|ms|${sem}`),
              num(cli.cliente?.limite_monto_mes) - leer(`${kc}|mm|${mes}`),
            );
            if (monto + m <= restanteCli) renglones.push({ renglon: tonel ? 'tonel' : 'caneca', comb, monto: m, galones: m / pc.valor, precioId: pc.id });
          }
          const total = renglones.reduce((a, x) => a + x.monto, 0);
          const galV = renglones[0].galones;
          sumar(`${kv}|td|${f}`, 1);
          sumar(`${kv}|md|${f}`, monto);
          sumar(`${kv}|ms|${sem}`, monto);
          sumar(`${kv}|mm|${mes}`, monto);
          sumar(`${kv}|vd|${f}`, galV);
          sumar(`${kc}|md|${f}`, total);
          sumar(`${kc}|ms|${sem}`, total);
          sumar(`${kc}|mm|${mes}`, total);
          despachos.push({ id: randomUUID(), at: instante(f, minuto), fecha: f, minuto, g, veh: v, piloto: elegir(v.pilotos), renglones });
        }
      }
    }
    despachos.sort((a, b) => a.at.getTime() - b.at.getTime());

    const filasDesp: any[] = [];
    const filasDet: any[] = [];
    const filasMov: any[] = [];
    const correlativo = { morales: 0, barrios: 0 };
    for (const x of despachos) {
      const v = x.veh;
      const numero = String(++correlativo[x.g]).padStart(6, '0');
      const serie = gas[x.g].serie;
      const rend = entre(CLASE[v.clase].rend[0], CLASE[v.clase].rend[1]);
      v.km += Math.round(x.renglones[0].galones * rend * entre(0.85, 1.1));
      const total = x.renglones.reduce((a, r) => a + r.monto, 0);
      const galones = x.renglones.reduce((a, r) => a + r.galones, 0);
      filasDesp.push({
        id: x.id, gasolinera_id: gas[x.g].id, cliente_id: v.clienteId, vehiculo_id: v.id, piloto_id: x.piloto,
        despachador_id: supervisor[x.g], operario_id: elegir(operarios[x.g]), precio_id: x.renglones[0].precioId,
        numero_vale: numero, serie_vale: serie, turno: turnoDe(x.minuto), bomba_numero: elegir([1, 3]),
        kilometraje: n3(v.km), galones: n3(galones), monto_total: n3(total), firma_key: null, despachado_at: x.at,
      });
      for (const r of x.renglones) {
        filasDet.push({ despacho_id: x.id, renglon: r.renglon, tipo_combustible: r.comb, precio_id: r.precioId, monto: n3(r.monto), galones: n3(r.galones) });
      }
      // Misma descripción que arma DespachosService.create (resumenRenglones).
      const resumen = x.renglones.map((r) => `${r.renglon === 'vehiculo' ? '' : `${r.renglon} `}${r.comb} ${r.galones.toFixed(3)} gal`).join(' + ');
      filasMov.push({ cliente_id: v.clienteId, gasolinera_id: gas[x.g].id, despacho_id: x.id, tipo: 'debito', monto: n3(total), descripcion: `Despacho ${resumen} - Vale ${serie}-${numero}`, created_at: x.at });
    }
    await insertarPorLotes(db, s.despachos, filasDesp);
    await insertarPorLotes(db, s.despachoDetalles, filasDet);

    // ── Inventario y ventas de insumos ──────────────────────────────────
    semilla(2);
    const prods = PRODUCTOS.map((p) => ({ ...p, id: randomUUID(), stock: 0 }));
    const filasKardex: any[] = [];
    const filasVentas: any[] = [];
    const filasVentaDet: any[] = [];
    const reposiciones = [0, 30, 60, 90];
    const correlativoInsumos = { morales: 0, barrios: 0 };
    for (let d = 0; d < DIAS_HISTORIA; d++) {
      const f = fechas[d];
      if (reposiciones.includes(d)) {
        for (const p of prods) {
          if (d === 90 && SIN_ULTIMA_REPOSICION.has(p.sku)) continue;
          const cant = d === 0 ? p.inicial : Math.max(0, p.inicial - p.stock);
          if (cant <= 0) continue;
          p.stock += cant;
          filasKardex.push({ producto_id: p.id, tipo: 'entrada', cantidad: cant, motivo: d === 0 ? 'Existencia inicial' : 'Compra a proveedor', referencia: d === 0 ? null : `FAC-${entero(10000, 99999)}`, created_at: instante(f, 300) });
        }
      }
      for (const g of ['morales', 'barrios'] as const) {
        const ventasDia = (prob(g === 'morales' ? 0.55 : 0.4) ? 1 : 0) + (prob(0.15) ? 1 : 0);
        for (let n = 0; n < ventasDia; n++) {
          const minuto = entero(380, 1290);
          if (f === hoy && minuto > minutoAhora - 3) continue;
          const lineas: { p: (typeof prods)[number]; cant: number }[] = [];
          for (const p of [...prods].sort(() => rnd() - 0.5).slice(0, entero(1, 3))) {
            const cant = Math.min(p.stock, entero(1, p.rotacion + 1));
            if (cant > 0) lineas.push({ p, cant });
          }
          if (!lineas.length) continue;
          const cargoA = prob(0.45)
            ? elegir(CLIENTES.filter((c) => c.creditoBloqueadoHace === undefined || d < diaIdx(c.creditoBloqueadoHace)))
            : null;
          const id = randomUUID();
          const at = instante(f, minuto);
          const numero = String(++correlativoInsumos[g]).padStart(6, '0');
          const serie = gas[g].serie;
          const total = lineas.reduce((a, l) => a + l.cant * l.p.precio, 0);
          filasVentas.push({ id, gasolinera_id: gas[g].id, usuario_id: supervisor[g], operario_id: elegir(operarios[g]), cliente_id: cargoA ? clienteId[cargoA.clave] : null, forma_pago: cargoA ? 'cargo_cliente' : 'efectivo', numero_vale: numero, serie_vale: serie, bomba_numero: elegir([1, 3]), monto_total: n2(total), vendido_at: at });
          for (const l of lineas) {
            l.p.stock -= l.cant;
            filasVentaDet.push({ venta_id: id, producto_id: l.p.id, cantidad: l.cant, precio_unitario: n2(l.p.precio), subtotal: n2(l.cant * l.p.precio) });
            filasKardex.push({ producto_id: l.p.id, tipo: 'salida', cantidad: l.cant, motivo: 'Venta de insumos', referencia: `${serie}-${numero}`, created_at: at });
          }
          if (cargoA) {
            filasMov.push({ cliente_id: clienteId[cargoA.clave], gasolinera_id: gas[g].id, tipo: 'debito', monto: n3(total), descripcion: `Insumos ${lineas.length} producto(s) - Vale ${serie}-${numero}`, created_at: at });
          }
        }
      }
    }
    await db.insert(s.productos).values(prods.map((p) => ({ id: p.id, nombre: p.nombre, sku: p.sku, precio: n2(p.precio), stock_actual: p.stock, stock_minimo: p.minimo })));
    await insertarPorLotes(db, s.inventarioMovimientos, filasKardex);
    await insertarPorLotes(db, s.ventasInsumos, filasVentas);
    await insertarPorLotes(db, s.ventaInsumoDetalles, filasVentaDet);

    // ── Abonos: saldo inicial + abonos cada ~14 días ────────────────────
    semilla(3);
    // Cada abono cubre el consumo de su período (redondeado hacia arriba); el
    // último se ajusta para que el saldo final quede cerca del objetivo del
    // cliente (sano, bajo, negativo o en mora).
    const filasSaldos: any[] = [];
    for (const c of CLIENTES) {
      const cid = clienteId[c.clave];
      const debitosPorDia = new Array(DIAS_HISTORIA).fill(0);
      for (const m of filasMov) {
        if (m.cliente_id !== cid) continue;
        const fGt = new Date(m.created_at.getTime() - 6 * 3600_000).toISOString().slice(0, 10);
        debitosPorDia[fechas.indexOf(fGt)] += Number(m.monto);
      }
      const totalDebitos = debitosPorDia.reduce((a, b) => a + b, 0);
      const ultimo = diaIdx(c.ultimoAbonoHace);
      const dias: number[] = [];
      for (let d = 0; d < ultimo; d += 14) dias.push(d);
      if (dias[dias.length - 1] !== ultimo) dias.push(ultimo);
      let acumulado = 0;
      dias.forEach((d, k) => {
        let monto: number;
        if (k < dias.length - 1) {
          const consumo = debitosPorDia.slice(d, dias[k + 1]).reduce((a, b) => a + b, 0);
          monto = Math.ceil((consumo * 1.04 + (k === 0 ? 5000 : 0)) / 500) * 500;
        } else {
          monto = Math.max(1000, Math.ceil((c.saldoObjetivo + totalDebitos - acumulado) / 100) * 100);
        }
        acumulado += monto;
        filasMov.push({
          cliente_id: cid,
          gasolinera_id: k === 0 ? null : gas[c.base].id,
          tipo: 'credito',
          monto: n3(monto),
          descripcion: k === 0 ? 'Saldo inicial' : elegir(BANCOS)(entero(1000000, 9999999)),
          created_at: instante(fechas[d], k === 0 ? 0 : entero(540, 690)),
        });
      });
      filasSaldos.push({ cliente_id: cid, saldo_actual: n3(acumulado - totalDebitos), updated_at: new Date() });
    }
    await db.insert(s.saldosCliente).values(filasSaldos);
    await insertarPorLotes(db, s.movimientosSaldo, filasMov);

    // ── Cuadres pasados ────────────────────────────────────────────────
    const mesAnterior = mesDe(sumarDias(`${mesDe(hoy)}-01`, -1));
    const mesAntepasado = mesDe(sumarDias(`${mesAnterior}-01`, -1));
    const finDeMes = (m: string) => sumarDias(sumarDias(`${m}-01`, 32).slice(0, 8) + '01', -1);
    await db.insert(s.cuadres).values([
      { tipo: 'gasolinera', gasolinera_id: gas.morales.id, fecha_desde: `${mesAntepasado}-01`, fecha_hasta: finDeMes(mesAntepasado), cuadrado_por: adminId, notas: 'Cierre mensual sin diferencias. Vales y depósitos conciliados.', created_at: instante(sumarDias(finDeMes(mesAntepasado), 2), 600) },
      { tipo: 'gasolinera', gasolinera_id: gas.barrios.id, fecha_desde: `${mesAntepasado}-01`, fecha_hasta: finDeMes(mesAntepasado), cuadrado_por: adminId, notas: 'Cierre mensual. Diferencia de Q12.50 por redondeo en bomba 3, justificada.', created_at: instante(sumarDias(finDeMes(mesAntepasado), 2), 640) },
      { tipo: 'gasolinera', gasolinera_id: gas.morales.id, fecha_desde: `${mesAnterior}-01`, fecha_hasta: finDeMes(mesAnterior), cuadrado_por: adminId, notas: 'Cierre mensual sin diferencias.', created_at: instante(sumarDias(finDeMes(mesAnterior), 2), 615) },
      { tipo: 'cliente', gasolinera_id: gas.barrios.id, cliente_id: clienteId.TA, fecha_desde: `${mesAnterior}-01`, fecha_hasta: finDeMes(mesAnterior), cuadrado_por: adminId, notas: 'Estado de cuenta enviado y confirmado por Transportes del Atlántico.', created_at: instante(sumarDias(finDeMes(mesAnterior), 3), 700) },
    ]);

    // ── Resumen ─────────────────────────────────────────────────────────
    const { rows } = await pool.query(
      TABLAS_APP.map((t) => `SELECT '${t}' AS tabla, count(*)::int AS n FROM ${t}`).join(' UNION ALL '),
    );
    const { rows: saldos } = await pool.query(
      `SELECT c.nombre, s.saldo_actual, c.credito_bloqueado FROM saldos_cliente s JOIN clientes c ON c.id = s.cliente_id ORDER BY c.nombre`,
    );
    const { rows: [deHoy] } = await pool.query(
      `SELECT count(*)::int AS n FROM despachos WHERE (despachado_at - INTERVAL '6 hours')::date = $1::date`,
      [hoy],
    );

    console.log(`\n✅ Base "${nombreBase}" sembrada en ${((Date.now() - t0) / 1000).toFixed(1)} s — hoy (GT) ${hoy}, historia desde ${inicio}.`);
    console.log('\nFilas por tabla:');
    for (const r of rows.sort((a: any, b: any) => a.tabla.localeCompare(b.tabla))) console.log(`  ${r.tabla.padEnd(24)} ${String(r.n).padStart(6)}`);
    console.log(`\nDespachos de hoy: ${deHoy.n}`);
    console.log('\nSaldos:');
    for (const r of saldos) console.log(`  ${r.nombre.padEnd(36)} Q${Number(r.saldo_actual).toFixed(2).padStart(11)}${r.credito_bloqueado ? '  (crédito bloqueado)' : ''}`);
    console.log(`\nLogins (contraseña de todos: ${PASSWORD}):`);
    for (const u of usuariosDef) console.log(`  ${u.rol.padEnd(11)} ${u.email}`);
    console.log('');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
