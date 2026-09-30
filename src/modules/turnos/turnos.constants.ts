export const TURNOS = ["manana", "tarde"] as const;
export type Turno = (typeof TURNOS)[number];

export const NOMBRE_TURNO: Record<Turno, string> = {
  manana: "Mañana",
  tarde: "Tarde",
};

/** Horario con el que nace toda gasolinera; el admin lo ajusta después. */
export const TURNOS_POR_DEFECTO: {
  turno: Turno;
  hora_inicio: string;
  hora_fin: string;
}[] = [
  { turno: "manana", hora_inicio: "06:00", hora_fin: "14:00" },
  { turno: "tarde", hora_inicio: "14:00", hora_fin: "22:00" },
];
