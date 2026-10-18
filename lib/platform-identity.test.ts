import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
    [1, { id: 1, username: "operator", active: true, platformAdmin: true, authorityEpoch: 1 }],
    [2, { id: 2, username: "alice", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [3, { id: 3, username: "bob", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [4, { id: 4, username: "charlie", active: true, platformAdmin: false, authorityEpoch: 1 }],
  ]);
  const gateways = new Map([
    ["prod", { id: "prod", active: true, authorityEpoch: 1 }],
    ["stage", { id: "stage", active: true, authorityEpoch: 1 }],
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
  let receiptNumber = 0;
  const receipts = {
    digest: (token: string) => `receipt-digest:${token}`,
    issue() {
      receiptNumber++;
      const token = `agwmngr_member_${receiptNumber.toString(16).padStart(64, "0")}`;
      return { token, digest: this.digest(token) };
    },
  };
  const registry = new IdentityRegistry(database);
  const service = new PlatformIdentityService(
    registry,
    {
      async findUser(id) {
        return users.get(id) ?? null;
      },
      async findUserByUsername(username) {
        return [...users.values()].find((user) => user.username === username) ?? null;
      },
      async listUsers() {
        return [...users.values()];
      },
      async findGateway(id) {
        return gateways.get(id) ?? null;
      },
    },
    credentials,
    receipts,
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

  const grant = await service.setTenantGatewayGrant(
    platformAdmin,
    "user:2",
    "alpha",
    "prod",
    "manage",
  );
  expect(grant).toMatchObject({
    principalId: "user:2",
    tenantId: "alpha",
    gatewayId: "prod",
    access: "manage",
  });
  expect(Object.keys(grant)).not.toContain("principalAuthorityEpoch");
  expect((await service.authorizeTenantGateway(alice, "alpha", "prod", "view")).grant.access)
    .toBe("manage");
  expect((await service.authorizeTenantGateway(alice, "alpha", "prod", "manage")).gateway.id)
    .toBe("prod");
  await expect(
    service.setTenantGatewayGrant(platformAdmin, "user:3", "alpha", "prod", "view"),
  ).rejects.toMatchObject({ code: "invalid_input" });
  await expect(service.authorizeTenantGateway(bob, "alpha", "prod")).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    service.authorizeTenantGateway(platformAdmin, "alpha", "prod"),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(service.authorizeTenantGateway(alice, "beta", "prod")).rejects.toMatchObject({
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
  users.get(2)!.authorityEpoch++;
  await expect(service.authorizeTenant(alice, "alpha")).rejects.toMatchObject({
    code: "unauthenticated",
  });
  users.get(2)!.active = true;
  await expect(service.authorizeTenantGateway(alice, "alpha", "prod")).rejects.toMatchObject({
    code: "forbidden",
  });
  await service.setTenantGatewayGrant(platformAdmin, "user:2", "alpha", "prod", "view");
  await service.setTenantStatus(platformAdmin, "alpha", "disabled");
  await expect(service.authorizeTenant(alice, "alpha")).rejects.toMatchObject({
    code: "forbidden",
  });
  await service.setTenantStatus(platformAdmin, "alpha", "active");
  await expect(service.authorizeTenantGateway(alice, "alpha", "prod")).rejects.toMatchObject({
    code: "forbidden",
  });

  await service.setTenantGatewayGrant(platformAdmin, "user:2", "alpha", "prod", "view");
  gateways.get("prod")!.active = false;
  gateways.get("prod")!.authorityEpoch++;
  await expect(service.authorizeTenantGateway(alice, "alpha", "prod")).rejects.toMatchObject({
    code: "forbidden",
  });
  gateways.get("prod")!.active = true;
  await expect(service.authorizeTenantGateway(alice, "alpha", "prod")).rejects.toMatchObject({
    code: "forbidden",
  });
  await service.setTenantGatewayGrant(platformAdmin, "user:2", "alpha", "prod", "view");
  await service.setMembership(platformAdmin, "alpha", "user:2", "user");
  await service.setMembership(platformAdmin, "alpha", "user:2", "admin");
  await expect(service.authorizeTenantGateway(alice, "alpha", "prod")).rejects.toMatchObject({
    code: "forbidden",
  });

  const issued = await service.createService(
    platformAdmin,
    "deployer",
    "2026-10-18T00:00:00.000Z",
  );
  const worker = await service.authenticateService(issued.token);
  await service.bootstrapMembership(platformAdmin, "alpha", issued.principal.id, "admin");
  await service.setTenantGatewayGrant(
    platformAdmin,
    issued.principal.id,
    "alpha",
    "prod",
    "manage",
  );
  expect((await service.authorizeTenantGateway(worker, "alpha", "prod", "manage")).grant.access)
    .toBe("manage");
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
  expect(
    await registry.tenantGatewayGrant(issued.principal.id, "alpha", "prod"),
  ).toBeNull();
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
          ? { id, username: "admin", active: true, platformAdmin: true, authorityEpoch: 1 }
          : null;
      },
      async findUserByUsername(username) {
        return username === "admin"
          ? { id: 1, username: "admin", active: true, platformAdmin: true, authorityEpoch: 1 }
          : null;
      },
      async listUsers() {
        return [{ id: 1, username: "admin", active: true, platformAdmin: true, authorityEpoch: 1 }];
      },
      async findGateway(id) {
        return id === "prod" ? { id, active: true, authorityEpoch: 1 } : null;
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
    {
      digest: (token) => token,
      issue: () => ({
        token: `agwmngr_member_${"2".repeat(64)}`,
        digest: `agwmngr_member_${"2".repeat(64)}`,
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

  await expect(service.createTenant(admin, "alpha", "Replacement")).rejects.toMatchObject({
    code: "conflict",
  });
  await service.deleteTenant(admin, "alpha");
  await expect(service.createTenant(admin, "alpha", "Replacement")).rejects.toMatchObject({
    code: "conflict",
  });

  const issued = await service.createService(
    admin,
    "worker",
    "2026-10-18T00:00:00.000Z",
  );
  await service.disableService(admin, issued.principal.id);
  await expect(
    service.createService(admin, "worker", "2026-10-18T00:00:00.000Z"),
  ).rejects.toMatchObject({ code: "conflict" });
});

test("grant races fail closed without deleting grants on indeterminate failures", async () => {
  const database = sqlitePlatformDatabase(openDatabase(":memory:"));
  await migratePlatformIdentityDatabase(database);
  const registry = new IdentityRegistry(database);
  const users = new Map([
    [1, { id: 1, username: "admin", active: true, platformAdmin: true, authorityEpoch: 1 }],
    [2, { id: 2, username: "alice", active: true, platformAdmin: false, authorityEpoch: 1 }],
  ]);
  const gateway = { id: "prod", active: true, authorityEpoch: 1 };
  let raceOnSave = false;
  let failOnGatewayRead: number | null = null;
  let gatewayReads = 0;
  const service = new PlatformIdentityService(
    registry,
    {
      async findUser(id) {
        return users.get(id) ?? null;
      },
      async findUserByUsername(username) {
        return [...users.values()].find((user) => user.username === username) ?? null;
      },
      async listUsers() {
        return [...users.values()];
      },
      async findGateway(id) {
        if (id !== gateway.id) return null;
        gatewayReads++;
        if (gatewayReads === failOnGatewayRead) {
          throw new Error("injected Gateway directory failure");
        }
        if (raceOnSave && gatewayReads === 2) gateway.authorityEpoch++;
        return { ...gateway };
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
    {
      digest: (token) => token,
      issue: () => ({
        token: `agwmngr_member_${"3".repeat(64)}`,
        digest: `agwmngr_member_${"3".repeat(64)}`,
      }),
    },
    () => new Date("2026-10-17T00:00:00.000Z"),
  );
  const admin: PlatformActorReference = { kind: "human", userId: 1 };
  const alice: PlatformActorReference = { kind: "human", userId: 2 };
  await service.createTenant(admin, "alpha", "Alpha");
  await service.bootstrapMembership(admin, "alpha", "user:2", "admin");

  raceOnSave = true;
  gatewayReads = 0;
  await expect(
    service.setTenantGatewayGrant(admin, "user:2", "alpha", "prod", "view"),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(await registry.tenantGatewayGrant("user:2", "alpha", "prod")).toBeNull();

  raceOnSave = false;
  gatewayReads = 0;
  await service.setTenantGatewayGrant(admin, "user:2", "alpha", "prod", "view");
  gateway.authorityEpoch++;
  const cleanup = registry.removeTenantGatewayGrantIfSnapshot.bind(registry);
  registry.removeTenantGatewayGrantIfSnapshot = async () => {
    throw new Error("injected cleanup failure");
  };
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    await expect(service.authorizeTenantGateway(alice, "alpha", "prod")).rejects.toMatchObject({
      code: "forbidden",
    });
  } finally {
    console.error = originalConsoleError;
    registry.removeTenantGatewayGrantIfSnapshot = cleanup;
  }
  expect(await registry.tenantGatewayGrant("user:2", "alpha", "prod")).not.toBeNull();

  // Indeterminate directory failures are not proof that a grant is stale. A
  // read must surface the failure without turning it into a destructive cleanup.
  gatewayReads = 0;
  await service.setTenantGatewayGrant(admin, "user:2", "alpha", "prod", "view");
  gatewayReads = 0;
  failOnGatewayRead = 1;
  await expect(service.listTenantGatewayGrants(admin)).rejects.toThrow(
    "injected Gateway directory failure",
  );
  failOnGatewayRead = null;
  expect(await registry.tenantGatewayGrant("user:2", "alpha", "prod")).not.toBeNull();

  // The same rule applies to the post-write authority recheck. The saved row
  // remains fail-closed until a later live-authority check can validate it.
  gatewayReads = 0;
  failOnGatewayRead = 2;
  await expect(
    service.setTenantGatewayGrant(admin, "user:2", "alpha", "prod", "manage"),
  ).rejects.toThrow("injected Gateway directory failure");
  failOnGatewayRead = null;
  expect(await registry.tenantGatewayGrant("user:2", "alpha", "prod")).toMatchObject({
    access: "manage",
  });
  gatewayReads = 0;
  expect(await service.listTenantGatewayGrants(admin)).toEqual([
    expect.objectContaining({ access: "manage" }),
  ]);
});

test("Tenant Admin exact resolution issues fenced single-use membership receipts", async () => {
  const database = sqlitePlatformDatabase(openDatabase(":memory:"));
  await migratePlatformIdentityDatabase(database);
  const registry = new IdentityRegistry(database);
  const users = new Map([
    [1, { id: 1, username: "platform", active: true, platformAdmin: true, authorityEpoch: 1 }],
    [2, { id: 2, username: "tenant-admin", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [3, { id: 3, username: "service:worker", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [4, { id: 4, username: "expiring-target", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [5, { id: 5, username: "stale-target", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [6, { id: 6, username: "tenant-user", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [7, { id: 7, username: "other-admin", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [8, { id: 8, username: "disabled-target", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [9, { id: 9, username: "membership-fence-target", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [10, { id: 10, username: "resolve-failure-target", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [11, { id: 11, username: "consume-failure-target", active: true, platformAdmin: false, authorityEpoch: 1 }],
  ]);
  let now = new Date("2026-10-17T00:00:00.000Z");
  let number = 0;
  let failUserRead = false;
  const service = new PlatformIdentityService(
    registry,
    {
      async findUser(id) {
        if (failUserRead) throw new Error("injected manager directory failure");
        return users.get(id) ?? null;
      },
      async findUserByUsername(username) {
        return [...users.values()].find((user) => user.username === username) ?? null;
      },
      async listUsers() {
        return [...users.values()];
      },
      async findGateway() {
        return null;
      },
    },
    {
      digest: (token) => `service:${token}`,
      issue() {
        number++;
        const token = `agwmngr_svc_${number.toString(16).padStart(64, "0")}`;
        return { id: `credential:${number}`, token, digest: this.digest(token) };
      },
    },
    {
      digest: (token) => createHash("sha256").update(token).digest("hex"),
      issue() {
        number++;
        const token = `agwmngr_member_${number.toString(16).padStart(64, "0")}`;
        return { token, digest: this.digest(token) };
      },
    },
    () => now,
  );
  const platform: PlatformActorReference = { kind: "human", userId: 1 };
  const tenantAdmin: PlatformActorReference = { kind: "human", userId: 2 };
  const tenantUser: PlatformActorReference = { kind: "human", userId: 6 };
  const otherAdmin: PlatformActorReference = { kind: "human", userId: 7 };

  await service.createTenant(platform, "alpha", "Alpha");
  await service.createTenant(platform, "beta", "Beta");
  await service.bootstrapMembership(platform, "alpha", "user:2", "admin");
  await service.bootstrapMembership(platform, "beta", "user:2", "admin");
  await service.bootstrapMembership(platform, "alpha", "user:6", "user");
  await service.bootstrapMembership(platform, "alpha", "user:7", "admin");
  const worker = await service.createService(
    platform,
    "worker",
    "2026-10-18T00:00:00.000Z",
  );

  await expect(
    service.resolveMembershipTarget(platform, "alpha", {
      kind: "human",
      username: "expiring-target",
    }),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    service.resolveMembershipTarget(tenantUser, "alpha", {
      kind: "human",
      username: "expiring-target",
    }),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    service.resolveMembershipTarget(tenantAdmin, "alpha", {
      kind: "service",
      principalId: "service:work",
    }),
  ).rejects.toMatchObject({ code: "not_found" });

  const humanCollision = await service.resolveMembershipTarget(tenantAdmin, "alpha", {
    kind: "human",
    username: "service:worker",
  });
  expect(humanCollision).toMatchObject({ kind: "human", label: "service:worker", status: "active" });
  expect(humanCollision).not.toHaveProperty("id");
  const [storedReceipt] = await database.query<{ receipt_digest: string }>(
    "SELECT receipt_digest FROM platform_membership_add_receipts WHERE target_principal_id = ?",
    ["user:3"],
  );
  expect(storedReceipt.receipt_digest).not.toContain(humanCollision.receipt);
  expect(
    await service.addMembershipWithReceipt(
      tenantAdmin,
      "alpha",
      humanCollision.receipt,
      "user",
    ),
  ).toMatchObject({ principalId: "user:3", tenantId: "alpha", role: "user" });
  await expect(
    service.addMembershipWithReceipt(tenantAdmin, "alpha", humanCollision.receipt, "admin"),
  ).rejects.toMatchObject({ code: "conflict" });

  const serviceCollision = await service.resolveMembershipTarget(tenantAdmin, "alpha", {
    kind: "service",
    principalId: worker.principal.id,
  });
  expect(serviceCollision).toMatchObject({ kind: "service", label: "worker" });
  expect(
    await service.addMembershipWithReceipt(
      tenantAdmin,
      "alpha",
      serviceCollision.receipt,
      "user",
    ),
  ).toMatchObject({ principalId: "service:worker" });

  const crossScope = await service.resolveMembershipTarget(tenantAdmin, "alpha", {
    kind: "human",
    username: "expiring-target",
  });
  await expect(
    service.addMembershipWithReceipt(otherAdmin, "alpha", crossScope.receipt, "user"),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    service.addMembershipWithReceipt(tenantAdmin, "beta", crossScope.receipt, "user"),
  ).rejects.toMatchObject({ code: "forbidden" });

  now = new Date("2026-10-17T00:06:00.000Z");
  await expect(
    service.addMembershipWithReceipt(tenantAdmin, "alpha", crossScope.receipt, "user"),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(await registry.membership("user:4", "alpha")).toBeNull();

  now = new Date("2026-10-17T00:07:00.000Z");
  const staleTarget = await service.resolveMembershipTarget(tenantAdmin, "alpha", {
    kind: "human",
    username: "stale-target",
  });
  users.get(5)!.authorityEpoch++;
  await expect(
    service.addMembershipWithReceipt(tenantAdmin, "alpha", staleTarget.receipt, "user"),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(await registry.membership("user:5", "alpha")).toBeNull();

  const disabledTarget = await service.resolveMembershipTarget(tenantAdmin, "alpha", {
    kind: "human",
    username: "disabled-target",
  });
  users.get(8)!.active = false;
  users.get(8)!.authorityEpoch++;
  await expect(
    service.addMembershipWithReceipt(tenantAdmin, "alpha", disabledTarget.receipt, "user"),
  ).rejects.toMatchObject({ code: "invalid_input" });
  expect(await registry.membership("user:8", "alpha")).toBeNull();

  const staleMembership = await service.resolveMembershipTarget(tenantAdmin, "alpha", {
    kind: "human",
    username: "membership-fence-target",
  });
  await service.setMembership(platform, "alpha", "user:2", "user");
  await service.setMembership(platform, "alpha", "user:2", "admin");
  await expect(
    service.addMembershipWithReceipt(tenantAdmin, "alpha", staleMembership.receipt, "user"),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(await registry.membership("user:9", "alpha")).toBeNull();

  // An indeterminate directory failure after persisting a receipt is not proof
  // that its authority snapshot is stale, so it must not trigger deletion.
  const createReceipt = registry.createMembershipAddReceipt.bind(registry);
  registry.createMembershipAddReceipt = async (input) => {
    const created = await createReceipt(input);
    if (created) failUserRead = true;
    return created;
  };
  await expect(
    service.resolveMembershipTarget(tenantAdmin, "alpha", {
      kind: "human",
      username: "resolve-failure-target",
    }),
  ).rejects.toThrow("injected manager directory failure");
  failUserRead = false;
  registry.createMembershipAddReceipt = createReceipt;
  expect(
    await database.query<{ target_principal_id: string }>(
      "SELECT target_principal_id FROM platform_membership_add_receipts WHERE target_principal_id = ?",
      ["user:10"],
    ),
  ).toHaveLength(1);

  // The same rule applies after atomic receipt consumption. The membership and
  // consumed receipt remain committed while later live checks fail closed.
  const consumeFailure = await service.resolveMembershipTarget(tenantAdmin, "alpha", {
    kind: "human",
    username: "consume-failure-target",
  });
  const consumeReceipt = registry.consumeMembershipAddReceipt.bind(registry);
  registry.consumeMembershipAddReceipt = async (input) => {
    const result = await consumeReceipt(input);
    if (result.status === "created") failUserRead = true;
    return result;
  };
  await expect(
    service.addMembershipWithReceipt(
      tenantAdmin,
      "alpha",
      consumeFailure.receipt,
      "user",
    ),
  ).rejects.toThrow("injected manager directory failure");
  failUserRead = false;
  registry.consumeMembershipAddReceipt = consumeReceipt;
  expect(await registry.membership("user:11", "alpha")).toMatchObject({ role: "user" });
  await expect(
    service.addMembershipWithReceipt(
      tenantAdmin,
      "alpha",
      consumeFailure.receipt,
      "user",
    ),
  ).rejects.toMatchObject({ code: "conflict" });
});
