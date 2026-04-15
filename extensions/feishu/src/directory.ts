import type { ClawdbotConfig } from "../runtime-api.js";
import { resolveFeishuAccount } from "./accounts.js";
import { createFeishuClient } from "./client.js";
import {
  listFeishuDirectoryGroups,
  listFeishuDirectoryPeers,
  type FeishuDirectoryGroup,
  type FeishuDirectoryPeer,
} from "./directory.static.js";
import { resolveFeishuPreferredSendTarget, resolveFeishuStablePersonKey } from "./identity.js";

export { listFeishuDirectoryGroups, listFeishuDirectoryPeers } from "./directory.static.js";

const FEISHU_DIRECTORY_PAGE_SIZE = 50;

type FeishuDirectoryUserLike = {
  open_id?: string;
  user_id?: string;
  union_id?: string;
  name?: string;
  nickname?: string;
  en_name?: string;
  email?: string;
  enterprise_email?: string;
  mobile?: string;
  department_ids?: string[];
};

function normalizeDirectoryQuery(query?: string): string {
  return query?.trim().toLowerCase() || "";
}

function matchesFeishuDirectoryUserQuery(user: FeishuDirectoryUserLike, query?: string): boolean {
  const normalizedQuery = normalizeDirectoryQuery(query);
  if (!normalizedQuery) {
    return true;
  }
  return [
    user.open_id,
    user.user_id,
    user.name,
    user.nickname,
    user.en_name,
    user.email,
    user.enterprise_email,
    user.mobile,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery));
}

function toFeishuDirectoryPeer(user: FeishuDirectoryUserLike): FeishuDirectoryPeer | null {
  const openId = user.open_id?.trim();
  if (!openId) {
    return null;
  }
  const name = user.name?.trim() || user.nickname?.trim() || user.en_name?.trim() || undefined;
  return {
    kind: "user",
    id: openId,
    name,
    userId: user.user_id?.trim() || undefined,
    unionId: user.union_id?.trim() || undefined,
    stablePersonKey: resolveFeishuStablePersonKey(user),
    preferredSendTarget: resolveFeishuPreferredSendTarget(user),
    enterpriseEmail: user.enterprise_email?.trim() || undefined,
    mobile: user.mobile?.trim() || undefined,
    departmentIds: Array.isArray(user.department_ids)
      ? user.department_ids.filter((id): id is string => typeof id === "string" && id.trim() !== "")
      : undefined,
  };
}

