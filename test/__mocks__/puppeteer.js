// Mock de puppeteer: evita el parse de ESM en Jest y, sobre todo, evita
// levantar un Chromium real en cada corrida de la suite.
//
// Registra lo que el servicio le hace a la página para que los tests puedan
// afirmar sobre el endurecimiento del renderer (JS apagado, red bloqueada).
// Sin esto, alguien podría borrar esas dos líneas y ningún test se enteraría.
//
// Ojo con lo que este mock NO prueba: que el HTML realmente renderice. El PDF
// que devuelve es una cabecera fija.
const paginas = [];

function crearPagina() {
  const estado = {
    jsHabilitado: true,
    interceptacionActiva: false,
    eventos: [],
    html: null,
  };

  paginas.push(estado);

  return {
    setJavaScriptEnabled: jest.fn(async (valor) => {
      estado.jsHabilitado = valor;
    }),
    setRequestInterception: jest.fn(async (valor) => {
      estado.interceptacionActiva = valor;
    }),
    on: jest.fn((evento) => {
      estado.eventos.push(evento);
    }),
    setContent: jest.fn(async (html) => {
      estado.html = html;
    }),
    pdf: jest.fn(async () => Buffer.from("%PDF-1.4\n% mock de puppeteer\n")),
    close: jest.fn(async () => undefined),
  };
}

const puppeteer = {
  launch: jest.fn().mockImplementation(async () => ({
    newPage: jest.fn().mockImplementation(async () => crearPagina()),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  /** Estado de las páginas creadas, en orden. Lo leen los tests. */
  __paginas: paginas,
  __limpiarPaginas: () => {
    paginas.length = 0;
  },
};

module.exports = puppeteer;
module.exports.default = puppeteer;
