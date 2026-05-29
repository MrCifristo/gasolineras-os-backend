import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

@Injectable()
export class DbService implements OnModuleInit {
  private pool: Pool;
  db: NodePgDatabase<typeof schema>;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    this.pool = new Pool({
      connectionString: this.config.get<string>("DATABASE_URL"),
    });
    this.db = drizzle(this.pool, { schema });
  }
}
