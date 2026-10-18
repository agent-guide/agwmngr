import { createHash, randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  findUserById,
  findUserByUsername,
  getDb,
  getGatewayAuthority,
  getHumanPrincipalAuthorityEpoch,
  listUsers,
} from "./db";
import { getServerEnv } from "./server-env";
import {
  openPostgresPlatformDatabase,
  openSqlitePlatformDatabase,
} from "./platform-database";
import type { ServiceCredentialIssuer } from "@/packages/platform/ports/credentials";
import type { MembershipReceiptIssuer } from "@/packages/platform/ports/credentials";
import { PlatformIdentityService } from "@/packages/platform/services/identity";
import { IdentityRegistry } from "@/packages/platform/services/identity-registry";
import { migratePlatformIdentityDatabase } from "@/packages/platform/services/identity-migrations";
import type { PlatformDatabase } from "@/packages/platform/ports/database";

export const serviceCredentialIssuer: ServiceCredentialIssuer = {
  digest: (token) => createHash("sha256").update(token).digest("hex"),
  issue() {
    const token = `agwmngr_svc_${randomBytes(32).toString("hex")}`;
    return {
      id: `credential:${randomUUID()}`,
      token,
      digest: this.digest(token),
    };
  },
};

export const membershipReceiptIssuer: MembershipReceiptIssuer = {
  digest: (token) => createHash("sha256").update(token).digest("hex"),
  issue() {
    const token = `agwmngr_member_${randomBytes(32).toString("hex")}`;
    return { token, digest: this.digest(token) };
  },
};

const globalState = globalThis as typeof globalThis & {
  __platformRuntime?: Promise<{
    database: PlatformDatabase;
    identity: PlatformIdentityService;
  }>;
};

export function getPlatformRuntime(): Promise<{
  database: PlatformDatabase;
  identity: PlatformIdentityService;
}> {
  if (!globalState.__platformRuntime) {
    globalState.__platformRuntime = (async () => {
      // Initialize the manager authority first. Human Principal rows only
      // reference these users; passwords and editable user state are not copied.
      getDb();
      const databaseUrl = getServerEnv("PLATFORM_DATABASE_URL");
      const database = databaseUrl
        ? openPostgresPlatformDatabase(databaseUrl)
        : openSqlitePlatformDatabase(
            getServerEnv("MANAGER_DB_PATH") || join(process.cwd(), "data", "manager.db"),
          );
      try {
        await migratePlatformIdentityDatabase(database);
      } catch (error) {
        if ("close" in database && typeof database.close === "function") {
          await database.close();
        }
        throw error;
      }

      const identity = new PlatformIdentityService(
        new IdentityRegistry(database),
        {
          async findUser(id) {
            const row = findUserById(id);
            const authorityEpoch = getHumanPrincipalAuthorityEpoch(id);
            return row && authorityEpoch !== null
              ? {
                  id: row.id,
                  username: row.username,
                  active: row.status === "active",
                  platformAdmin: row.is_platform_admin === 1,
                  authorityEpoch,
                }
              : null;
          },
          async findUserByUsername(username) {
            const row = findUserByUsername(username);
            if (!row || row.username !== username) return null;
            const authorityEpoch = getHumanPrincipalAuthorityEpoch(row.id);
            return authorityEpoch === null ? null : {
              id: row.id,
              username: row.username,
              active: row.status === "active",
              platformAdmin: row.is_platform_admin === 1,
              authorityEpoch,
            };
          },
          async listUsers() {
            return listUsers().flatMap((user) => {
              const authorityEpoch = getHumanPrincipalAuthorityEpoch(user.id);
              return authorityEpoch === null ? [] : [{
                id: user.id,
                username: user.username,
                active: user.status === "active",
                platformAdmin: user.is_platform_admin,
                authorityEpoch,
              }];
            });
          },
          async findGateway(id) {
            return getGatewayAuthority(id);
          },
        },
        serviceCredentialIssuer,
        membershipReceiptIssuer,
      );
      return { database, identity };
    })().catch((error) => {
      delete globalState.__platformRuntime;
      throw error;
    });
  }
  return globalState.__platformRuntime;
}

export async function getPlatformIdentity(): Promise<PlatformIdentityService> {
  return (await getPlatformRuntime()).identity;
}

export async function authenticatePlatformService(token: string) {
  return (await getPlatformIdentity()).authenticateService(token);
}
