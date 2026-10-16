import { expect, test } from "bun:test";
import type { PlatformActorReference } from "@/packages/contracts/platform/identity";
import type { ServiceCredentialIssuer } from "@/packages/platform/ports/credentials";
import { PlatformIdentityService } from "@/packages/platform/services/identity";
import { IdentityRegistry } from "@/packages/platform/services/identity-registry";
import { migratePlatformIdentityDatabase } from "@/packages/platform/services/identity-migrations";
import { sqlitePlatformDatabase } from "./platform-database";
import { openDatabase } from "./sqlite";

test("live Principal, Tenant, and membership state is revalidated on every operation", async () => {
  const database = sqlitePlatformDatabase(openDatabase(":memory:"));
  await migratePlatformIdentityDatabase(database);

  const users = new Map([
    [1, { id: 1, username: "operator", active: true, platformAdmin: true }],
    [2, { id: 2, username: "alice", active: true, platformAdmin: false }],
    [3, { id: 3, username: "bob", active: true, platformAdmin: false }],
    [4, { id: 4, username: "charlie", active: true, platformAdmin: false }],
  ]);
  let now = new Date("2026-10-17T00:00:00.000Z");
  let credentialNumber = 0;
  const credentials: ServiceCredentialIssuer = {
    digest: (token) => `digest:${token}`,
    issue() {
      credentialNumber++;
      const token = `agwmngr_svc_${String(credentialNumber).padStart(64, "0")}`;
      return { id: `credential:${credentialNumber}`, token, digest: this.digest(token) };
    },
  };
  const service = new PlatformIdentityService(
    new IdentityRegistry(database),
    {
      async findUser(id) {
        return users.get(id) ?? null;
      },
      async listUsers() {
        return [...users.values()];
      },
    },
    credentials,
    () => now,
  );

  const platformAdmin: PlatformActorReference = { kind: "human", userId: 1 };
  const alice: PlatformActorReference = { kind: "human", userId: 2 };
  const bob: PlatformActorReference = { kind: "human", userId: 3 };

  await service.createTenant(platformAdmin, "alpha", "Alpha");
  await service.createTenant(platformAdmin, "beta", "Beta");

  // Global Platform Admin is deliberately not implicit Tenant authority.
  await expect(service.authorizeTenant(platformAdmin, "alpha")).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(service.authorizeTenant(alice, "alpha")).rejects.toMatchObject({
    code: "forbidden",
  });

  await service.bootstrapMembership(platformAdmin, "alpha", "user:2", "admin");
  await service.bootstrapMembership(platformAdmin, "alpha", "user:3", "user");
  expect((await service.authorizeTenant(alice, "alpha", "admin")).membership.role).toBe(
    "admin",
  );
  expect((await service.authorizeTenant(bob, "alpha", "user")).membership.role).toBe("user");
  await expect(service.authorizeTenant(bob, "alpha", "admin")).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(service.authorizeTenant(alice, "beta")).rejects.toMatchObject({
    code: "forbidden",
  });

  // A Tenant Admin can manage that Tenant, while a Tenant User cannot.
  await service.setMembership(alice, "alpha", "user:3", "admin");
  expect((await service.authorizeTenant(bob, "alpha", "admin")).membership.role).toBe(
    "admin",
  );
  await service.setMembership(alice, "alpha", "user:3", "user");
  await expect(
    service.setMembership(alice, "alpha", "user:4", "user"),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    service.setMembership(alice, "alpha", "user:999", "user"),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    service.bootstrapMembership(alice, "alpha", "user:4", "user"),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    service.setMembership(bob, "alpha", "user:3", "admin"),
  ).rejects.toMatchObject({ code: "forbidden" });

  users.get(2)!.active = false;
  await expect(service.authorizeTenant(alice, "alpha")).rejects.toMatchObject({
    code: "unauthenticated",
  });
  users.get(2)!.active = true;
  await service.setTenantStatus(platformAdmin, "alpha", "disabled");
  await expect(service.authorizeTenant(alice, "alpha")).rejects.toMatchObject({
    code: "forbidden",
  });
  await service.setTenantStatus(platformAdmin, "alpha", "active");

  const issued = await service.createService(
    platformAdmin,
    "deployer",
    "2026-10-18T00:00:00.000Z",
  );
  const worker = await service.authenticateService(issued.token);
  await service.bootstrapMembership(platformAdmin, "alpha", issued.principal.id, "admin");
  expect((await service.authorizeTenant(worker, "alpha", "admin")).principal.kind).toBe(
    "service",
  );
  await service.setMembership(worker, "alpha", "user:3", "user");

  // Stale service actor references carry no cached authority.
  await service.removeMembership(platformAdmin, "alpha", issued.principal.id);
  await expect(service.authorizeTenant(worker, "alpha")).rejects.toMatchObject({
    code: "forbidden",
  });
  await service.bootstrapMembership(platformAdmin, "alpha", issued.principal.id, "admin");
  now = new Date("2026-10-19T00:00:00.000Z");
  await expect(service.authorizeTenant(worker, "alpha")).rejects.toMatchObject({
    code: "unauthenticated",
  });
  now = new Date("2026-10-17T00:00:00.000Z");
  await service.disableService(platformAdmin, issued.principal.id);
  await expect(service.authorizeTenant(worker, "alpha")).rejects.toMatchObject({
    code: "unauthenticated",
  });
  await expect(service.authenticateService(issued.token)).rejects.toMatchObject({
    code: "unauthenticated",
  });

  users.get(1)!.platformAdmin = false;
  await expect(service.createTenant(platformAdmin, "gamma", "Gamma")).rejects.toMatchObject({
    code: "forbidden",
  });
});

test("identity inputs reject role and identity escalation", async () => {
  const database = sqlitePlatformDatabase(openDatabase(":memory:"));
  await migratePlatformIdentityDatabase(database);
  const service = new PlatformIdentityService(
    new IdentityRegistry(database),
    {
      async findUser(id) {
        return id === 1
          ? { id, username: "admin", active: true, platformAdmin: true }
          : null;
      },
      async listUsers() {
        return [{ id: 1, username: "admin", active: true, platformAdmin: true }];
      },
    },
    {
      digest: (token) => token,
      issue: () => ({
        id: "credential:test",
        token: `agwmngr_svc_${"1".repeat(64)}`,
        digest: "digest",
      }),
    },
    () => new Date("2026-10-17T00:00:00.000Z"),
  );
  const admin: PlatformActorReference = { kind: "human", userId: 1 };
  await service.createTenant(admin, "alpha", "Alpha");
  await expect(
    service.bootstrapMembership(admin, "alpha", "user:1", "owner" as "admin"),
  ).rejects.toMatchObject({ code: "invalid_input" });
  await expect(
    service.bootstrapMembership(admin, "alpha", "user:999", "admin"),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    service.createService(admin, "Invalid Name", "2026-10-18T00:00:00.000Z"),
  ).rejects.toMatchObject({ code: "invalid_input" });
});
