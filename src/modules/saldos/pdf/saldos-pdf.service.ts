import { Injectable } from "@nestjs/common";
import { SaldosService } from "../saldos.service";
import { QueryEstadoCuentaDto } from "../dto/query-estado-cuenta.dto";
import { buildEstadoCuentaHtml } from "./estado-cuenta-template";
import { renderizarPdf } from "../../../common/render-pdf";

@Injectable()
export class SaldosPdfService {
  constructor(private readonly saldos: SaldosService) {}

  async generarEstadoCuenta(
    clienteId: string,
    query: QueryEstadoCuentaDto,
  ): Promise<Buffer> {
    const estado = await this.saldos.getEstadoCuenta(clienteId, query);

    const html = buildEstadoCuentaHtml({
      cliente: { nombre: estado.cliente.nombre, nit: estado.cliente.nit },
      periodoLabel: this.periodoLabel(query),
      fechaGeneracion: new Date().toLocaleDateString("es-GT", {
        timeZone: "America/Guatemala",
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      saldo_inicial: estado.saldo_inicial,
      total_abonos: estado.total_abonos,
      total_debitos: estado.total_debitos,
      saldo_final: estado.saldo_final,
      movimientos: estado.movimientos,
    });

    return renderizarPdf(html, "A4");
  }

  private periodoLabel(q: QueryEstadoCuentaDto): string {
    if (q.fecha_desde && q.fecha_hasta)
      return `${q.fecha_desde} — ${q.fecha_hasta}`;
    if (q.fecha_desde) return `Desde ${q.fecha_desde}`;
    if (q.fecha_hasta) return `Hasta ${q.fecha_hasta}`;
    return "Histórico completo";
  }
}
