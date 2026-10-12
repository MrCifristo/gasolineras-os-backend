// src/modules/despachos/vales-pdf.reglas.ts
// Reglas puras del PDF de vales: tope por documento, nombre del archivo,
// agrupación de 4 vales por hoja y lectura del filtro `ids`.
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { isUUID } from "class-validator";

export const MAX_VALES_POR_PDF = 500;

export function exigirTopeVales(total: number): void {
  if (total === 0) {
    throw new NotFoundException("No hay vales con esos filtros");
  }
  if (total > MAX_VALES_POR_PDF) {
    throw new BadRequestException(
      `Son ${total} vales; acota el período o los filtros (máximo ${MAX_VALES_POR_PDF} por PDF).`,
    );
  }
}

function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function seguro(texto: string): string {
  return texto.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function nombreArchivoVales(p: {
  cliente: string | null;
  desde?: string;
  hasta?: string;
  unVale?: { serie: string; numero: string };
}): string {
  if (p.unVale) {
    return `vale-${seguro(p.unVale.serie)}-${seguro(p.unVale.numero)}.pdf`;
  }
  const cliente = p.cliente ? slug(p.cliente) : "todos";
  const desde = p.desde && FECHA_ISO.test(p.desde) ? p.desde : "inicio";
  const hasta = p.hasta && FECHA_ISO.test(p.hasta) ? p.hasta : "hoy";
  return `vales-${cliente || "todos"}-${desde}-a-${hasta}.pdf`;
}

export function deACuatro<T>(items: T[]): T[][] {
  const grupos: T[][] = [];
  for (let i = 0; i < items.length; i += 4) {
    grupos.push(items.slice(i, i + 4));
  }
  return grupos;
}

export function parsearIds(ids: string | undefined): string[] | undefined {
  if (!ids) return undefined;
  const lista = ids
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  if (lista.length === 0) return undefined;
  if (!lista.every((id) => isUUID(id))) {
    throw new BadRequestException(
      "ids debe ser una lista de UUID separados por comas",
    );
  }
  return lista;
}
