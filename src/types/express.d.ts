import type { usuarios } from "../db/schema";

// AuthGuard cuelga la fila completa de `usuarios` en el request. Declararlo acá
// permite tipar `req.user` en vez de arrastrar `any` por los controllers.
declare global {
  namespace Express {
    interface Request {
      user?: typeof usuarios.$inferSelect;
    }
  }
}

export {};
