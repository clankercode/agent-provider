import { browser } from "wxt/browser";
import type { PermissionState } from "@agent-provider/protocol";

const PERMISSIONS_KEY = "agent-provider.permissions.v1";

interface PersistentPermissionRecord {
  grantedAt: number;
}

type PersistentPermissionMap = Record<string, PersistentPermissionRecord>;

function validOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

async function loadPersistentPermissions(): Promise<PersistentPermissionMap> {
  const result = await browser.storage.local.get(PERMISSIONS_KEY);
  const value = result[PERMISSIONS_KEY];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const permissions: PersistentPermissionMap = {};
  for (const [origin, rawRecord] of Object.entries(value)) {
    if (
      !validOrigin(origin) ||
      typeof rawRecord !== "object" ||
      rawRecord === null ||
      Array.isArray(rawRecord)
    ) {
      continue;
    }
    const grantedAt = Reflect.get(rawRecord, "grantedAt");
    if (typeof grantedAt !== "number" || !Number.isFinite(grantedAt)) {
      continue;
    }
    permissions[origin] = { grantedAt };
  }
  return permissions;
}

async function savePersistentPermissions(
  permissions: PersistentPermissionMap,
): Promise<void> {
  await browser.storage.local.set({ [PERMISSIONS_KEY]: permissions });
}

export async function hasPersistentPermission(
  origin: string,
): Promise<boolean> {
  const permissions = await loadPersistentPermissions();
  return permissions[origin] !== undefined;
}

export async function grantPersistentPermission(origin: string): Promise<void> {
  if (!validOrigin(origin)) {
    throw new Error("Invalid AgentProvider permission origin.");
  }
  const permissions = await loadPersistentPermissions();
  permissions[origin] = { grantedAt: Date.now() };
  await savePersistentPermissions(permissions);
}

export async function revokePersistentPermission(
  origin: string,
): Promise<void> {
  const permissions = await loadPersistentPermissions();
  delete permissions[origin];
  await savePersistentPermissions(permissions);
}

export async function getPermissionState(
  origin: string,
  sessionGranted: boolean,
): Promise<PermissionState> {
  if (sessionGranted) {
    return "granted-session";
  }
  return (await hasPersistentPermission(origin))
    ? "granted-persistent"
    : "prompt";
}
