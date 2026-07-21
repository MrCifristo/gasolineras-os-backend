import { NestFactory } from "@nestjs/core";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { LoggingInterceptor } from "./common/logging.interceptor";

const PORT = process.env.PORT ?? 3000;
const esProduccion = process.env.NODE_ENV === "production";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Headers de seguridad. contentSecurityPolicy se apaga fuera de producción
  // para no romper el Swagger UI (que usa estilos/scripts inline).
  app.use(helmet({ contentSecurityPolicy: esProduccion ? undefined : false }));

  // AuthGuard lee el access token de la cookie ef_at que pone el BFF de Next.
  app.use(cookieParser());

  // Detrás de un proxy (Fly, Vercel, nginx) sin esto req.ip es la IP del proxy
  // y el rate limit del login metería a todo el mundo en un solo balde.
  app.set("trust proxy", 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Un 500 no debe filtrar stack traces al cliente; se loguean del lado servidor.
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  app.enableCors({
    origin: process.env.FRONTEND_URL || "http://localhost:3001",
    credentials: true,
  });

  app.setGlobalPrefix("api/v1");

  // Swagger queda fuera del prefijo y sin autenticar: en producción sería un
  // índice público de toda la API.
  if (!esProduccion) montarSwagger(app);

  await app.listen(PORT);
  console.log(`gasfuel-backend corriendo en puerto ${PORT}`);
  if (!esProduccion) {
    console.log(`Swagger UI disponible en http://localhost:${PORT}/api/docs`);
  }
}

function montarSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("GasFuel Backend API")
    .setDescription("API para gestión de despachos de combustible")
    .setVersion("1.0")
    .addBearerAuth(
      { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      "JWT",
    )
    .addTag("auth", "Sesión, refresh y logout")
    .addTag("gasolineras", "Gestión de gasolineras")
    .addTag("clientes", "Gestión de clientes")
    .addTag("vehiculos", "Gestión de vehículos")
    .addTag("pilotos", "Gestión de pilotos")
    .addTag("precios-combustible", "Precios de combustible por gasolinera")
    .addTag("despachos", "Registro de despachos")
    .addTag("reportes", "Reportes y estadísticas")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}

void bootstrap();