async function listVisibleFeishuDepartmentIds(client: ReturnType<typeof createFeishuClient>) {
  const ids = new Set<string>();
  let pageToken: string | undefined;

  do {
    const response = await client.contact.department.children({
      path: { department_id: "0" },
      params: {
        department_id_type: "open_department_id",
        fetch_child: true,
        page_size: FEISHU_DIRECTORY_PAGE_SIZE,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    });

    if (response.code !== 0) {
      throw new Error(response.msg || `code ${response.code}`);
    }

    for (const department of response.data?.items ?? []) {
      const id = department.open_department_id?.trim();
      if (id) {
        ids.add(id);
      }
    }

    pageToken =
      response.data?.has_more === true && response.data.page_token?.trim()
        ? response.data.page_token.trim()
        : undefined;
  } while (pageToken);

  return [...ids];
}

async function listFeishuDirectoryPeersFromDepartments(params: {
  client: ReturnType<typeof createFeishuClient>;
  query?: string;
  limit: number;
}): Promise<FeishuDirectoryPeer[]> {
  const departmentIds = ["0", ...(await listVisibleFeishuDepartmentIds(params.client))];
  const peers: FeishuDirectoryPeer[] = [];
  const seenPeerIds = new Set<string>();

  for (const departmentId of departmentIds) {
    let pageToken: string | undefined;

    do {
      const response = await params.client.contact.user.findByDepartment({
        params: {
          department_id: departmentId,
          department_id_type: "open_department_id",
          user_id_type: "open_id",
          page_size: FEISHU_DIRECTORY_PAGE_SIZE,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      });

      if (response.code !== 0) {
        throw new Error(response.msg || `code ${response.code}`);
      }

      for (const user of response.data?.items ?? []) {
        if (!matchesFeishuDirectoryUserQuery(user, params.query)) {
          continue;
        }
        const peer = toFeishuDirectoryPeer(user);
        if (!peer || seenPeerIds.has(peer.id)) {
          continue;
        }
        seenPeerIds.add(peer.id);
        peers.push(peer);
        if (peers.length >= params.limit) {
          return peers;
        }
      }

      pageToken =
        response.data?.has_more === true && response.data.page_token?.trim()
          ? response.data.page_token.trim()
          : undefined;
    } while (pageToken);
  }

  return peers;
}

async function listFeishuDirectoryPeersFromLegacyList(params: {
  client: ReturnType<typeof createFeishuClient>;
  query?: string;
  limit: number;
}): Promise<FeishuDirectoryPeer[]> {
  const peers: FeishuDirectoryPeer[] = [];
  const response = await params.client.contact.user.list({
    params: {
      page_size: Math.min(params.limit, 50),
    },
  });

  if (response.code !== 0) {
    throw new Error(response.msg || `code ${response.code}`);
  }

  for (const user of response.data?.items ?? []) {
    if (!matchesFeishuDirectoryUserQuery(user, params.query)) {
      continue;
    }
    const peer = toFeishuDirectoryPeer(user);
    if (!peer) {
      continue;
    }
    peers.push(peer);
    if (peers.length >= params.limit) {
      break;
    }
  }

  return peers;
}

export async function listFeishuDirectoryPeersLive(params: {
  cfg: ClawdbotConfig;
  query?: string;
  limit?: number;
  accountId?: string;
  fallbackToStatic?: boolean;
}): Promise<FeishuDirectoryPeer[]> {
  const account = resolveFeishuAccount({ cfg: params.cfg, accountId: params.accountId });
  if (!account.configured) {
    return listFeishuDirectoryPeers(params);
  }

  try {
    const client = createFeishuClient(account);
    const limit = params.limit ?? 50;
    try {
      return await listFeishuDirectoryPeersFromDepartments({
        client,
        query: params.query,
        limit,
      });
    } catch {
      return await listFeishuDirectoryPeersFromLegacyList({
        client,
        query: params.query,
        limit,
      });
    }
  } catch (err) {
    if (params.fallbackToStatic === false) {
      throw err instanceof Error ? err : new Error("Feishu live peer lookup failed");
    }
    return listFeishuDirectoryPeers(params);
  }
}

export async function listFeishuDirectoryGroupsLive(params: {
  cfg: ClawdbotConfig;
  query?: string;
  limit?: number;
  accountId?: string;
  fallbackToStatic?: boolean;
}): Promise<FeishuDirectoryGroup[]> {
  const account = resolveFeishuAccount({ cfg: params.cfg, accountId: params.accountId });
  if (!account.configured) {
    return listFeishuDirectoryGroups(params);
  }

  try {
    const client = createFeishuClient(account);
    const groups: FeishuDirectoryGroup[] = [];
    const limit = params.limit ?? 50;

    const response = await client.im.chat.list({
      params: {
        page_size: Math.min(limit, 100),
      },
    });

    if (response.code !== 0) {
      throw new Error(response.msg || `code ${response.code}`);
    }

    for (const chat of response.data?.items ?? []) {
      if (chat.chat_id) {
        const q = params.query?.trim().toLowerCase() || "";
        const name = chat.name || "";
        if (!q || chat.chat_id.toLowerCase().includes(q) || name.toLowerCase().includes(q)) {
          groups.push({
            kind: "group",
            id: chat.chat_id,
            name: name || undefined,
          });
        }
      }
      if (groups.length >= limit) {
        break;
      }
    }

    return groups;
  } catch (err) {
    if (params.fallbackToStatic === false) {
      throw err instanceof Error ? err : new Error("Feishu live group lookup failed");
    }
    return listFeishuDirectoryGroups(params);
  }
}
